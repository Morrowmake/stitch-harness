/**
 * Build the Computer Use helper from source for unsigned distribution: ad-hoc-signed `Stitch Computer Use.app`
 * generations on macOS, the self-contained unsigned .NET publish output on Windows. The output lands in the provider
 * package's `native/bin`, where the installed provider resolves it and `pnpm pack` includes it.
 */
import { existsSync, lstatSync, rmSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { parseArgs } from 'node:util'
import { execa } from 'execa'
import { isEntry } from '../release/process.ts'
import { CUA_ARCHITECTURES, readCuaApplication } from './payload.ts'

/** Host platforms with a native Computer Use helper. */
export type UnsignedHelperPlatform = 'darwin' | 'win32'

/** Helper architectures, named as the provider's `native/bin/<platform>-<arch>` directories name them. */
export type UnsignedHelperArchitecture = (typeof CUA_ARCHITECTURES)[number]

/** One external command of an unsigned helper build. */
export interface UnsignedHelperCommand {
  readonly command: string
  readonly args: readonly string[]
}

/**
 * Locate the payload directory that the installed provider reads and `pnpm pack` publishes.
 * @param root - Repository root.
 * @param platform - Helper platform.
 * @returns The provider package's `native/bin` directory.
 */
export function unsignedHelperBinDirectory(root: string, platform: UnsignedHelperPlatform): string {
  return join(root, 'packages/experimental', platform === 'darwin' ? 'cua-macos' : 'cua-windows', 'native', 'bin')
}

/**
 * List the commands that build each requested architecture into the provider payload directory.
 * macOS runs the release variant of `build_app.py` with the ad-hoc identity, so the bundle keeps the release
 * bundle identifier; Windows restores the locked helper solution once and publishes each runtime without restoring.
 * @param root - Repository root.
 * @param platform - Helper platform; each build must run on that platform.
 * @param architectures - Requested architectures, without duplicates.
 * @returns Commands in execution order.
 */
export function unsignedHelperCommands(
  root: string,
  platform: UnsignedHelperPlatform,
  architectures: readonly UnsignedHelperArchitecture[],
): readonly UnsignedHelperCommand[] {
  const bin = unsignedHelperBinDirectory(root, platform)
  const nativeRoot = join(bin, '..')
  if (platform === 'darwin') {
    return architectures.map(architecture => ({
      command: '/usr/bin/xcrun',
      args: ['python3', join(nativeRoot, 'build_app.py'), '--arch', architecture === 'x64' ? 'x86_64' : 'arm64',
        '--scratch-path', join(nativeRoot, '.build', `unsigned-${architecture}`),
        '--output-directory', join(bin, `darwin-${architecture}`), '--variant', 'release', '--identity', '-'],
    }))
  }
  return [
    { command: 'dotnet', args: ['restore', join(nativeRoot, 'cua-windows.slnx'), '--locked-mode'] },
    ...architectures.map(architecture => ({
      command: 'dotnet',
      args: ['publish', join(nativeRoot, 'entry', 'CuaWindows.csproj'), '--configuration', 'Release',
        '--runtime', `win-${architecture}`, '--self-contained', 'true', '--no-restore',
        '--output', join(bin, `win-${architecture}`)],
    })),
  ]
}

/**
 * Reject a payload directory that lacks a complete helper for one architecture.
 * @param bin - Provider `native/bin` directory.
 * @param platform - Helper platform.
 * @param architecture - Built architecture.
 */
export function verifyUnsignedHelper(bin: string, platform: UnsignedHelperPlatform, architecture: UnsignedHelperArchitecture): void {
  if (platform === 'darwin') {
    readCuaApplication(join(bin, `darwin-${architecture}`))
    return
  }
  const executable = join(bin, `win-${architecture}`, 'dsh-cua-windows.exe')
  if (!existsSync(executable) || !lstatSync(executable).isFile()) throw new Error(`unsigned CUA helper: ${executable} was not produced`)
}

/**
 * Build fresh helpers into an absent payload directory, removing partial output on failure.
 * An existing `native/bin` is never replaced: it may hold a staged, notarized release payload.
 * @param root - Repository root.
 * @param platform - Helper platform, which must be the build host's.
 * @param architectures - Requested architectures.
 * @param run - Command runner; defaults to inherited-output subprocesses.
 * @returns The populated payload directory.
 */
export async function buildUnsignedHelpers(
  root: string,
  platform: UnsignedHelperPlatform,
  architectures: readonly UnsignedHelperArchitecture[],
  run: (command: UnsignedHelperCommand) => Promise<void> = async ({ command, args }) => {
    await execa(command, args, { cwd: root, stdio: 'inherit' })
  },
): Promise<string> {
  const bin = unsignedHelperBinDirectory(root, platform)
  if (existsSync(bin)) {
    throw new Error(`unsigned CUA helper: ${bin} already exists; remove it (or run with --clean) so this build owns a fresh payload`)
  }
  try {
    for (const command of unsignedHelperCommands(root, platform, architectures)) await run(command)
    for (const architecture of architectures) verifyUnsignedHelper(bin, platform, architecture)
  } catch (error) {
    rmSync(bin, { recursive: true, force: true })
    throw error
  }
  return bin
}

/**
 * Parse the command line against the build host.
 * @param argv - Arguments after the script entry point.
 * @param hostPlatform - Build-host platform.
 * @param hostArch - Build-host architecture; the Windows default.
 * @returns Selected platform, architectures and whether to remove the payload instead of building it.
 */
export function parseUnsignedHelperInvocation(
  argv: readonly string[],
  hostPlatform: NodeJS.Platform = process.platform,
  hostArch: string = process.arch,
): { platform: UnsignedHelperPlatform; architectures: readonly UnsignedHelperArchitecture[]; clean: boolean } {
  const { values } = parseArgs({
    args: [...argv],
    options: { arch: { type: 'string', multiple: true }, clean: { type: 'boolean', default: false } },
    allowPositionals: false,
  })
  if (hostPlatform !== 'darwin' && hostPlatform !== 'win32') {
    throw new Error('unsigned CUA helper: builds run on a macOS or Windows host')
  }
  const requested = values.arch ?? (hostPlatform === 'darwin' ? [...CUA_ARCHITECTURES] : [hostArch])
  const architectures = [...new Set(requested)].map((architecture) => {
    if (!(CUA_ARCHITECTURES as readonly string[]).includes(architecture)) {
      throw new Error(`unsigned CUA helper: unsupported --arch ${JSON.stringify(architecture)}; expected ${CUA_ARCHITECTURES.join(' or ')}`)
    }
    return architecture as UnsignedHelperArchitecture
  })
  return { platform: hostPlatform, architectures, clean: values.clean }
}

async function main(): Promise<void> {
  const root = resolve(import.meta.dirname, '../..')
  const { platform, architectures, clean } = parseUnsignedHelperInvocation(process.argv.slice(2))
  if (clean) {
    rmSync(unsignedHelperBinDirectory(root, platform), { recursive: true, force: true })
    return
  }
  const bin = await buildUnsignedHelpers(root, platform, architectures)
  console.log(`unsigned CUA helper: ${architectures.join(', ')} in ${bin}`)
}

if (isEntry(import.meta.url)) await main()
