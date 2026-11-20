import { chmodSync, mkdirSync, mkdtempSync, realpathSync, rmSync, symlinkSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, win32 } from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  downloadedProductCliPath,
  meetsMinimumVersion,
  NODE_PRODUCT_CLI_HOST,
  PRODUCT_CLIS,
  productCliMissingMessage,
  productCliPackage,
  productCliStatus,
  resolveProductCli,
  type ProductCliHost,
  type ProductCliResolution,
} from '../src/index.ts'

const posixOnly = process.platform === 'win32' ? describe.skip : describe

let root: string
let home: string
let dshHome: string
let bin: string

beforeEach(() => {
  root = realpathSync(mkdtempSync(join(tmpdir(), 'product-cli-resolve-')))
  home = join(root, 'home')
  dshHome = join(root, 'stitch-home')
  bin = join(root, 'bin')
  mkdirSync(home, { recursive: true })
  mkdirSync(bin, { recursive: true })
})

afterEach(() => {
  rmSync(root, { recursive: true, force: true })
})

/** A POSIX executable that prints `output` for `--version`. */
function fakeCli(path: string, output: string): string {
  mkdirSync(join(path, '..'), { recursive: true })
  writeFileSync(path, `#!/bin/sh\necho '${output}'\n`)
  chmodSync(path, 0o755)
  return path
}

function missing(resolution: ProductCliResolution): Extract<ProductCliResolution, { found: false }> {
  if (resolution.found) throw new Error(`expected no executable, found ${resolution.path}`)
  return resolution
}

