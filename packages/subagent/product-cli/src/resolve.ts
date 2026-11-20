/**
 * Executable resolution for one product CLI, in a fixed order: the explicit
 * configured path, a Stitch download, the user's own install (PATH and
 * well-known locations, at or above the minimum version), then a native
 * package installed beside the SDK in a development checkout.
 *
 * @module @deepseek-ai/dsh-product-cli/resolve
 */

import { execFile } from 'node:child_process'
import { readFileSync, realpathSync, statSync } from 'node:fs'
import { homedir } from 'node:os'
import { basename, dirname, isAbsolute, join, posix, win32 } from 'node:path'
import { fileURLToPath } from 'node:url'
import semver from 'semver'
import { codexTargetTriple, PRODUCT_CLIS, productCliPackage } from './catalog.ts'
import { downloadedProductCliPath } from './store.ts'
import type { ProductCliId, ProductCliRejectedCandidate, ProductCliSource } from './types.ts'

/** How to start a resolved executable: `command` followed by `args`, then the caller's own arguments. */
export interface ProductCliLaunch {
  readonly command: string
  readonly args: readonly string[]
}

/** Outcome of {@link resolveProductCli}. */
export type ProductCliResolution =
  | {
    readonly found: true
    readonly id: ProductCliId
    readonly source: ProductCliSource
    /** Absolute executable path; a JavaScript entry for npm wrapper installs. */
    readonly path: string
    /** Version the executable reported or the pinned version of a Stitch or checkout copy. */
    readonly version?: string
    readonly launch: ProductCliLaunch
    readonly tooOld: readonly ProductCliRejectedCandidate[]
  }
  | {
    readonly found: false
    readonly id: ProductCliId
    readonly tooOld: readonly ProductCliRejectedCandidate[]
    /** The configured `executablePath`, when it names no file; resolution then stops there. */
    readonly configuredMissing?: string
  }

/** File-system and process reads resolution performs; tests replace them to model other platforms. */
export interface ProductCliHost {
  /** Whether `path` is an existing regular file (following links). */
  isFile(path: string): boolean
  /** UTF-8 file text, or undefined when unreadable. */
  readText(path: string): string | undefined
  /** Canonical path, or the input when it cannot be resolved. */
  realpath(path: string): string
  /** Cache key that changes when the file is replaced, or undefined when absent. */
  fingerprint(path: string): string | undefined
  /** Run a launch with `--version` and return its output, or undefined when it fails. */
  version(launch: ProductCliLaunch, env: NodeJS.ProcessEnv): Promise<string | undefined>
}

/** Inputs of {@link resolveProductCli}; omitted fields describe the running process. */
export interface ProductCliResolveOptions {
  /** Explicit executable configured for the provider; when set, nothing else is searched. */
  readonly executablePath?: string | undefined
  /** Stitch home override; omission uses `$STITCH_HOME`, then `~/.stitch`. */
  readonly dshHome?: string | undefined
  /** Environment supplying PATH, PATHEXT, APPDATA, LOCALAPPDATA, and npm prefix variables. */
  readonly env?: NodeJS.ProcessEnv
  readonly platform?: NodeJS.Platform
  readonly arch?: string
  /** User home directory for well-known install locations. */
  readonly homeDir?: string
  /**
   * File or `file:` URL inside the subagent package whose module resolution can
   * see the SDK (`@anthropic-ai/claude-agent-sdk` or `@openai/codex`); enables
   * the development-checkout source.
   */
  readonly bundledFrom?: string
  /** Node executable that runs JavaScript wrappers; defaults to `process.execPath`. */
  readonly nodePath?: string
  readonly host?: ProductCliHost
}

const VERSION_TIMEOUT_MS = 15_000
const VERSION_PATTERN = /\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?/

function fileIsRegular(path: string): boolean {
  try {
    return statSync(path).isFile()
  } catch (_missing) {
    // An unreadable candidate is not a usable executable.
    return false
  }
}

function fileText(path: string): string | undefined {
  try {
    return readFileSync(path, 'utf8')
  } catch (_unreadable) {
    // A missing manifest or shim means the candidate has no readable target.
    return undefined
  }
}

