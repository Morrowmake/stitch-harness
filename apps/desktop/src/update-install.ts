/**
 * One-click update installation: download a verified release asset, stage it, and hand over to a detached helper
 * that replaces the application after this process exits. Every failure before the helper runs leaves the
 * installed version untouched; the helper itself restores the previous bundle when replacement fails.
 */
import { spawn as spawnProcess, execFile as execFileCallback } from 'node:child_process'
import { constants } from 'node:fs'
import { access as accessPath, mkdir, open, readdir, readFile, rm, writeFile } from 'node:fs/promises'
import { basename, dirname, join, win32 } from 'node:path'
import { promisify } from 'node:util'
import { releaseAssetUrl, type DesktopRelease, type DesktopReleaseInstall, type DesktopUpdateFetch } from './update-check.ts'
import { verifyUpdateAsset } from './update-manifest.ts'

/** Bundle identifier every staged macOS update must carry. */
export const STITCH_BUNDLE_ID = 'io.github.morrowmake.stitch'
const DOWNLOAD_TIMEOUT_MS = 30 * 60 * 1000
/** How long the helper waits for this process to exit before giving up without changes. */
const EXIT_WAIT_SECONDS = 120

/** Why a found release can only be downloaded manually. */
export type UpdateInstallBlocker =
  | { readonly kind: 'unavailable' }
  | { readonly kind: 'not-writable'; readonly path: string }

/** Progress reported while preparing an update. */
export type UpdateProgress =
  | { readonly phase: 'download'; readonly fraction: number }
  | { readonly phase: 'verify' }
  | { readonly phase: 'stage' }

/** Detached process that installs the staged update after this process exits. */
export interface UpdateInstallPlan {
  readonly command: string
  readonly args: readonly string[]
  /** Helper script written before spawning, when the plan needs one. */
  readonly script?: { readonly path: string; readonly content: string }
}

/**
 * @param execPath - `process.execPath` of a packaged macOS app.
 * @returns The enclosing `.app` bundle, or undefined outside a bundle.
 */
export function darwinAppBundle(execPath: string): string | undefined {
  const macos = dirname(execPath)
  const contents = dirname(macos)
  const bundle = dirname(contents)
  return basename(macos) === 'MacOS' && basename(contents) === 'Contents' && bundle.endsWith('.app') ? bundle : undefined
}

/** POSIX single-quoted shell word. */
const shellQuote = (value: string): string => `'${value.replaceAll('\'', '\'\\\'\'')}'`

/**
 * Build the macOS helper: wait for `pid` to exit, copy the staged bundle next to the target, swap it in by rename
 * (old bundle kept as a backup until the new one is in place, restored on failure), then relaunch with `open`.
 * Quarantine is cleared only on the staged copy.
 * @param options.pid - This process.
 * @param options.target - Installed `.app` bundle.
 * @param options.staged - Verified staged `.app` bundle.
 * @param options.workDir - Update work directory for the script and its log.
 */
export function darwinInstallPlan(options: { pid: number; target: string; staged: string; workDir: string }): UpdateInstallPlan {
  const parent = dirname(options.target)
  const name = basename(options.target, '.app')
  const next = join(parent, `.${name}.update-new.app`)
  const backup = join(parent, `.${name}.update-backup.app`)
  const log = join(options.workDir, 'install.log')
  const content = `#!/bin/sh
set -u
pid=${String(options.pid)}
target=${shellQuote(options.target)}
staged=${shellQuote(options.staged)}
next=${shellQuote(next)}
backup=${shellQuote(backup)}
exec >>${shellQuote(log)} 2>&1
echo "update: waiting for $pid"
waited=0
while kill -0 "$pid" 2>/dev/null; do
  sleep 1
  waited=$((waited + 1))
  if [ "$waited" -ge ${String(EXIT_WAIT_SECONDS)} ]; then echo "update: application did not exit; nothing changed"; exit 1; fi
done
fail() { echo "update: $1"; rm -rf "$next"; /usr/bin/open "$target"; exit 1; }
rm -rf "$next" "$backup"
/usr/bin/xattr -dr com.apple.quarantine "$staged" 2>/dev/null || true
/usr/bin/ditto "$staged" "$next" || fail "copy failed; nothing changed"
/bin/mv "$target" "$backup" || fail "could not move the installed application; nothing changed"
if ! /bin/mv "$next" "$target"; then
  rm -rf "$target"
  /bin/mv "$backup" "$target" || { echo "update: restore failed; previous version is at $backup"; exit 1; }
  fail "could not move the update into place; previous version restored"
fi
rm -rf "$backup"
echo "update: installed"
/usr/bin/open "$target"
`
  const path = join(options.workDir, 'install.sh')
  return { command: '/bin/sh', args: [path], script: { path, content } }
}

/** PowerShell single-quoted string. */
const powershellQuote = (value: string): string => `'${value.replaceAll('\'', '\'\'')}'`

