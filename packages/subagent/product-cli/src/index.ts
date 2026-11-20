/**
 * Claude Code and Codex executables for the product subagents: find the
 * user's own install or a Stitch download, describe the result for the UI,
 * and download or remove the pinned native CLI on request. Stitch
 * installations do not bundle these native CLIs.
 *
 * @module @deepseek-ai/dsh-product-cli
 */

import { PRODUCT_CLIS, productCliPackage } from './catalog.ts'
import { NODE_PRODUCT_CLI_HOST, resolveProductCli, type ProductCliResolution, type ProductCliResolveOptions } from './resolve.ts'
import { downloadedProductCliPath } from './store.ts'
import type { ProductCliId, ProductCliStatus } from './types.ts'

export * from './catalog.ts'
export * from './download.ts'
export * from './resolve.ts'
export * from './store.ts'
export type * from './types.ts'

/**
 * Describe one CLI: resolution without a configured path or development-checkout source, plus download facts.
 * @param id - product CLI.
 * @param options - Stitch home, environment, and platform overrides.
 * @returns the status the UI shows.
 */
export async function productCliStatus(
  id: ProductCliId,
  options: Omit<ProductCliResolveOptions, 'executablePath'> = {},
): Promise<ProductCliStatus> {
  const definition = PRODUCT_CLIS[id]
  const pinned = productCliPackage(id, options.platform ?? process.platform, options.arch ?? process.arch)
  const resolution = await resolveProductCli(id, options)
  const host = options.host ?? NODE_PRODUCT_CLI_HOST
  return {
    id,
    bundle: definition.bundle,
    displayName: definition.displayName,
    available: resolution.found,
    // Without a configured path every found source carries a version.
    ...resolution.found ? { source: resolution.source, path: resolution.path, version: resolution.version as string } : {},
    tooOld: resolution.tooOld,
    minimumVersion: definition.minimumVersion,
    download: pinned === undefined ? null : { version: definition.downloadVersion, sizeBytes: pinned.unpackedSize },
    downloaded: pinned !== undefined && host.isFile(downloadedProductCliPath(id, pinned, options)),
    installCommand: definition.installCommand,
  }
}

/**
 * The actionable failure text for a run that found no usable executable.
 * @param resolution - a resolution with `found: false`.
 * @param platform - platform whose download size is quoted.
 * @param arch - architecture whose download size is quoted.
 * @returns one paragraph naming how to install the CLI, and any rejected install or missing configured path.
 */
export function productCliMissingMessage(
  resolution: Extract<ProductCliResolution, { found: false }>,
  platform: string = process.platform,
  arch: string = process.arch,
): string {
  const definition = PRODUCT_CLIS[resolution.id]
  const name = definition.displayName
  if (resolution.configuredMissing !== undefined) {
    return `${name} executable not found at the configured executablePath ${resolution.configuredMissing}. `
      + `Correct or clear executablePath in the ${name} subagent plugin settings.`
  }
  const pinned = productCliPackage(resolution.id, platform, arch)
  const fromStitch = pinned === undefined
    ? ''
    : `Install it from Plugins → ${name} subagent → Download (about ${Math.round(pinned.unpackedSize / 1_000_000)} MB), or install it yourself: `
  const rejected = resolution.tooOld.map(candidate => ` Found ${name} ${candidate.version} at ${candidate.path}, but Stitch needs ${definition.minimumVersion} or newer.`).join('')
  return `${name} isn't installed. ${fromStitch === '' ? 'Install it yourself: ' : fromStitch}${definition.installCommand}, then retry.${rejected}`
}
