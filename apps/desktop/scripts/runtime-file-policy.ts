/** Desktop-only omissions from already installed production npm packages. */

import { readdirSync } from 'node:fs'
import { basename } from 'node:path'

/**
 * Package-name prefixes of the Claude Code and Codex native CLI platform packages. The small JS
 * wrappers `@anthropic-ai/claude-agent-sdk` and `@openai/codex` stay bundled; the Claude Code and
 * Codex subagents resolve the user's installed CLI or a copy downloaded on demand, so the
 * ~200-300 MB native binaries (`@openai/codex-<platform>` aliases `@openai/codex@<ver>-<platform>`)
 * are never shipped in Desktop.
 */
export const DESKTOP_UNBUNDLED_AGENT_CLI_PREFIXES = ['@anthropic-ai/claude-agent-sdk-', '@openai/codex-'] as const

const AGENT_CLI_WRAPPERS = ['@anthropic-ai/claude-agent-sdk', '@openai/codex'] as const
const AGENT_CLI_BINARIES = ['claude', 'claude.exe', 'codex', 'codex.exe']

function packagePath(parts: readonly string[]): { name: string; entry: string } {
  const packageParts = parts.slice(parts.lastIndexOf('node_modules') + 1)
  const nameParts = packageParts[0]?.startsWith('@') ? 2 : 1
  return { name: packageParts.slice(0, nameParts).join('/'), entry: packageParts.slice(nameParts).join('/') }
}

/**
 * Report whether a package name is an unbundled agent CLI native platform package.
 * @param name - npm package directory name, scoped names included.
 * @returns True for Claude Code and Codex platform packages.
 */
export function isUnbundledAgentCliPackage(name: string): boolean {
  return DESKTOP_UNBUNDLED_AGENT_CLI_PREFIXES.some(prefix => name.startsWith(prefix))
}

/**
 * Reject a prepared node_modules tree that still carries a Claude Code or Codex native CLI.
 * @param modules - Prepared production node_modules directory.
 * @returns Nothing; throws naming every forbidden path.
 */
export function assertNoBundledAgentCli(modules: string): void {
  const found = new Set<string>()
  for (const path of readdirSync(modules, { recursive: true, encoding: 'utf8' })) {
    const parts = path.split(/[\\/]/u)
    const { name, entry } = packagePath(parts)
    if (isUnbundledAgentCliPackage(name)) found.add(parts.slice(0, parts.lastIndexOf('node_modules') + 1 + name.split('/').length).join('/'))
    else if (entry !== '' && (AGENT_CLI_WRAPPERS as readonly string[]).includes(name) && AGENT_CLI_BINARIES.includes(basename(path))) found.add(parts.join('/'))
  }
  if (found.size > 0) {
    throw new Error(`desktop runtime: agent CLI native binaries must not be bundled: ${[...found].sort().join(', ')}`)
  }
}

/**
 * Identify build, diagnostic and other-platform files omitted from the immutable Desktop runtime.
 * Unrecognized assets and target runtime binaries are retained. Paths name the copied
 * node_modules tree, including nested package containers.
 * @param path - Path relative to the production node_modules directory.
 * @param target - Platform and architecture of the Electron Node runtime.
 * @param officeEngine - Engine selected from the installed kit manifest.
 * @returns Omission reason, or undefined when the entry must be copied.
 */
export function desktopRuntimeFileExclusion(
  path: string, target: { platform: NodeJS.Platform; arch: string }, officeEngine: string,
): string | undefined {
  const parts = path.split(/[\\/]/u)
  if (parts.some(part => ['.bin', '.pnpm', '.modules.yaml', '.pnpm-workspace-state-v1.json'].includes(part))) {
    return 'package-manager metadata'
  }
  const file = parts.at(-1)!
  if (/\.(?:[cm]?[jt]s|css)\.map$/u.test(file)) return 'source map'
  if (/\.d\.[cm]?ts$/u.test(file)) return 'TypeScript declaration'
  if (/\.tsbuildinfo$/u.test(file)) return 'TypeScript build cache'
  const { name, entry } = packagePath(parts)
  if (isUnbundledAgentCliPackage(name)) return 'agent CLI native platform package'
  if (name.startsWith('@deepseek-ai/libreoffice-kit-')) {
    if (name !== `@deepseek-ai/libreoffice-kit-${officeEngine}`) return 'LibreOffice other platform'
  }
  if (name === 'fs-ext' && /^build\/(?:Release|Debug)\/(?:obj(?:\/|$)|fs_ext\.(?:exp|lib|pdb|iobj|ipdb)$)/u.test(entry)) {
    return 'fs-ext compiler output'
  }
  if (name === 'fs-ext' && /^build\/(?:binding\.sln|config\.gypi|fs_ext\.vcxproj(?:\.filters)?)$/u.test(entry)) {
    return 'fs-ext build configuration'
  }
  if (name === '@mixmark-io/domino' && (entry === 'test' || entry.startsWith('test/'))) return 'Domino test fixtures'
  if (name === '@mixmark-io/domino' && (entry === '.yarn' || entry.startsWith('.yarn/'))) return 'Domino development tooling'
  if (name === 'node-pty' && target.platform !== 'win32' && /^third_party\/conpty(?:\/|$)/u.test(entry)) {
    return 'node-pty Windows ConPTY sources'
  }
  if (name === 'node-pty' && entry.startsWith('prebuilds/')) {
    const platform = entry.split('/')[1]
    if (platform !== undefined && platform !== `${target.platform}-${target.arch}`) return 'node-pty other platform'
    if (file.endsWith('.pdb')) return 'node-pty debug symbols'
  }
  if (name === '@koromix/koffi-win32-x64' && entry === 'win32_x64/koffi.lib') return 'Koffi import library'
  return undefined
}
