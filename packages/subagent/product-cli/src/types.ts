/** Product CLI records shared with clients through the plugin manager. */

/** Stable id of one product CLI. */
export type ProductCliId = 'claude-code' | 'codex'

/** Where a resolved executable came from. */
export type ProductCliSource = 'configured' | 'downloaded' | 'installed' | 'bundled'

/** A user install that runs but reports a version below the minimum. */
export interface ProductCliRejectedCandidate {
  readonly path: string
  readonly version: string
}

/** What a download fetches on one platform. */
export interface ProductCliDownloadOffer {
  /** CLI version the download installs. */
  readonly version: string
  /** Disk space the unpacked download takes, in bytes. */
  readonly sizeBytes: number
}

/** What Stitch knows about one product CLI on this machine, for status display. */
export interface ProductCliStatus {
  readonly id: ProductCliId
  /** Bundle whose subagent provider runs this CLI. */
  readonly bundle: string
  /** Product name; not localized. */
  readonly displayName: string
  /** Whether an executable the provider will use was found. */
  readonly available: boolean
  /** Where the executable comes from, when available. */
  readonly source?: ProductCliSource
  /** Absolute executable path, when available. */
  readonly path?: string
  /** Version reported by the executable, when available. */
  readonly version?: string
  /** User installs found but older than `minimumVersion`. */
  readonly tooOld: readonly ProductCliRejectedCandidate[]
  readonly minimumVersion: string
  /** What a download fetches on this platform; null when the platform has none. */
  readonly download: ProductCliDownloadOffer | null
  /** Whether a Stitch-downloaded copy exists. */
  readonly downloaded: boolean
  /** Official command a person runs to install the CLI themselves. */
  readonly installCommand: string
}
