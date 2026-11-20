/** Unsigned helper builds own a fresh provider payload and never replace a staged release payload. */
import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, expect, it } from 'vitest'
import {
  buildUnsignedHelpers,
  parseUnsignedHelperInvocation,
  unsignedHelperBinDirectory,
  unsignedHelperCommands,
} from './build-unsigned.ts'

const roots: string[] = []
afterEach(() => { for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true }) })

function fixture(): string {
  const root = mkdtempSync(join(tmpdir(), 'cua-unsigned-'))
  roots.push(root)
  return root
}

it('builds release-variant ad-hoc macOS applications per architecture into the provider payload', () => {
  const nativeRoot = join('/repo', 'packages/experimental/cua-macos/native')
  expect(unsignedHelperCommands('/repo', 'darwin', ['arm64', 'x64'])).toEqual((['arm64', 'x64'] as const).map(architecture => ({
    command: '/usr/bin/xcrun',
    args: ['python3', join(nativeRoot, 'build_app.py'), '--arch', architecture === 'x64' ? 'x86_64' : 'arm64',
      '--scratch-path', join(nativeRoot, '.build', `unsigned-${architecture}`),
      '--output-directory', join(nativeRoot, 'bin', `darwin-${architecture}`), '--variant', 'release', '--identity', '-'],
  })))
})

it('restores the locked Windows solution once and publishes self-contained helpers without restoring', () => {
  const commands = unsignedHelperCommands('/repo', 'win32', ['x64'])
  expect(commands.map(({ command }) => command)).toEqual(['dotnet', 'dotnet'])
  expect(commands[0]!.args).toEqual(['restore', join('/repo/packages/experimental/cua-windows/native/cua-windows.slnx'), '--locked-mode'])
  expect(commands[1]!.args).toEqual(['publish', join('/repo/packages/experimental/cua-windows/native/entry/CuaWindows.csproj'),
    '--configuration', 'Release', '--runtime', 'win-x64', '--self-contained', 'true', '--no-restore',
    '--output', join('/repo/packages/experimental/cua-windows/native/bin/win-x64')])
})

it('defaults to both macOS architectures and the Windows host architecture', () => {
  expect(parseUnsignedHelperInvocation([], 'darwin', 'arm64')).toEqual({ platform: 'darwin', architectures: ['arm64', 'x64'], clean: false })
  expect(parseUnsignedHelperInvocation(['--arch', 'x64', '--arch', 'x64'], 'darwin', 'arm64').architectures).toEqual(['x64'])
  expect(parseUnsignedHelperInvocation([], 'win32', 'x64').architectures).toEqual(['x64'])
  expect(parseUnsignedHelperInvocation(['--clean'], 'win32', 'x64').clean).toBe(true)
  expect(() => parseUnsignedHelperInvocation(['--arch', 'ia32'], 'win32', 'x64')).toThrow(/unsupported --arch/u)
  expect(() => parseUnsignedHelperInvocation([], 'linux', 'x64')).toThrow(/macOS or Windows host/u)
})

it('refuses to replace an existing payload, such as a staged notarized helper', async () => {
  const root = fixture()
  const bin = unsignedHelperBinDirectory(root, 'darwin')
  mkdirSync(join(bin, 'darwin-arm64'), { recursive: true })
  writeFileSync(join(bin, 'darwin-arm64', 'current.json'), '{}')
  const commands: string[] = []
  await expect(buildUnsignedHelpers(root, 'darwin', ['arm64'], async ({ command }) => { commands.push(command) }))
    .rejects.toThrow(/already exists/u)
  expect(commands).toEqual([])
  expect(existsSync(join(bin, 'darwin-arm64', 'current.json'))).toBe(true)
})

it('verifies each built helper and removes partial output on failure', async () => {
  const root = fixture()
  const bin = unsignedHelperBinDirectory(root, 'win32')
  await expect(buildUnsignedHelpers(root, 'win32', ['x64'], async () => { mkdirSync(join(bin, 'win-x64'), { recursive: true }) }))
    .rejects.toThrow(/dsh-cua-windows\.exe was not produced/u)
  expect(existsSync(bin)).toBe(false)
  const built = await buildUnsignedHelpers(root, 'win32', ['x64'], async ({ args }) => {
    if (args[0] !== 'publish') return
    mkdirSync(join(bin, 'win-x64'), { recursive: true })
    writeFileSync(join(bin, 'win-x64', 'dsh-cua-windows.exe'), 'MZ')
  })
  expect(built).toBe(bin)
})