/**
 * Build the Windows helper: wait for `pid` to exit, run the verified per-user NSIS installer silently into the current
 * install directory, then start the application (with `--updated` after a successful install, so it raises its window;
 * the previous version when the installer fails).
 * @param options.pid - This process.
 * @param options.installer - Verified NSIS installer.
 * @param options.execPath - `process.execPath` of the installed application.
 * @param options.systemRoot - `%SystemRoot%`.
 */
export function windowsInstallPlan(options: { pid: number; installer: string; execPath: string; systemRoot: string }): UpdateInstallPlan {
  const installDir = win32.dirname(options.execPath)
  // electron-builder's per-user NSIS installer (oneClick: false, perMachine: false) honors /D=, which must come last unquoted.
  const installerArgs = `/S --updated /D=${installDir}`
  const script = [
    '$ErrorActionPreference = \'Continue\'',
    `Wait-Process -Id ${String(options.pid)} -Timeout ${String(EXIT_WAIT_SECONDS)} -ErrorAction SilentlyContinue`,
    `if (Get-Process -Id ${String(options.pid)} -ErrorAction SilentlyContinue) { exit 1 }`,
    `$installer = Start-Process -FilePath ${powershellQuote(options.installer)} -ArgumentList ${powershellQuote(installerArgs)} -Wait -PassThru`,
    `if ($installer.ExitCode -eq 0) { Start-Process -FilePath ${powershellQuote(options.execPath)} -ArgumentList '--updated' }`,
    `else { Start-Process -FilePath ${powershellQuote(options.execPath)} }`,
  ].join('\n')
  return {
    command: win32.join(options.systemRoot, 'System32', 'WindowsPowerShell', 'v1.0', 'powershell.exe'),
    args: ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-WindowStyle', 'Hidden',
      '-EncodedCommand', Buffer.from(script, 'utf16le').toString('base64')],
  }
}

/**
 * @param info - `Info.plist` of the staged bundle as JSON.
 * @param version - Manifest version.
 * @throws When the bundle is not Stitch or not the manifest's version.
 */
export function checkStagedBundle(info: unknown, version: string): void {
  const { CFBundleIdentifier: id, CFBundleShortVersionString: shortVersion } = (info ?? {}) as Record<string, unknown>
  if (id !== STITCH_BUNDLE_ID) throw new Error(`desktop update: staged bundle identifier ${String(id)} is not ${STITCH_BUNDLE_ID}`)
  if (shortVersion !== version) throw new Error(`desktop update: staged bundle version ${String(shortVersion)} is not ${version}`)
}

/** Writable-path probe; production uses `fs.access(path, W_OK)`. */
export type UpdatePathAccess = (path: string) => Promise<boolean>

/**
 * @param bundle - Installed `.app` bundle.
 * @param writable - Write-permission probe.
 * @returns A blocker when the bundle cannot be replaced in place: App Translocation, a read-only volume, or
 * a bundle or folder the user cannot write (for example owned by root).
 */
export async function darwinInstallBlocker(bundle: string, writable: UpdatePathAccess): Promise<UpdateInstallBlocker | undefined> {
  if (bundle.includes('/AppTranslocation/')) return { kind: 'not-writable', path: bundle }
  for (const path of [dirname(bundle), bundle, join(bundle, 'Contents')]) {
    if (!await writable(path)) return { kind: 'not-writable', path: bundle }
  }
  return undefined
}

/** A verified, staged update ready to hand to its helper. */
export interface PreparedUpdate {
  readonly version: string
  readonly plan: UpdateInstallPlan
}

/** Process facts and effects; tests replace them. */
export interface DesktopUpdateInstallerOptions {
  readonly userData: string
  readonly execPath: string
  readonly platform: NodeJS.Platform
  readonly pid: number
  readonly packaged: boolean
  readonly currentVersion: string
  readonly keys: readonly string[]
  readonly fetch: DesktopUpdateFetch
  readonly systemRoot?: string | undefined
  readonly writable?: UpdatePathAccess
  readonly execFile?: (command: string, args: readonly string[]) => Promise<string>
  readonly spawn?: (command: string, args: readonly string[]) => Promise<void>
}

const execFileAsync = promisify(execFileCallback)

/** Downloads, verifies, stages, and launches one-click updates. */
export class DesktopUpdateInstaller {
  /** Work directory under userData, removed at startup and before each attempt. */
  readonly directory: string
  private readonly writable: UpdatePathAccess
  private readonly execFile: (command: string, args: readonly string[]) => Promise<string>
  private readonly spawn: (command: string, args: readonly string[]) => Promise<void>

  constructor(private readonly options: DesktopUpdateInstallerOptions) {
    this.directory = join(options.userData, 'updates')
    this.writable = options.writable ?? (path => accessPath(path, constants.W_OK).then(() => true, () => false))
    this.execFile = options.execFile ?? (async (command, args) => (await execFileAsync(command, [...args], { encoding: 'utf8' })).stdout)
    this.spawn = options.spawn ?? ((command, args) => {
      const { promise, resolve, reject } = Promise.withResolvers<void>()
      const child = spawnProcess(command, [...args], { detached: true, stdio: 'ignore', windowsHide: true })
      child.once('error', reject)
      child.once('spawn', () => { child.unref(); resolve() })
      return promise
    })
  }

