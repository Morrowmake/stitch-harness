/**
 * Locations of Stitch-downloaded product CLIs:
 * `$STITCH_HOME/data/product-cli/<id>/<package version>/`, holding the npm
 * package contents.
 *
 * @module @deepseek-ai/dsh-product-cli/store
 */

import { join } from 'node:path'
import { dshPath } from '@deepseek-ai/dsh-home-paths'
import type { ProductCliPlatformPackage } from './catalog.ts'
import type { ProductCliId } from './types.ts'

/** Stitch home selection shared by the store helpers. */
export interface ProductCliStoreOptions {
  /** Stitch home override; omission uses `$STITCH_HOME`, then `~/.stitch`. */
  readonly dshHome?: string | undefined
}

/**
 * The directory holding every downloaded product CLI.
 * @param options - Stitch home override.
 * @returns `$STITCH_HOME/data/product-cli`.
 */
export function productCliRoot(options: ProductCliStoreOptions = {}): string {
  return dshPath({ category: 'data', dshHome: options.dshHome }, 'product-cli')
}

/**
 * The directory a download of one package version unpacks into.
 * @param id - product CLI.
 * @param pinned - downloadable package.
 * @param options - Stitch home override.
 * @returns the install directory.
 */
export function productCliInstallDir(id: ProductCliId, pinned: ProductCliPlatformPackage, options: ProductCliStoreOptions = {}): string {
  return join(productCliRoot(options), id, pinned.version)
}

/**
 * The executable of a downloaded package version; it may not exist.
 * @param id - product CLI.
 * @param pinned - downloadable package.
 * @param options - Stitch home override.
 * @returns the executable path.
 */
export function downloadedProductCliPath(
  id: ProductCliId, pinned: ProductCliPlatformPackage, options: ProductCliStoreOptions = {},
): string {
  return join(productCliInstallDir(id, pinned, options), ...pinned.entry.split('/'))
}