function canonical(path: string): string {
  try {
    return realpathSync(path)
  } catch (_unresolvable) {
    // The caller already checked existence; a racing removal keeps the given path.
    return path
  }
}

function fileFingerprint(path: string): string | undefined {
  try {
    const stat = statSync(path)
    return `${stat.size}:${stat.mtimeMs}:${stat.ino}`
  } catch (_missing) {
    // A vanished file has no cache entry.
    return undefined
  }
}

function runVersion(launch: ProductCliLaunch, env: NodeJS.ProcessEnv): Promise<string | undefined> {
  const { promise, resolve } = Promise.withResolvers<string | undefined>()
  execFile(launch.command, [...launch.args, '--version'], {
    env, timeout: VERSION_TIMEOUT_MS, windowsHide: true, maxBuffer: 64 * 1024,
  }, (error, stdout) => { resolve(error === null ? stdout : undefined) })
  return promise
}

/** Resolution through the real file system and real `--version` runs. */
export const NODE_PRODUCT_CLI_HOST: ProductCliHost = {
  isFile: fileIsRegular,
  readText: fileText,
  realpath: canonical,
  fingerprint: fileFingerprint,
  version: runVersion,
}

const versionCache = new Map<string, Promise<string | undefined>>()

/**
 * Read a CLI version once per executable file revision.
 * @param host - file and process reads.
 * @param path - executable whose fingerprint keys the cache.
 * @param launch - command that runs it.
 * @param env - child environment.
 * @returns the version text, or undefined when the executable does not run or prints no version.
 */
async function cachedVersion(
  host: ProductCliHost, path: string, launch: ProductCliLaunch, env: NodeJS.ProcessEnv,
): Promise<string | undefined> {
  const fingerprint = host.fingerprint(path)
  if (fingerprint === undefined) return undefined
  const key = `${path}\0${fingerprint}\0${launch.command}`
  let pending = versionCache.get(key)
  if (pending === undefined) {
    pending = host.version(launch, env).then(output => output?.match(VERSION_PATTERN)?.[0])
    if (host === NODE_PRODUCT_CLI_HOST) versionCache.set(key, pending)
  }
  return await pending
}

function envValue(env: NodeJS.ProcessEnv, name: string, platform: NodeJS.Platform): string | undefined {
  if (platform !== 'win32') return env[name]
  const key = Object.keys(env).find(candidate => candidate.toUpperCase() === name)
  return key === undefined ? undefined : env[key]
}

const JS_EXTENSIONS = ['.js', '.mjs', '.cjs']

function isJavaScript(host: ProductCliHost, path: string): boolean {
  if (JS_EXTENSIONS.some(extension => path.toLowerCase().endsWith(extension))) return true
  const head = host.readText(path)?.slice(0, 256)
  return head?.startsWith('#!') === true && /\bnode\b/.test(head.split('\n', 1)[0] as string)
}

/**
 * The executable an npm Windows shim (`<prefix>\<command>.cmd` or `.ps1`) starts:
 * the `bin` entry of the global package installed beside it.
 */
function npmShimTarget(host: ProductCliHost, shim: string, id: ProductCliId): string | undefined {
  const definition = PRODUCT_CLIS[id]
  const packageDir = win32.join(win32.dirname(shim), 'node_modules', ...definition.globalPackage.split('/'))
  const text = host.readText(win32.join(packageDir, 'package.json'))
  if (text === undefined) return undefined
  let manifest: { bin?: unknown }
  try {
    manifest = JSON.parse(text) as { bin?: unknown }
  } catch (_malformed) {
    // A damaged global install is skipped like an absent one.
    return undefined
  }
  const bin = typeof manifest.bin === 'string'
    ? manifest.bin
    : manifest.bin !== null && typeof manifest.bin === 'object'
      ? (manifest.bin as Record<string, unknown>)[definition.command]
      : undefined
  if (typeof bin !== 'string') return undefined
  const target = win32.join(packageDir, bin)
  return host.isFile(target) ? target : undefined
}

/**
 * The launch for an executable path, or undefined when it cannot be started without a shell.
 * JavaScript wrappers run under `nodePath`; Windows `.cmd`/`.ps1` npm shims are followed to their package entry.
 */
