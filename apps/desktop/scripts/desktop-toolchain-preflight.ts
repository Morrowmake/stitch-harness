/**
 * Probe the external tools a packaging run will shell out to, before it starts.
 *
 * The packaging sequence reaches its first archive step minutes in, and its
 * first installer step later still, so a tool that is absent or behaves
 * differently than the scripts assume wastes a whole run. Each probe here
 * exercises the specific behaviour the run depends on rather than merely
 * checking that the executable resolves.
 */

import { execFile } from 'node:child_process'
import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { basename, dirname, join } from 'node:path'
import { promisify } from 'node:util'

const run = promisify(execFile)

/** One tool the packaging run requires, and what went wrong with it. */
export interface DesktopToolchainProbeFailure {
  readonly tool: string
  readonly detail: string
}

async function probeTar(): Promise<string | undefined> {
  // GNU tar reads the colon in an absolute Windows path as a remote-host separator, which the
  // release scripts avoid by running beside the archive; this probe confirms the archive reader works there.
  const directory = await mkdtemp(join(tmpdir(), 'dsh-tar-probe-'))
  try {
    const member = join(directory, 'probe.txt')
    await writeFile(member, 'probe\n')
    const archive = join(directory, 'probe.tar.gz')
    await run('tar', ['-czf', basename(archive), basename(member)], { cwd: directory, windowsHide: true, timeout: 20_000 })
    const listed = await run('tar', ['-tzf', basename(archive)], { cwd: dirname(archive), windowsHide: true, timeout: 20_000 })
    if (!listed.stdout.includes('probe.txt')) return `tar listed ${JSON.stringify(listed.stdout)} instead of the archived member`
    return undefined
  }
  catch (error) {
    return error instanceof Error ? error.message : String(error)
  }
  finally {
    await rm(directory, { recursive: true, force: true })
  }
}

async function probeWindowsInstallerToolchain(environment: NodeJS.ProcessEnv): Promise<DesktopToolchainProbeFailure[]> {
  const failures: DesktopToolchainProbeFailure[] = []
  const programFiles = environment['ProgramFiles(x86)']
  const vswhere = programFiles === undefined
    ? undefined
    : join(programFiles, 'Microsoft Visual Studio/Installer/vswhere.exe')
  if (vswhere === undefined) {
    failures.push({ tool: 'vswhere', detail: 'ProgramFiles(x86) is not set, so Visual Studio cannot be located' })
  }
  else {
    try {
      const located = await run(vswhere, ['-latest', '-products', '*',
        '-requires', 'Microsoft.VisualStudio.Component.VC.Tools.x86.x64', '-property', 'installationPath'],
      { windowsHide: true, timeout: 30_000 })
      if (located.stdout.trim() === '') {
        failures.push({ tool: 'vswhere', detail: 'Visual Studio C++ build tools are not installed, so the installer helper cannot compile' })
      }
    }
    catch (error) {
      failures.push({ tool: 'vswhere', detail: error instanceof Error ? error.message : String(error) })
    }
  }
  return failures
}

async function probeComputerUseHelperToolchain(platform: 'darwin' | 'win32'): Promise<DesktopToolchainProbeFailure | undefined> {
  // The helper's Package.swift declares swift-tools-version 6.0 and its project targets .NET 10.
  try {
    if (platform === 'darwin') {
      const { stdout } = await run('/usr/bin/xcrun', ['swift', '--version'], { timeout: 60_000 })
      const major = Number(/Swift version (\d+)\./u.exec(stdout)?.[1] ?? 0)
      return major >= 6 ? undefined : { tool: 'swift', detail: `Swift 6 or later is required to build the Computer Use helper; found ${JSON.stringify(stdout.trim())}` }
    }
    const { stdout } = await run('dotnet', ['--list-sdks'], { windowsHide: true, timeout: 60_000 })
    const majors = stdout.split(/\r?\n/u).map(line => Number(/^(\d+)\./u.exec(line)?.[1] ?? 0))
    return majors.some(major => major >= 10) ? undefined : { tool: 'dotnet', detail: `the .NET 10 SDK is required to build the Computer Use helper; found ${JSON.stringify(stdout.trim())}` }
  }
  catch (error) {
    return { tool: platform === 'darwin' ? 'swift' : 'dotnet', detail: error instanceof Error ? error.message : String(error) }
  }
}

/** Optional work a packaging run adds beyond the installer itself. */
export interface DesktopToolchainOptions {
  /** Whether the run builds the Computer Use helper from source (unsigned builds). */
  readonly computerUseHelper?: boolean
}

/**
 * Probe every external tool one packaging run needs.
 * @param platform - Target platform; a Windows target already requires a Windows build host.
 * @param environment - Packaging environment used to locate Windows tooling.
 * @param options - Additional source builds the run performs.
 * @returns Every probe that failed, empty when the host can run the packaging sequence.
 */
export async function probeDesktopToolchain(
  platform: 'darwin' | 'win32',
  environment: NodeJS.ProcessEnv = process.env,
  options: DesktopToolchainOptions = {},
): Promise<readonly DesktopToolchainProbeFailure[]> {
  const failures: DesktopToolchainProbeFailure[] = []
  const tar = await probeTar()
  if (tar !== undefined) failures.push({ tool: 'tar', detail: tar })
  if (platform === 'win32') failures.push(...await probeWindowsInstallerToolchain(environment))
  if (options.computerUseHelper) {
    const helper = await probeComputerUseHelperToolchain(platform)
    if (helper !== undefined) failures.push(helper)
  }
  return failures
}

/**
 * Probe the toolchain and fail with every problem the host has.
 * @param platform - Target platform; a Windows target already requires a Windows build host.
 * @param environment - Packaging environment used to locate Windows tooling.
 * @param options - Additional source builds the run performs.
 * @returns Resolves when every probe passes.
 */
export async function requireDesktopToolchain(
  platform: 'darwin' | 'win32',
  environment: NodeJS.ProcessEnv = process.env,
  options: DesktopToolchainOptions = {},
): Promise<void> {
  const failures = await probeDesktopToolchain(platform, environment, options)
  if (failures.length === 0) return
  throw new Error(`desktop package: the build host cannot run this packaging sequence:\n${
    failures.map(failure => `  ${failure.tool}: ${failure.detail}`).join('\n')}`)
}
