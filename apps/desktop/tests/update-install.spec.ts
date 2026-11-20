import { mkdir, mkdtemp, readFile, rm, stat } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it, onTestFinished, vi } from 'vitest'
import type { DesktopRelease, DesktopUpdateFetch } from '../src/update-check.ts'
import {
  checkStagedBundle, darwinAppBundle, darwinInstallBlocker, darwinInstallPlan, DesktopUpdateInstaller, STITCH_BUNDLE_ID,
  windowsInstallPlan, type DesktopUpdateInstallerOptions,
} from '../src/update-install.ts'
import { sha256Hex, signUpdatePayload, type UpdateAsset } from '../src/update-manifest.ts'
import { releaseKey } from './helpers/update-signing.ts'

const key = releaseKey()
const bytes = Buffer.from('verified update bytes')
const PAGE = 'https://github.com/Morrowmake/stitch-harness/releases/tag/stitch-v1.2.0'

function asset(name: string, fields: Partial<UpdateAsset> = {}): UpdateAsset {
  return { name, size: bytes.length, sha256: sha256Hex(bytes), signature: signUpdatePayload(bytes, key.privateKey), ...fields }
}

function release(name: string, fields: Partial<UpdateAsset> = {}): DesktopRelease {
  const entry = asset(name, fields)
  return { version: '1.2.0', tag: 'stitch-v1.2.0', name: 'Stitch 1.2.0', url: PAGE, install: { asset: entry, manifest: {
    schema: 1, version: '1.2.0', tag: 'stitch-v1.2.0', releaseUrl: PAGE, publishedAt: '2026-11-21T00:00:00Z',
    assets: { 'darwin-arm64': entry, 'win32-x64': entry }, manifestSignature: 'verified',
  } } }
}

async function userData(): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), 'desktop-update-install-'))
  onTestFinished(() => rm(root, { recursive: true, force: true }))
  return root
}

function serving(body: Buffer) {
  return vi.fn<DesktopUpdateFetch>(async () => new Response(new Uint8Array(body)))
}

function installer(options: Partial<DesktopUpdateInstallerOptions> & Pick<DesktopUpdateInstallerOptions, 'userData'>) {
  const spawn = vi.fn(async () => {})
  const instance = new DesktopUpdateInstaller({
    execPath: 'C:\\Users\\me\\AppData\\Local\\Programs\\Stitch\\Stitch.exe', platform: 'win32', pid: 4242, packaged: true,
    currentVersion: '1.0.0', keys: [key.publicKey], fetch: serving(bytes), systemRoot: 'C:\\Windows',
    writable: async () => true, spawn, ...options,
  })
  return { instance, spawn }
}

describe('macOS install plan', () => {
  it('finds the running bundle from the executable path', () => {
    expect(darwinAppBundle('/Applications/Stitch.app/Contents/MacOS/Stitch')).toBe('/Applications/Stitch.app')
    expect(darwinAppBundle('/usr/local/bin/electron')).toBeUndefined()
  })

  it('swaps the bundle by rename next to the target, restores on failure, and relaunches with open', () => {
    const plan = darwinInstallPlan({ pid: 77, target: '/Applications/Stitch.app', staged: '/Users/me/updates/staging/Stitch.app',
      workDir: '/Users/me/updates' })
    expect(plan.command).toBe('/bin/sh')
    expect(plan.args).toEqual(['/Users/me/updates/install.sh'])
    expect(plan.script?.path).toBe('/Users/me/updates/install.sh')
    const script = plan.script!.content
    expect(script).toContain('pid=77')
    expect(script).toContain('while kill -0 "$pid"')
    expect(script).toContain('next=\'/Applications/.Stitch.update-new.app\'')
    expect(script).toContain('backup=\'/Applications/.Stitch.update-backup.app\'')
    expect(script).toContain('/usr/bin/xattr -dr com.apple.quarantine "$staged"')
    expect(script).not.toMatch(/xattr[^\n]*"\$target"/u)
    const order = ['/usr/bin/ditto "$staged" "$next"', '/bin/mv "$target" "$backup"', '/bin/mv "$next" "$target"',
      '/bin/mv "$backup" "$target"', 'rm -rf "$backup"\necho "update: installed"', '/usr/bin/open "$target"\n']
    const positions = order.map(step => script.lastIndexOf(step))
    expect(positions.every(position => position > 0)).toBe(true)
    expect([...positions].sort((a, b) => a - b)).toEqual(positions)
  })

  it('quotes paths for the shell', () => {
    const plan = darwinInstallPlan({ pid: 1, target: '/Users/me/Apps/It\'s Stitch.app', staged: '/tmp/a b/Stitch.app', workDir: '/tmp/a b' })
    expect(plan.script!.content).toContain('target=\'/Users/me/Apps/It\'\\\'\'s Stitch.app\'')
    expect(plan.script!.content).toContain('exec >>\'/tmp/a b/install.log\' 2>&1')
  })

  it('accepts only a staged Stitch bundle of the manifest version', () => {
    expect(() => { checkStagedBundle({ CFBundleIdentifier: STITCH_BUNDLE_ID, CFBundleShortVersionString: '1.2.0' }, '1.2.0') }).not.toThrow()
    expect(STITCH_BUNDLE_ID).toBe('io.github.morrowmake.stitch')
    expect(() => { checkStagedBundle({ CFBundleIdentifier: 'com.example.other', CFBundleShortVersionString: '1.2.0' }, '1.2.0') })
      .toThrow(/identifier/u)
    expect(() => { checkStagedBundle({ CFBundleIdentifier: STITCH_BUNDLE_ID, CFBundleShortVersionString: '1.1.0' }, '1.2.0') })
      .toThrow(/version/u)
    expect(() => { checkStagedBundle(null, '1.2.0') }).toThrow()
  })

  it('falls back to manual download for translocated, read-only, or root-owned bundles', async () => {
    const writable = (denied: string) => async (path: string) => path !== denied
    expect(await darwinInstallBlocker('/Applications/Stitch.app', writable('none'))).toBeUndefined()
    expect(await darwinInstallBlocker('/private/var/folders/x/AppTranslocation/ABC/d/Stitch.app', writable('none')))
      .toEqual({ kind: 'not-writable', path: '/private/var/folders/x/AppTranslocation/ABC/d/Stitch.app' })
    expect(await darwinInstallBlocker('/Volumes/Stitch/Stitch.app', writable('/Volumes/Stitch')))
      .toEqual({ kind: 'not-writable', path: '/Volumes/Stitch/Stitch.app' })
    expect(await darwinInstallBlocker('/Applications/Stitch.app', writable('/Applications/Stitch.app/Contents')))
      .toEqual({ kind: 'not-writable', path: '/Applications/Stitch.app' })
  })
})