function launchFor(host: ProductCliHost, path: string, id: ProductCliId, platform: NodeJS.Platform, nodePath: string):
  { readonly path: string; readonly launch: ProductCliLaunch } | undefined {
  let target = path
  if (platform === 'win32') {
    const lower = path.toLowerCase()
    if (lower.endsWith('.cmd') || lower.endsWith('.bat') || lower.endsWith('.ps1')) {
      const shimTarget = npmShimTarget(host, path, id)
      if (shimTarget === undefined) return undefined
      target = shimTarget
    }
  } else {
    target = host.realpath(path)
  }
  return isJavaScript(host, target)
    ? { path: target, launch: { command: nodePath, args: [target] } }
    : { path: target, launch: { command: target, args: [] } }
}

/** Ordered user-install candidates: PATH entries, then well-known locations. */
function installCandidates(id: ProductCliId, env: NodeJS.ProcessEnv, platform: NodeJS.Platform, home: string): string[] {
  const command = PRODUCT_CLIS[id].command
  const path = platform === 'win32' ? win32 : posix
  const directories: string[] = []
  for (const entry of (envValue(env, 'PATH', platform) ?? '').split(path.delimiter)) {
    // Relative PATH entries would resolve against the workspace; never run those.
    const directory = entry.replace(/^"(.*)"$/, '$1')
    if (directory !== '' && path.isAbsolute(directory)) directories.push(directory)
  }
  const prefix = envValue(env, 'NPM_CONFIG_PREFIX', platform) ?? envValue(env, 'npm_config_prefix', platform)
  if (platform === 'win32') {
    const appData = envValue(env, 'APPDATA', platform) ?? win32.join(home, 'AppData', 'Roaming')
    const localAppData = envValue(env, 'LOCALAPPDATA', platform) ?? win32.join(home, 'AppData', 'Local')
    directories.push(
      win32.join(home, '.local', 'bin'),
      win32.join(appData, 'npm'),
      ...prefix === undefined ? [] : [prefix],
      win32.join(localAppData, 'Programs', command),
      win32.join(localAppData, 'Microsoft', 'WinGet', 'Links'),
    )
    const extensions = ['.exe', ...(envValue(env, 'PATHEXT', platform) ?? '.COM;.EXE;.BAT;.CMD')
      .split(';').map(extension => extension.toLowerCase()).filter(extension => extension !== '' && extension !== '.exe'), '.ps1']
    return [...new Set(directories.flatMap(directory => extensions.map(extension => win32.join(directory, `${command}${extension}`))))]
  }
  if (id === 'claude-code') directories.push(posix.join(home, '.claude', 'local'))
  directories.push(
    posix.join(home, '.local', 'bin'),
    '/opt/homebrew/bin',
    '/usr/local/bin',
    ...prefix === undefined ? [] : [posix.join(prefix, 'bin')],
    posix.join(home, '.npm-global', 'bin'),
  )
  return [...new Set(directories.map(directory => posix.join(directory, command)))]
}

/**
 * The directory of package `name` as seen from `dir`: the first
 * `node_modules/<name>` in `dir` or an ancestor, canonicalized like Node's own
 * resolution. Unlike `require.resolve` it never consults NODE_PATH or the
 * global folders, so a package manager's or launcher's own install (pnpm puts
 * its whole store on NODE_PATH) cannot answer for the anchor.
 */
function packageDirFrom(host: ProductCliHost, dir: string, name: string): string | undefined {
  for (let current = dir; ; current = dirname(current)) {
    if (basename(current) !== 'node_modules') {
      const candidate = join(current, 'node_modules', name)
      if (host.isFile(join(candidate, 'package.json'))) return host.realpath(candidate)
    }
    if (dirname(current) === current) return undefined
  }
}

/**
 * The native package installed beside the SDK in a development checkout or CLI
 * install, when present. Both the SDK and its platform package are looked up
 * only above `from`, so the answer depends on the anchor alone.
 */