  /** Remove leftovers of earlier attempts. */
  async cleanup(): Promise<void> {
    await rm(this.directory, { recursive: true, force: true })
  }

  /**
   * @param release - Found release.
   * @returns Why 'Update now' cannot be offered, or undefined when it can. Without embedded keys there is never a
   * verified install source, so the release is only offered for manual download.
   */
  async blocker(release: DesktopRelease): Promise<UpdateInstallBlocker | undefined> {
    if (release.install === undefined || this.options.keys.length === 0 || !this.options.packaged) return { kind: 'unavailable' }
    if (this.options.platform === 'darwin') {
      const bundle = darwinAppBundle(this.options.execPath)
      return bundle === undefined ? { kind: 'unavailable' } : darwinInstallBlocker(bundle, this.writable)
    }
    if (this.options.platform === 'win32') {
      const installDir = win32.dirname(this.options.execPath)
      return await this.writable(installDir) ? undefined : { kind: 'not-writable', path: installDir }
    }
    return { kind: 'unavailable' }
  }

  /**
   * Download and verify the release asset, stage it, and write the helper.
   * @param release - Release whose blocker check passed.
   * @param onProgress - Progress for the dialog.
   * @returns The plan to launch at quit.
   * @throws On any download, verification, or staging failure; the installed application is untouched.
   */
  async prepare(release: DesktopRelease, onProgress: (progress: UpdateProgress) => void): Promise<PreparedUpdate> {
    const install = release.install
    if (install === undefined || this.options.keys.length === 0) throw new Error('desktop update: no verified install source')
    await this.cleanup()
    await mkdir(this.directory, { recursive: true })
    const file = join(this.directory, install.asset.name)
    await this.download(install, file, onProgress)
    onProgress({ phase: 'verify' })
    verifyUpdateAsset(await readFile(file), install.asset, this.options.keys)
    onProgress({ phase: 'stage' })
    const plan = this.options.platform === 'darwin' ? await this.stageDarwin(install, file)
      : windowsInstallPlan({ pid: this.options.pid, installer: file, execPath: this.options.execPath,
        systemRoot: this.options.systemRoot ?? 'C:\\Windows' })
    if (plan.script !== undefined) await writeFile(plan.script.path, plan.script.content, { mode: 0o700 })
    return { version: install.manifest.version, plan }
  }

  /**
   * Start the detached helper; the caller quits immediately afterwards.
   * @param prepared - Result of `prepare`.
   */
  async launch(prepared: PreparedUpdate): Promise<void> {
    await this.spawn(prepared.plan.command, prepared.plan.args)
  }

  private async download(install: DesktopReleaseInstall, file: string, onProgress: (progress: UpdateProgress) => void): Promise<void> {
    const { asset, manifest } = install
    const response = await this.options.fetch(releaseAssetUrl(manifest.tag, asset.name), {
      method: 'GET',
      headers: { 'User-Agent': `Stitch/${this.options.currentVersion}`, Accept: 'application/octet-stream' },
      credentials: 'omit',
      cache: 'no-store',
      redirect: 'follow',
      referrerPolicy: 'no-referrer',
      signal: AbortSignal.timeout(DOWNLOAD_TIMEOUT_MS),
    })
    if (!response.ok || response.body === null) throw new Error(`desktop update: download answered HTTP ${String(response.status)}`)
    const handle = await open(file, 'w', 0o600)
    try {
      const reader = response.body.getReader()
      let received = 0
      onProgress({ phase: 'download', fraction: 0 })
      for (;;) {
        const { done, value } = await reader.read()
        if (done) break
        received += value.byteLength
        if (received > asset.size) {
          await reader.cancel()
          throw new Error('desktop update: download is larger than the manifest size')
        }
        await handle.write(value)
        onProgress({ phase: 'download', fraction: received / asset.size })
      }
    } finally {
      await handle.close()
    }
  }

  private async stageDarwin(install: DesktopReleaseInstall, zip: string): Promise<UpdateInstallPlan> {
    const target = darwinAppBundle(this.options.execPath)
    if (target === undefined) throw new Error('desktop update: the running application is not an app bundle')
    const staging = join(this.directory, 'staging')
    await mkdir(staging)
    await this.execFile('/usr/bin/ditto', ['-x', '-k', zip, staging])
    const bundles = (await readdir(staging)).filter(entry => entry.endsWith('.app'))
    const [bundle] = bundles
    if (bundles.length !== 1 || bundle === undefined) {
      throw new Error(`desktop update: archive must contain one app bundle, found ${String(bundles.length)}`)
    }
    const staged = join(staging, bundle)
    const info: unknown = JSON.parse(await this.execFile('/usr/bin/plutil',
      ['-convert', 'json', '-o', '-', join(staged, 'Contents', 'Info.plist')]))
    checkStagedBundle(info, install.manifest.version)
    return darwinInstallPlan({ pid: this.options.pid, target, staged, workDir: this.directory })
  }
}