describe('Windows install plan', () => {
  it('waits for exit, runs the NSIS installer silently into the current per-user directory, then relaunches', () => {
    const plan = windowsInstallPlan({ pid: 4242, installer: 'C:\\Users\\me\\AppData\\Roaming\\Stitch\\updates\\stitch-1.2.0-win-x64-unsigned.exe',
      execPath: 'C:\\Users\\me\\AppData\\Local\\Programs\\Stitch\\Stitch.exe', systemRoot: 'C:\\Windows' })
    expect(plan.command).toMatch(/System32[\\/]WindowsPowerShell[\\/]v1\.0[\\/]powershell\.exe$/u)
    expect(plan.args.slice(0, -1)).toEqual(['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-WindowStyle', 'Hidden', '-EncodedCommand'])
    const script = Buffer.from(plan.args.at(-1)!, 'base64').toString('utf16le')
    expect(script).toContain('Wait-Process -Id 4242')
    expect(script).toContain('-FilePath \'C:\\Users\\me\\AppData\\Roaming\\Stitch\\updates\\stitch-1.2.0-win-x64-unsigned.exe\'')
    expect(script).toMatch(/-ArgumentList '\/S --updated \/D=C:\\Users\\me\\AppData\\Local\\Programs\\Stitch' -Wait -PassThru/u)
    expect(script).toContain('if ($installer.ExitCode -eq 0) { Start-Process -FilePath \'C:\\Users\\me\\AppData\\Local\\Programs\\Stitch\\Stitch.exe\' -ArgumentList \'--updated\' }')
    expect(script).toContain('else { Start-Process -FilePath \'C:\\Users\\me\\AppData\\Local\\Programs\\Stitch\\Stitch.exe\' }')
  })

  it('escapes single quotes in PowerShell strings', () => {
    const plan = windowsInstallPlan({ pid: 1, installer: 'C:\\O\'Brien\\setup.exe', execPath: 'C:\\S\\Stitch.exe', systemRoot: 'C:\\Windows' })
    expect(Buffer.from(plan.args.at(-1)!, 'base64').toString('utf16le')).toContain('\'C:\\O\'\'Brien\\setup.exe\'')
  })
})