posixOnly('resolveProductCli order', () => {
  it('uses the configured executablePath before every other source', async () => {
    const configured = fakeCli(join(root, 'custom', 'claude'), '2.0.0 (Claude Code)')
    fakeCli(join(bin, 'claude'), '2.1.400 (Claude Code)')
    const resolution = await resolveProductCli('claude-code', {
      executablePath: configured, env: { PATH: bin }, homeDir: home, dshHome,
    })
    expect(resolution).toMatchObject({ found: true, source: 'configured', path: configured, version: '2.0.0', launch: { command: configured, args: [] } })
  })

  it('stops at a configured path that names no file', async () => {
    fakeCli(join(bin, 'claude'), '2.1.400 (Claude Code)')
    const configured = join(root, 'nowhere', 'claude')
    const resolution = missing(await resolveProductCli('claude-code', { executablePath: configured, env: { PATH: bin }, homeDir: home, dshHome }))
    expect(resolution.configuredMissing).toBe(configured)
    expect(productCliMissingMessage(resolution)).toContain(`configured executablePath ${configured}`)
  })

  it('prefers a Stitch download over the user install', async () => {
    const pinned = productCliPackage('codex', process.platform, process.arch)
    if (pinned === undefined) return
    const downloaded = fakeCli(downloadedProductCliPath('codex', pinned, { dshHome }), 'codex-cli 0.153.4')
    fakeCli(join(bin, 'codex'), 'codex-cli 0.200.0')
    const resolution = await resolveProductCli('codex', { env: { PATH: bin }, homeDir: home, dshHome })
    expect(resolution).toMatchObject({ found: true, source: 'downloaded', path: downloaded, version: '0.153.4' })
  })

  it('skips an install older than the minimum, records it, and uses the next one', async () => {
    const old = join(root, 'old-bin')
    const oldClaude = fakeCli(join(old, 'claude'), '2.0.14 (Claude Code)')
    const current = fakeCli(join(bin, 'claude'), '2.1.328 (Claude Code)')
    const resolution = await resolveProductCli('claude-code', { env: { PATH: `${old}:relative/bin:${bin}` }, homeDir: home, dshHome })
    expect(resolution).toMatchObject({
      found: true, source: 'installed', path: current, version: '2.1.328',
      tooOld: [{ path: oldClaude, version: '2.0.14' }],
    })
  })

  it('treats an install that is too old as absent and says so', async () => {
    const oldClaude = fakeCli(join(bin, 'claude'), '1.0.0 (Claude Code)')
    const resolution = missing(await resolveProductCli('claude-code', { env: { PATH: bin }, homeDir: home, dshHome }))
    expect(resolution.tooOld).toEqual([{ path: oldClaude, version: '1.0.0' }])
    expect(productCliMissingMessage(resolution, 'darwin', 'arm64')).toBe(
      "Claude Code isn't installed. Install it from Plugins → Claude Code subagent → Download (about 199 MB), or install it yourself: "
      + `npm install -g @anthropic-ai/claude-code, then retry. Found Claude Code 1.0.0 at ${oldClaude}, but Stitch needs ${PRODUCT_CLIS['claude-code'].minimumVersion} or newer.`,
    )
  })

  it('finds well-known locations when PATH does not list them', async () => {
    const local = fakeCli(join(home, '.claude', 'local', 'claude'), '2.1.300 (Claude Code)')
    const resolution = await resolveProductCli('claude-code', { env: { PATH: '' }, homeDir: home, dshHome })
    expect(resolution).toMatchObject({ found: true, source: 'installed', path: local })
  })

  it('ignores relative PATH entries', async () => {
    const cwdBin = join(root, 'relative')
    fakeCli(join(cwdBin, 'codex'), 'codex-cli 0.200.0')
    const previous = process.cwd()
    process.chdir(root)
    try {
      expect((await resolveProductCli('codex', { env: { PATH: 'relative' }, homeDir: home, dshHome })).found).toBe(false)
    } finally {
      process.chdir(previous)
    }
  })

  it('runs an npm JavaScript wrapper under Node, through its symlink', async () => {
    const wrapper = join(root, 'lib', 'node_modules', '@openai', 'codex', 'bin', 'codex.js')
    mkdirSync(join(wrapper, '..'), { recursive: true })
    writeFileSync(wrapper, '#!/usr/bin/env node\nconsole.log("codex-cli 0.169.0")\n')
    symlinkSync(wrapper, join(bin, 'codex'))
    const resolution = await resolveProductCli('codex', { env: { PATH: bin }, homeDir: home, dshHome, nodePath: process.execPath })
    expect(resolution).toMatchObject({
      found: true, source: 'installed', version: '0.169.0',
      launch: { command: process.execPath, args: [expect.stringMatching(/codex\.js$/)] },
    })
  })

  it('skips a candidate that does not run', async () => {
    const broken = join(bin, 'codex')
    writeFileSync(broken, '#!/bin/sh\nexit 3\n')
    chmodSync(broken, 0o755)
    expect((await resolveProductCli('codex', { env: { PATH: bin }, homeDir: home, dshHome })).found).toBe(false)
  })

  it('uses the native package installed beside the SDK in a development checkout last', async () => {
    const modules = join(root, 'checkout', 'node_modules')
    const anchor = join(root, 'checkout', 'subagent', 'index.js')
    mkdirSync(join(anchor, '..'), { recursive: true })
    writeFileSync(anchor, '')
    mkdirSync(join(modules, '@openai', 'codex'), { recursive: true })
    writeFileSync(join(modules, '@openai', 'codex', 'package.json'), '{"name":"@openai/codex","version":"0.153.4"}')
    const platformDir = join(modules, '@openai', 'codex-darwin-arm64')
    mkdirSync(platformDir, { recursive: true })
    writeFileSync(join(platformDir, 'package.json'), '{"name":"@openai/codex","version":"0.153.4-darwin-arm64"}')
    const native = fakeCli(join(platformDir, 'vendor', 'aarch64-apple-darwin', 'bin', 'codex'), 'codex-cli 0.153.4')
    const resolution = await resolveProductCli('codex', {
      env: { PATH: '' }, homeDir: home, dshHome, bundledFrom: anchor, platform: 'darwin', arch: 'arm64',
    })
    expect(resolution).toMatchObject({ found: true, source: 'bundled', path: native, launch: { command: native, args: [] } })
  })

  it('finds the Claude native package beside the SDK, trying the musl variant on Linux', async () => {
    const modules = join(root, 'checkout', 'node_modules')
    const anchor = join(root, 'checkout', 'subagent', 'index.js')
    mkdirSync(join(anchor, '..'), { recursive: true })
    writeFileSync(anchor, '')
    const sdk = join(modules, '@anthropic-ai', 'claude-agent-sdk')
    mkdirSync(sdk, { recursive: true })
    writeFileSync(join(sdk, 'package.json'), '{"name":"@anthropic-ai/claude-agent-sdk","main":"sdk.mjs"}')
    writeFileSync(join(sdk, 'sdk.mjs'), '')
    const musl = join(modules, '@anthropic-ai', 'claude-agent-sdk-linux-x64-musl')
    mkdirSync(musl, { recursive: true })
    writeFileSync(join(musl, 'package.json'), '{"name":"@anthropic-ai/claude-agent-sdk-linux-x64-musl"}')
    const native = fakeCli(join(musl, 'claude'), '2.1.263 (Claude Code)')
    const resolution = await resolveProductCli('claude-code', {
      env: { PATH: '' }, homeDir: home, dshHome, bundledFrom: anchor, platform: 'linux', arch: 'x64',
    })
    expect(resolution).toMatchObject({ found: true, source: 'bundled', path: native })
  })

  it('reads a version once per executable revision and reports none for a configured file that does not run', async () => {
    const claude = fakeCli(join(bin, 'claude'), '2.1.300 (Claude Code)')
    const first = await resolveProductCli('claude-code', { env: { PATH: bin }, homeDir: home, dshHome })
    writeFileSync(join(root, 'marker'), '')
    const second = await resolveProductCli('claude-code', { env: { PATH: bin }, homeDir: home, dshHome })
    expect(second).toEqual(first)
    const silent = join(root, 'silent')
    writeFileSync(silent, '')
    const configured = await resolveProductCli('claude-code', { executablePath: silent, env: { PATH: bin }, homeDir: home, dshHome })
    expect(configured).toMatchObject({ found: true, source: 'configured', path: silent })
    expect(configured).not.toHaveProperty('version')
    expect(first).toMatchObject({ path: claude })
  })

  it('looks in the npm prefix bin directory', async () => {
    const prefix = join(root, 'npm-prefix')
    const codex = fakeCli(join(prefix, 'bin', 'codex'), 'codex-cli 0.160.0')
    expect(await resolveProductCli('codex', { env: { PATH: '', npm_config_prefix: prefix }, homeDir: home, dshHome }))
      .toMatchObject({ found: true, path: codex })
  })

  it('reads PATH, HOME, and the Stitch home from the running process when not given', async () => {
    vi.stubEnv('PATH', bin)
    vi.stubEnv('HOME', home)
    vi.stubEnv('STITCH_HOME', dshHome)
    try {
      const codex = fakeCli(join(home, '.local', 'bin', 'codex'), 'codex-cli 0.160.0')
      expect(await productCliStatus('codex')).toMatchObject({ available: true, path: codex })
    } finally {
      vi.unstubAllEnvs()
    }
  })

  it('finds Windows native packages beside the SDK and reports absent ones', async () => {
    const modules = join(root, 'checkout', 'node_modules')
    const anchor = join(root, 'checkout', 'subagent', 'index.js')
    mkdirSync(join(anchor, '..'), { recursive: true })
    writeFileSync(anchor, '')
    const sdk = join(modules, '@anthropic-ai', 'claude-agent-sdk')
    mkdirSync(sdk, { recursive: true })
    writeFileSync(join(sdk, 'package.json'), '{"name":"@anthropic-ai/claude-agent-sdk","main":"sdk.mjs"}')
    writeFileSync(join(sdk, 'sdk.mjs'), '')
    const claudeDir = join(modules, '@anthropic-ai', 'claude-agent-sdk-win32-x64')
    mkdirSync(claudeDir, { recursive: true })
    writeFileSync(join(claudeDir, 'package.json'), '{}')
    writeFileSync(join(claudeDir, 'claude.exe'), 'MZ')
    mkdirSync(join(modules, '@openai', 'codex'), { recursive: true })
    writeFileSync(join(modules, '@openai', 'codex', 'package.json'), '{}')
    const codexDir = join(modules, '@openai', 'codex-win32-x64')
    mkdirSync(join(codexDir, 'vendor', 'x86_64-pc-windows-msvc', 'bin'), { recursive: true })
    writeFileSync(join(codexDir, 'package.json'), '{}')
    const base = { env: { PATH: '' }, homeDir: home, dshHome, bundledFrom: anchor, platform: 'win32', arch: 'x64' } as const
    expect(await resolveProductCli('claude-code', base)).toMatchObject({ found: true, source: 'bundled', path: join(claudeDir, 'claude.exe') })
    expect((await resolveProductCli('codex', base)).found).toBe(false)
    writeFileSync(join(codexDir, 'vendor', 'x86_64-pc-windows-msvc', 'bin', 'codex.exe'), 'MZ')
    expect(await resolveProductCli('codex', base))
      .toMatchObject({ found: true, path: join(codexDir, 'vendor', 'x86_64-pc-windows-msvc', 'bin', 'codex.exe') })
    expect((await resolveProductCli('claude-code', { ...base, platform: 'linux', arch: 'riscv64' })).found).toBe(false)
    expect((await resolveProductCli('codex', { ...base, platform: 'freebsd' })).found).toBe(false)
    expect((await resolveProductCli('codex', { ...base, bundledFrom: 'relative.js' })).found).toBe(false)
  })

  it('reports nothing found with the official install command', async () => {
    const resolution = missing(await resolveProductCli('codex', { env: { PATH: bin }, homeDir: home, dshHome }))
    expect(productCliMissingMessage(resolution, 'darwin', 'arm64')).toBe(
      "Codex isn't installed. Install it from Plugins → Codex subagent → Download (about 288 MB), or install it yourself: npm install -g @openai/codex, then retry.",
    )
    expect(productCliMissingMessage(resolution, 'freebsd', 'x64')).toBe("Codex isn't installed. Install it yourself: npm install -g @openai/codex, then retry.")
  })

  it('describes status for the UI', async () => {
    fakeCli(join(bin, 'claude'), '2.1.328 (Claude Code)')
    const status = await productCliStatus('claude-code', { env: { PATH: bin }, homeDir: home, dshHome, platform: 'darwin', arch: 'arm64' })
    expect(status).toEqual({
      id: 'claude-code',
      bundle: '@deepseek-ai/dsh-subagent-claude-code',
      displayName: 'Claude Code',
      available: true,
      source: 'installed',
      path: join(bin, 'claude'),
      version: '2.1.328',
      tooOld: [],
      minimumVersion: PRODUCT_CLIS['claude-code'].minimumVersion,
      download: { version: '2.1.263', sizeBytes: 199258568 },
      downloaded: false,
      installCommand: 'npm install -g @anthropic-ai/claude-code',
    })
    const none = await productCliStatus('codex', { env: { PATH: '' }, homeDir: home, dshHome, platform: 'freebsd', arch: 'x64' })
    expect(none).toMatchObject({ available: false, download: null, downloaded: false })
    expect(none).not.toHaveProperty('source')
  })
})

