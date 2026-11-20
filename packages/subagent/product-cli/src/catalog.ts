/**
 * The product CLIs Stitch subagents run, with the exact native package each
 * download fetches. Download pins equal the platform packages the bundled
 * SDKs declare (`@anthropic-ai/claude-agent-sdk` 0.3.263 →
 * `@anthropic-ai/claude-agent-sdk-<platform>`; `@openai/codex` 0.153.4 →
 * `@openai/codex@0.153.4-<platform>`); integrities are the npm `dist.integrity`
 * values recorded in the repository lockfile.
 *
 * @module @deepseek-ai/dsh-product-cli/catalog
 */

import type { ProductCliId } from './types.ts'

/** Every product CLI id, in display order. */
export const PRODUCT_CLI_IDS: readonly ProductCliId[] = ['claude-code', 'codex']

/** One downloadable native package for one `<platform>-<arch>` key. */
export interface ProductCliPlatformPackage {
  /** npm package name the tarball is published under. */
  readonly name: string
  /** Exact npm version of that package. */
  readonly version: string
  /** npm `dist.integrity` (sha512, base64). */
  readonly integrity: string
  /** npm `dist.unpackedSize` in bytes: the disk space the download takes. */
  readonly unpackedSize: number
  /** Executable path inside the package directory, `/`-separated. */
  readonly entry: string
}

/** Static facts about one product CLI. */
export interface ProductCliDefinition {
  readonly id: ProductCliId
  /** Product name; not localized. */
  readonly displayName: string
  /** Optional bundle whose subagent provider runs this CLI. */
  readonly bundle: string
  /** Command name on PATH, without a Windows extension. */
  readonly command: string
  /** npm package a person installs globally; its `.cmd` shim on Windows points into it. */
  readonly globalPackage: string
  /** Official command a person runs to install the CLI themselves. */
  readonly installCommand: string
  /** Oldest CLI version the bundled SDK or protocol client is known to work with. */
  readonly minimumVersion: string
  /** CLI version a Stitch download installs. */
  readonly downloadVersion: string
  /** Downloadable package per `<process.platform>-<process.arch>`. */
  readonly packages: Readonly<Partial<Record<string, ProductCliPlatformPackage>>>
}

const CLAUDE_SDK_VERSION = '0.3.263'
const CODEX_VERSION = '0.153.4'

function claudePackage(key: string, integrity: string, unpackedSize: number): ProductCliPlatformPackage {
  return {
    name: `@anthropic-ai/claude-agent-sdk-${key}`,
    version: CLAUDE_SDK_VERSION,
    integrity,
    unpackedSize,
    entry: key.startsWith('win32-') ? 'claude.exe' : 'claude',
  }
}

const CODEX_TARGETS: Readonly<Record<string, string>> = {
  'darwin-arm64': 'aarch64-apple-darwin',
  'darwin-x64': 'x86_64-apple-darwin',
  'linux-arm64': 'aarch64-unknown-linux-musl',
  'linux-x64': 'x86_64-unknown-linux-musl',
  'win32-arm64': 'aarch64-pc-windows-msvc',
  'win32-x64': 'x86_64-pc-windows-msvc',
}

/**
 * The Rust target triple the Codex npm wrapper uses for a platform key.
 * @param key - `<process.platform>-<process.arch>`.
 * @returns the triple, or undefined for a platform Codex does not publish.
 */
export function codexTargetTriple(key: string): string | undefined {
  return CODEX_TARGETS[key]
}

function codexPackage(key: string, integrity: string, unpackedSize: number): ProductCliPlatformPackage {
  const triple = CODEX_TARGETS[key] as string
  return {
    name: '@openai/codex',
    version: `${CODEX_VERSION}-${key}`,
    integrity,
    unpackedSize,
    entry: `vendor/${triple}/bin/${key.startsWith('win32-') ? 'codex.exe' : 'codex'}`,
  }
}