describe('DesktopUpdateInstaller', () => {
  it('offers no one-click install without embedded keys, a verified install source, or a packaged build', async () => {
    const root = await userData()
    expect(await installer({ userData: root, keys: [] }).instance.blocker(release('a.exe'))).toEqual({ kind: 'unavailable' })
    const { install: _install, ...withoutInstall } = release('a.exe')
    expect(await installer({ userData: root }).instance.blocker(withoutInstall)).toEqual({ kind: 'unavailable' })
    expect(await installer({ userData: root, packaged: false }).instance.blocker(release('a.exe'))).toEqual({ kind: 'unavailable' })
    expect(await installer({ userData: root, platform: 'linux' }).instance.blocker(release('a.exe'))).toEqual({ kind: 'unavailable' })
    expect(await installer({ userData: root }).instance.blocker(release('a.exe'))).toBeUndefined()
    await expect(installer({ userData: root, keys: [] }).instance.prepare(release('a.exe'), () => {})).rejects.toThrow(/no verified/u)
  })

  it('reports a non-writable install directory', async () => {
    const root = await userData()
    const { instance } = installer({ userData: root, writable: async () => false })
    expect(await instance.blocker(release('a.exe'))).toEqual({ kind: 'not-writable', path: 'C:\\Users\\me\\AppData\\Local\\Programs\\Stitch' })
  })

  it('downloads the manifest-named asset with progress, verifies it, and launches the Windows helper', async () => {
    const root = await userData()
    const fetch = serving(bytes)
    const { instance, spawn } = installer({ userData: root, fetch })
    const progress = vi.fn()
    const prepared = await instance.prepare(release('stitch-1.2.0-win-x64-unsigned.exe'), progress)
    expect(fetch.mock.calls[0]![0]).toBe('https://github.com/Morrowmake/stitch-harness/releases/download/stitch-v1.2.0/stitch-1.2.0-win-x64-unsigned.exe')
    expect(fetch.mock.calls[0]![1]).toMatchObject({ credentials: 'omit', redirect: 'follow' })
    expect(progress.mock.calls.map(([value]: unknown[]) => value)).toEqual([
      { phase: 'download', fraction: 0 }, { phase: 'download', fraction: 1 }, { phase: 'verify' }, { phase: 'stage' },
    ])
    const file = join(root, 'updates', 'stitch-1.2.0-win-x64-unsigned.exe')
    expect(await readFile(file)).toEqual(bytes)
    expect(spawn).not.toHaveBeenCalled()
    await instance.launch(prepared)
    expect(spawn).toHaveBeenCalledWith(prepared.plan.command, prepared.plan.args)
    expect(Buffer.from(prepared.plan.args.at(-1)!, 'base64').toString('utf16le')).toContain(file.replaceAll('\'', '\'\''))
    await instance.cleanup()
    await expect(stat(join(root, 'updates'))).rejects.toMatchObject({ code: 'ENOENT' })
  })

  it.each([
    ['a sha256 mismatch', bytes.length, { sha256: '0'.repeat(64) }, /sha256/u],
    ['a bad signature', bytes.length, { signature: signUpdatePayload(bytes, releaseKey().privateKey) }, /signature/u],
    ['an oversized body', bytes.length - 1, {}, /larger/u],
  ])('rejects %s without launching anything', async (_label, size, fields, error) => {
    const root = await userData()
    const { instance, spawn } = installer({ userData: root })
    await expect(instance.prepare(release('a.exe', { size, ...fields }), () => {})).rejects.toThrow(error)
    expect(spawn).not.toHaveBeenCalled()
  })

  it('rejects an HTTP failure', async () => {
    const root = await userData()
    const { instance } = installer({ userData: root, fetch: vi.fn<DesktopUpdateFetch>(async () => new Response('gone', { status: 404 })) })
    await expect(instance.prepare(release('a.exe'), () => {})).rejects.toThrow(/HTTP 404/u)
  })

  it('stages the macOS zip, checks the bundle, and writes the replacement helper', async () => {
    const root = await userData()
    const info = { CFBundleIdentifier: STITCH_BUNDLE_ID, CFBundleShortVersionString: '1.2.0' }
    const execFile = vi.fn(async (command: string, args: readonly string[]) => {
      if (command === '/usr/bin/ditto') { await mkdir(join(args[3]!, 'Stitch.app', 'Contents'), { recursive: true }); return '' }
      return JSON.stringify(info)
    })
    const { instance } = installer({ userData: root, platform: 'darwin', execPath: '/Applications/Stitch.app/Contents/MacOS/Stitch', execFile })
    const prepared = await instance.prepare(release('stitch-1.2.0-mac-arm64-unsigned.zip'), () => {})
    const updates = join(root, 'updates')
    expect(execFile).toHaveBeenNthCalledWith(1, '/usr/bin/ditto', ['-x', '-k', join(updates, 'stitch-1.2.0-mac-arm64-unsigned.zip'), join(updates, 'staging')])
    expect(execFile).toHaveBeenNthCalledWith(2, '/usr/bin/plutil',
      ['-convert', 'json', '-o', '-', join(updates, 'staging', 'Stitch.app', 'Contents', 'Info.plist')])
    expect(prepared.plan).toEqual(darwinInstallPlan({ pid: 4242, target: '/Applications/Stitch.app',
      staged: join(updates, 'staging', 'Stitch.app'), workDir: updates }))
    expect(await readFile(join(updates, 'install.sh'), 'utf8')).toBe(prepared.plan.script!.content)
  })

  it('rejects a staged macOS bundle with another identifier', async () => {
    const root = await userData()
    const execFile = vi.fn(async (command: string, args: readonly string[]) => {
      if (command === '/usr/bin/ditto') { await mkdir(join(args[3]!, 'Stitch.app'), { recursive: true }); return '' }
      return JSON.stringify({ CFBundleIdentifier: 'com.example.impostor', CFBundleShortVersionString: '1.2.0' })
    })
    const { instance } = installer({ userData: root, platform: 'darwin', execPath: '/Applications/Stitch.app/Contents/MacOS/Stitch', execFile })
    await expect(instance.prepare(release('a.zip'), () => {})).rejects.toThrow(/identifier/u)
    await expect(stat(join(root, 'updates', 'install.sh'))).rejects.toMatchObject({ code: 'ENOENT' })
  })
})