describe('resolveProductCli on Windows path shapes', () => {
  const user = 'C:\\Users\\ada'
  const appData = `${user}\\AppData\\Roaming`

  function windowsHost(files: Record<string, string>, versions: Record<string, string>): ProductCliHost {
    const lookup = (path: string): string | undefined => {
      const key = Object.keys(files).find(candidate => candidate.toLowerCase() === path.toLowerCase())
      return key === undefined ? undefined : files[key]
    }
    return {
      isFile: path => lookup(path) !== undefined,
      readText: lookup,
      realpath: path => path,
      fingerprint: path => lookup(path) === undefined ? undefined : 'f',
      version: launch => Promise.resolve(versions[launch.args[0] ?? launch.command]),
    }
  }

  it('follows an npm .cmd shim in %APPDATA%\\npm to its JavaScript entry, reading Path case-insensitively', async () => {
    const shim = win32.join(appData, 'npm', 'codex.cmd')
    const entry = win32.join(appData, 'npm', 'node_modules', '@openai', 'codex', 'bin', 'codex.js')
    const host = windowsHost({
      [shim]: '@ECHO off\r\n',
      [win32.join(appData, 'npm', 'node_modules', '@openai', 'codex', 'package.json')]: '{"bin":{"codex":"bin/codex.js"}}',
      [entry]: '#!/usr/bin/env node\n',
    }, { [entry]: 'codex-cli 0.160.0' })
    const resolution = await resolveProductCli('codex', {
      platform: 'win32', arch: 'x64', homeDir: user, host, nodePath: 'C:\\Program Files\\Stitch\\node.exe',
      env: { Path: 'C:\\Windows\\System32;.\\local', PATHEXT: '.COM;.EXE;.BAT;.CMD', APPDATA: appData },
    })
    expect(resolution).toMatchObject({
      found: true, source: 'installed', path: entry, version: '0.160.0',
      launch: { command: 'C:\\Program Files\\Stitch\\node.exe', args: [entry] },
    })
  })

  it('runs a native claude.exe from %USERPROFILE%\\.local\\bin directly', async () => {
    const exe = win32.join(user, '.local', 'bin', 'claude.exe')
    const host = windowsHost({ [exe]: 'MZ' }, { [exe]: '2.1.300 (Claude Code)' })
    const resolution = await resolveProductCli('claude-code', { platform: 'win32', arch: 'x64', homeDir: user, host, env: {} })
    expect(resolution).toMatchObject({ found: true, source: 'installed', path: exe, launch: { command: exe, args: [] } })
  })

  it('follows the Claude Code npm shim to its native bin entry and quotes PATH entries', async () => {
    const prefix = 'D:\\npm prefix'
    const shim = win32.join(prefix, 'claude.cmd')
    const exe = win32.join(prefix, 'node_modules', '@anthropic-ai', 'claude-code', 'bin', 'claude.exe')
    const host = windowsHost({
      [shim]: '',
      [win32.join(prefix, 'node_modules', '@anthropic-ai', 'claude-code', 'package.json')]: '{"bin":"bin/claude.exe"}',
      [exe]: 'MZ',
    }, { [exe]: '2.1.329 (Claude Code)' })
    const resolution = await resolveProductCli('claude-code', { platform: 'win32', arch: 'x64', homeDir: user, host, env: { PATH: `"${prefix}"` } })
    expect(resolution).toMatchObject({ found: true, path: exe, launch: { command: exe, args: [] } })
  })

  it('skips shims it cannot follow and too-old versions', async () => {
    const shim = win32.join(appData, 'npm', 'claude.cmd')
    const brokenShim = win32.join(user, 'tools', 'claude.cmd')
    const old = win32.join(user, 'old', 'claude.exe')
    const host = windowsHost({
      [old]: 'MZ',
      [shim]: '',
      [win32.join(appData, 'npm', 'node_modules', '@anthropic-ai', 'claude-code', 'package.json')]: '{not json',
      [brokenShim]: '',
      [win32.join(user, 'tools', 'node_modules', '@anthropic-ai', 'claude-code', 'package.json')]: '{"bin":{"other":"x"}}',
    }, { [old]: '2.0.1 (Claude Code)' })
    const resolution = missing(await resolveProductCli('claude-code', {
      platform: 'win32', arch: 'arm64', homeDir: user, host,
      env: { PATH: `${win32.join(user, 'old')};${win32.join(user, 'tools')}`, APPDATA: appData },
    }))
    expect(resolution.tooOld).toEqual([{ path: old, version: '2.0.1' }])
    expect(productCliMissingMessage(resolution, 'win32', 'arm64')).toContain('about 210 MB')
  })
})

