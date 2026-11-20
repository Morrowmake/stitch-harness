/** Validate the assembled application, including native Office conversion outside ASAR. */
import { execFileSync } from 'node:child_process'
import { join } from 'node:path'
import { parseArgs } from 'node:util'
import { desktopArtifactOutput, resolveDesktopBuildTarget, resolveDesktopTargetBuildPaths } from './desktop-build-paths.mjs'
import { DESKTOP_PACKAGE_NAME } from './electron-builder-config.mjs'
import { desktopNodeEnvironment } from '../src/node-environment.ts'
import { readDesktopRuntime, verifyDesktopRuntime } from '../src/runtime-tree.ts'
import { verifyWindowsCode } from './windows-runtime-signature.mjs'
import { smokePreparedRuntime } from './smoke-prepared-runtime.ts'
import { resolveDesktopPackageTarget } from './package-target.ts'
import { assertNoBundledAgentCli } from './runtime-file-policy.ts'

const paths = resolveDesktopTargetBuildPaths()
const { values } = parseArgs({ options: { unsigned: { type: 'boolean', default: false }, 'skip-notarization': { type: 'boolean', default: false } }, allowPositionals: false })
const target = resolveDesktopBuildTarget()
const windows = target === 'win-x64'
const artifacts = desktopArtifactOutput(paths, { unsigned: values.unsigned, skipNotarization: values['skip-notarization'] }).directory
const application = windows ? join(artifacts, 'win-unpacked')
  : join(artifacts, target === 'mac-arm64' ? 'mac-arm64' : 'mac', 'Stitch.app', 'Contents')
const resources = join(application, windows ? 'resources' : 'Resources')
const executable = windows ? join(application, 'Stitch.exe') : join(application, 'MacOS', 'Stitch')
// Electron derives app.name, userData and the single-instance lock from the packaged name; the workspace
// name made a normal launch quit at once while an installed DeepSeek Harness held that lock.
const packagedName = execFileSync(executable, ['-p', 'require(process.argv[1]).name', join(resources, 'app.asar', 'package.json')],
  { encoding: 'utf8', windowsHide: true, env: desktopNodeEnvironment(executable, undefined, process.env) }).trim()
if (packagedName !== DESKTOP_PACKAGE_NAME) {
  throw new Error(`desktop package: packaged name is ${packagedName}, expected ${DESKTOP_PACKAGE_NAME}`)
}
assertNoBundledAgentCli(join(paths.dsh, 'node_modules'))
const descriptor = await verifyDesktopRuntime(paths.dsh, readDesktopRuntime(paths.dsh).release.version,
  resolveDesktopPackageTarget(target))
if (windows && !values.unsigned) await verifyWindowsCode(application)
await smokePreparedRuntime(join(resources, 'app.asar', 'dsh'), executable, join(resources, 'runtime'), descriptor)