function bundledExecutable(
  host: ProductCliHost, id: ProductCliId, from: string, platform: NodeJS.Platform, arch: string,
): string | undefined {
  const anchor = from.startsWith('file:') ? fileURLToPath(from) : from
  if (!isAbsolute(anchor)) return undefined
  const key = `${platform}-${arch}`
  const suffix = platform === 'win32' ? '.exe' : ''
  if (id === 'claude-code') {
    const sdk = packageDirFrom(host, dirname(anchor), '@anthropic-ai/claude-agent-sdk')
    if (sdk === undefined) return undefined
    for (const name of platform === 'linux' ? [key, `${key}-musl`] : [key]) {
      const native = packageDirFrom(host, sdk, `@anthropic-ai/claude-agent-sdk-${name}`)
      const executable = native === undefined ? undefined : join(native, `claude${suffix}`)
      if (executable !== undefined && host.isFile(executable)) return executable
    }
    return undefined
  }
  const triple = codexTargetTriple(key)
  if (triple === undefined) return undefined
  const codex = packageDirFrom(host, dirname(anchor), '@openai/codex')
  // Packaged installations omit the native platform packages.
  const native = codex === undefined ? undefined : packageDirFrom(host, codex, `@openai/codex-${key}`)
  const executable = native === undefined ? undefined : join(native, 'vendor', triple, 'bin', `codex${suffix}`)
  return executable !== undefined && host.isFile(executable) ? executable : undefined
}

/**
 * Whether a reported version meets a minimum.
 * @param version - version text a CLI reported.
 * @param minimum - oldest accepted version.
 * @returns true when `version` is at least `minimum`, ignoring prerelease tags.
 */
export function meetsMinimumVersion(version: string, minimum: string): boolean {
  const parsed = semver.coerce(version)
  return parsed !== null && semver.gte(parsed, minimum)
}

/**
 * Find the executable a product subagent runs. Every call re-checks the file
 * system; `--version` output is cached per executable file revision.
 * @param id - product CLI.
 * @param options - configured path, Stitch home, environment, platform, and development-checkout anchor.
 * @returns the executable and how to launch it, or the reason none is usable.
 */
export async function resolveProductCli(id: ProductCliId, options: ProductCliResolveOptions = {}): Promise<ProductCliResolution> {
  const host = options.host ?? NODE_PRODUCT_CLI_HOST
  const platform = options.platform ?? process.platform
  const arch = options.arch ?? process.arch
  const env = options.env ?? process.env
  const nodePath = options.nodePath ?? process.execPath
  const definition = PRODUCT_CLIS[id]
  const tooOld: ProductCliRejectedCandidate[] = []

  const configured = options.executablePath
  if (configured !== undefined && configured !== '') {
    const resolved = host.isFile(configured) ? launchFor(host, configured, id, platform, nodePath) : undefined
    if (resolved === undefined) return { found: false, id, tooOld, configuredMissing: configured }
    const version = await cachedVersion(host, resolved.path, resolved.launch, env)
    return { found: true, id, source: 'configured', ...resolved, ...version === undefined ? {} : { version }, tooOld }
  }

  const pinned = productCliPackage(id, platform, arch)
  if (pinned !== undefined) {
    const downloaded = downloadedProductCliPath(id, pinned, { dshHome: options.dshHome })
    if (host.isFile(downloaded)) {
      return { found: true, id, source: 'downloaded', path: downloaded, version: definition.downloadVersion,
        launch: { command: downloaded, args: [] }, tooOld }
    }
  }

  const seen = new Set<string>()
  for (const candidate of installCandidates(id, env, platform, options.homeDir ?? homedir())) {
    if (!host.isFile(candidate)) continue
    const resolved = launchFor(host, candidate, id, platform, nodePath)
    if (resolved === undefined || seen.has(resolved.path)) continue
    seen.add(resolved.path)
    const version = await cachedVersion(host, resolved.path, resolved.launch, env)
    if (version === undefined) continue
    if (!meetsMinimumVersion(version, definition.minimumVersion)) {
      tooOld.push({ path: resolved.path, version })
      continue
    }
    return { found: true, id, source: 'installed', ...resolved, version, tooOld }
  }

  if (options.bundledFrom !== undefined) {
    const bundled = bundledExecutable(host, id, options.bundledFrom, platform, arch)
    if (bundled !== undefined) {
      return { found: true, id, source: 'bundled', path: bundled, version: definition.downloadVersion,
        launch: { command: bundled, args: [] }, tooOld }
    }
  }
  return { found: false, id, tooOld }
}