describe('resolveProductCli on Windows edge cases', () => {
  it('skips shims without a usable package and files that vanished', async () => {
    const user = 'C:\\Users\\ada'
    const prefix = 'E:\\npm'
    const files: Record<string, string> = {
      [win32.join(user, 'a', 'codex.cmd')]: '',
      [win32.join(user, 'b', 'codex.ps1')]: '',
      [win32.join(user, 'b', 'node_modules', '@openai', 'codex', 'package.json')]: '{}',
      [win32.join(prefix, 'codex.cmd')]: '',
      [win32.join(prefix, 'node_modules', '@openai', 'codex', 'package.json')]: '{"bin":{"codex":"bin/missing.js"}}',
      [win32.join(user, 'c', 'codex.exe')]: 'MZ',
    }
    const host: ProductCliHost = {
      isFile: path => path in files,
      readText: path => files[path],
      realpath: path => path,
      fingerprint: () => undefined,
      version: () => Promise.resolve('codex-cli 0.200.0'),
    }
    const resolution = await resolveProductCli('codex', {
      platform: 'win32', arch: 'x64', homeDir: user, host,
      env: { PATH: [win32.join(user, 'a'), win32.join(user, 'b'), win32.join(user, 'c')].join(';'), NPM_CONFIG_PREFIX: prefix, LOCALAPPDATA: 'C:\\Local' },
    })
    expect(resolution).toEqual({ found: false, id: 'codex', tooOld: [] })
  })
})

describe('meetsMinimumVersion', () => {
  it('compares release versions and ignores prerelease tags and noise', () => {
    expect(meetsMinimumVersion('2.1.263', '2.1.263')).toBe(true)
    expect(meetsMinimumVersion('2.1.262', '2.1.263')).toBe(false)
    expect(meetsMinimumVersion('0.170.0-alpha.1', '0.153.4')).toBe(true)
    expect(meetsMinimumVersion('unknown', '0.153.4')).toBe(false)
  })
})

describe('NODE_PRODUCT_CLI_HOST', () => {
  it('reads absent files as absent', () => {
    const absent = join(tmpdir(), `product-cli-absent-${process.pid}`)
    expect(NODE_PRODUCT_CLI_HOST.isFile(absent)).toBe(false)
    expect(NODE_PRODUCT_CLI_HOST.readText(absent)).toBeUndefined()
    expect(NODE_PRODUCT_CLI_HOST.realpath(absent)).toBe(absent)
    expect(NODE_PRODUCT_CLI_HOST.fingerprint(absent)).toBeUndefined()
  })
})