/** Every product CLI Stitch can run, by id. */
export const PRODUCT_CLIS: Readonly<Record<ProductCliId, ProductCliDefinition>> = {
  'claude-code': {
    id: 'claude-code',
    displayName: 'Claude Code',
    bundle: '@deepseek-ai/dsh-subagent-claude-code',
    command: 'claude',
    globalPackage: '@anthropic-ai/claude-code',
    installCommand: 'npm install -g @anthropic-ai/claude-code',
    // `claudeCodeVersion` of @anthropic-ai/claude-agent-sdk 0.3.263.
    minimumVersion: '2.1.263',
    downloadVersion: '2.1.263',
    packages: {
      'darwin-arm64': claudePackage('darwin-arm64', 'sha512-H4eLd4Tkx3rJkt739CHb+9AcaKiiOpibU4tYsmma47mV+2zAPjUyFxpuE2N57VSmpAgbLQxu44du0TFN+UH5dg==', 199258568),
      'darwin-x64': claudePackage('darwin-x64', 'sha512-jKwmfkem1s/TcK7u83cJf2zLHMz846irV4vqYGUlo74uX2qfX57R4UsrCMlcTUMou/U9vQyNCc/Kk0s+zSxYRg==', 208026528),
      'linux-arm64': claudePackage('linux-arm64', 'sha512-2KPY1wu1hdjpVsw+Tg3i50uhxhhetO1fB24wjUJAQJ8YPSogqO32UbtYPJ6I3F17lBNHb/Mq3nRYGAuSU5yjtg==', 215212029),
      'linux-x64': claudePackage('linux-x64', 'sha512-un7HJzTT+DSQLgM33emQ0qHAwIY3CXIwe8JXoD9PaT7pdLepK4Ffa4r5j84pHTVS5uoGqxcf196tBgqb5/Z7FA==', 215662653),
      'win32-arm64': claudePackage('win32-arm64', 'sha512-n8owOwNSSi7/KpONb/ut+uXRjBIp9N6EjwADiB+YygPwGRtpWP+PR/qFsGdTVBE5cpPwhgKVAf27xEZEfNvcSQ==', 209796328),
      'win32-x64': claudePackage('win32-x64', 'sha512-EwqzsOLxIJTX6RIXtQ21ekOKmYBNfwbtGtqaPqdWZGzpMbHaie8kGsM630h9RFaoxeytS/jbg8B3fPCdUKfhPw==', 218746592),
    },
  },
  codex: {
    id: 'codex',
    displayName: 'Codex',
    bundle: '@deepseek-ai/dsh-subagent-codex',
    command: 'codex',
    globalPackage: '@openai/codex',
    installCommand: 'npm install -g @openai/codex',
    // The app-server protocol client in dsh-subagent-codex is written against this release.
    minimumVersion: CODEX_VERSION,
    downloadVersion: CODEX_VERSION,
    packages: {
      'darwin-arm64': codexPackage('darwin-arm64', 'sha512-B1qhN3fa1ay0R0wGziXqgwSkB5icpYChNKHhtBHff/0UtSTC7z+l8aTtvMlGjH3E8HEvY3+njIJelM9CAAoVWg==', 288140243),
      'darwin-x64': codexPackage('darwin-x64', 'sha512-vnSbbPzfoDZmmyzsxswsDDXQ06IVFBzkQU7/hroB3ji93Ok2utcsq8Psfk2tjF5r9mEx8RWFJhzuTGHG26/NDA==', 308574766),
      'linux-arm64': codexPackage('linux-arm64', 'sha512-QKdjYLYV4hXIuUQDP3P6F4NXuWFoKo9WUoV4nAREIx55kiUyi8UsYdsVobkeXir5n/maEQgYMCKLHVma4rNPiw==', 291867383),
      'linux-x64': codexPackage('linux-x64', 'sha512-x1EcwBlY3AObM1VTUHNM2AzAJQsyreGdagpF+qFiYi/Oa30VBktvvG0C6tLtCzqW6hjZNWkGZQWmeVk7MuJKWg==', 334960666),
      'win32-arm64': codexPackage('win32-arm64', 'sha512-/FBh42976ltF1kxDoPQBg1Q6+hwChRU5/sm5dfeC8kFVQMvOCGoGeY5d8rRZGVJE8XojlXo74VQb0sHowcfgBw==', 342783649),
      'win32-x64': codexPackage('win32-x64', 'sha512-lMkB43kJZH0VFr+hoXc11qqR7QtQIbkr07ALgj4urKL1osNyUyuy1iXd3Vzz2iCYvBUCSw7I0l/W1cEPGx9euQ==', 395725468),
    },
  },
}

/**
 * The downloadable package for one CLI on one platform.
 * @param id - product CLI.
 * @param platform - `process.platform` value.
 * @param arch - `process.arch` value.
 * @returns the pinned package, or undefined when the platform has no download.
 */
export function productCliPackage(id: ProductCliId, platform: string, arch: string): ProductCliPlatformPackage | undefined {
  return PRODUCT_CLIS[id].packages[`${platform}-${arch}`]
}
