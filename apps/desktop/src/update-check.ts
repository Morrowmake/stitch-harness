/** Check of the project's GitHub releases and their signed update manifests; installers are downloaded only by update-install.ts. */
import { gt, prerelease, valid } from 'semver'
import type { DesktopUpdateCheckResult } from './ipc.ts'
import {
  selectUpdateAsset, UPDATE_MANIFEST_NAME, verifyUpdateManifest, type UpdateAsset, type UpdateManifest,
} from './update-manifest.ts'

/** Release list endpoint; `releases/latest` excludes prereleases, which this project ships. */
export const RELEASES_URL = 'https://api.github.com/repos/Morrowmake/stitch-harness/releases?per_page=30'
/** Every offered release page and download must belong to the project's own releases. */
const RELEASES_PREFIX = 'https://github.com/Morrowmake/stitch-harness/releases/'
/** Automatic checks run at startup and then once a day while the preference stays on. */
export const UPDATE_CHECK_INTERVAL_MS = 24 * 60 * 60 * 1000
const REQUEST_TIMEOUT_MS = 15_000
const TAG = /^[A-Za-z0-9][A-Za-z0-9._-]*$/u

/**
 * @param tag - Release tag.
 * @param name - Release asset name.
 * @returns The project's download URL for that asset.
 */
export function releaseAssetUrl(tag: string, name: string): string {
  return `${RELEASES_PREFIX}download/${encodeURIComponent(tag)}/${encodeURIComponent(name)}`
}

/** Verified one-click install source for this platform. */
export interface DesktopReleaseInstall {
  readonly manifest: UpdateManifest
  readonly asset: UpdateAsset
}

/** A newer published release; `url` is opened in the external browser and never reaches the renderer. */
export interface DesktopRelease {
  readonly version: string
  readonly tag: string
  readonly name: string
  readonly url: string
  /** Present only when a manifest signed by an embedded key lists this platform's asset. */
  readonly install?: DesktopReleaseInstall
}

/** Host-side check outcome; the renderer receives it without the release page URL. */
export type DesktopUpdateCheckOutcome =
  | { readonly kind: 'available'; readonly release: DesktopRelease }
  | Exclude<DesktopUpdateCheckResult, { kind: 'available' }>

/** Proxy-aware request function; production passes Electron's `net.fetch`. */
export type DesktopUpdateFetch = (url: string, init: RequestInit) => Promise<Response>

/** Inputs of the signed-manifest lookup. */
export interface DesktopUpdateTarget {
  /** Trusted raw base64 ed25519 keys; empty means no manifest is fetched and no one-click install is offered. */
  readonly keys: readonly string[]
  readonly platform: string
  readonly arch: string
}

/**
 * Select an offerable release from GitHub's release list.
 * Drafts and entries without a project release page or semver tag are skipped; prereleases are offered only
 * when the running version is itself a prerelease. Tags are `stitch-v<version>` (a bare `v` prefix is accepted).
 * @param body - Untrusted JSON response.
 * @param currentVersion - Running application version.
 * @returns The newest eligible release when it is newer than the running version.
 * @throws When the response is not a release list or the running version is not semver.
 */
export function newerRelease(body: unknown, currentVersion: string): Omit<DesktopRelease, 'install'> | undefined {
  if (!Array.isArray(body)) throw new Error('desktop update: release response is not a list')
  const current = valid(currentVersion)
  if (current === null) throw new Error('desktop update: running version is not semver')
  let best: Omit<DesktopRelease, 'install'> | undefined
  for (const entry of body as unknown[]) {
    if (typeof entry !== 'object' || entry === null) continue
    const { tag_name: tag, name, html_url: url, draft, prerelease: preview } = entry as Record<string, unknown>
    if (draft === true || typeof tag !== 'string' || !TAG.test(tag) || typeof url !== 'string' || !url.startsWith(RELEASES_PREFIX)) continue
    const version = valid(tag.replace(/^(?:stitch-)?v/u, ''))
    if (version === null) continue
    if ((preview === true || prerelease(version) !== null) && prerelease(current) === null) continue
    if (best !== undefined && !gt(version, best.version)) continue
    best = { version, tag, name: typeof name === 'string' && name.trim() !== '' ? name.trim() : tag, url }
  }
  return best !== undefined && gt(best.version, current) ? best : undefined
}

/**
 * Verify a release's `latest.json` and pick this platform's asset.
 * @param body - Untrusted manifest JSON.
 * @param release - Release selected from the list.
 * @param currentVersion - Running application version.
 * @param target - Trusted keys and running platform.
 * @returns The install source, or undefined when the manifest has no asset for this platform.
 * @throws When the signature, tag, or version does not match, including downgrades.
 */
export function releaseInstall(body: unknown, release: Pick<DesktopRelease, 'version' | 'tag'>, currentVersion: string,
  target: DesktopUpdateTarget): DesktopReleaseInstall | undefined {
  const manifest = verifyUpdateManifest(body, target.keys)
  if (manifest.tag !== release.tag || valid(manifest.version) !== release.version) {
    throw new Error('desktop update: manifest does not describe the selected release')
  }
  if (!gt(manifest.version, currentVersion)) throw new Error('desktop update: manifest is not newer than the running version')
  const asset = selectUpdateAsset(manifest, target.platform, target.arch)
  return asset === undefined ? undefined : { manifest, asset }
}

function request(fetch: DesktopUpdateFetch, url: string, currentVersion: string, accept: string): Promise<Response> {
  return fetch(url, {
    method: 'GET',
    headers: { 'User-Agent': `Stitch/${currentVersion}`, Accept: accept },
    credentials: 'omit',
    cache: 'no-store',
    redirect: 'follow',
    referrerPolicy: 'no-referrer',
    signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
  })
}

/**
 * Request the release list, then the selected release's signed manifest, with no credentials, cookies, or headers
 * beyond the product User-Agent.
 * @param fetch - Proxy-aware request function.
 * @param currentVersion - Running application version, also sent as the User-Agent version.
 * @param target - Trusted keys and running platform; without keys or a platform asset the release is offered for manual download.
 * @returns The comparison result; any list failure is `failed`. A manifest failure only withholds one-click install.
 */
export async function checkLatestRelease(fetch: DesktopUpdateFetch, currentVersion: string,
  target: DesktopUpdateTarget): Promise<DesktopUpdateCheckOutcome> {
  let release: DesktopRelease | undefined
  try {
    const response = await request(fetch, RELEASES_URL, currentVersion, 'application/vnd.github+json')
    if (!response.ok) throw new Error(`desktop update: GitHub answered HTTP ${String(response.status)}`)
    release = newerRelease(await response.json(), currentVersion)
  } catch (error) {
    console.warn('desktop update: check failed', error instanceof Error ? error.message : String(error))
    return { kind: 'failed' }
  }
  if (release === undefined) return { kind: 'current', version: currentVersion }
  if (target.keys.length === 0) return { kind: 'available', release }
  try {
    const response = await request(fetch, releaseAssetUrl(release.tag, UPDATE_MANIFEST_NAME), currentVersion, 'application/json')
    if (!response.ok) throw new Error(`desktop update: manifest answered HTTP ${String(response.status)}`)
    const install = releaseInstall(await response.json(), release, currentVersion, target)
    return { kind: 'available', release: install === undefined ? release : { ...release, install } }
  } catch (error) {
    console.warn('desktop update: one-click update unavailable', error instanceof Error ? error.message : String(error))
    return { kind: 'available', release }
  }
}

/** Daily scheduling and joining of checks; with the preference off no automatic request is made. */
export class DesktopUpdateChecker {
  private timer: ReturnType<typeof setTimeout> | undefined
  private pending: Promise<DesktopUpdateCheckOutcome> | undefined
  private disposed = false

  /**
   * @param options.currentVersion - Running application version.
   * @param options.enabled - Current persisted preference.
   * @param options.fetch - Proxy-aware request function.
   * @param options.target - Trusted keys and running platform for the signed manifest.
   * @param options.onAvailable - Presents an automatically found release; never awaited.
   * @param options.intervalMs - Delay between automatic checks.
   */
  constructor(private readonly options: {
    readonly currentVersion: string
    readonly enabled: () => boolean
    readonly fetch: DesktopUpdateFetch
    readonly target: DesktopUpdateTarget
    readonly onAvailable: (release: DesktopRelease) => void
    readonly intervalMs?: number
  }) {}

  /**
   * Apply the preference: enabling checks immediately and arms the daily timer; disabling disarms it.
   * Call at startup and after every preference change.
   */
  sync(): void {
    if (this.disposed) return
    if (!this.options.enabled()) {
      clearTimeout(this.timer)
      this.timer = undefined
      return
    }
    if (this.timer !== undefined) return
    this.timer = setTimeout(() => {
      this.timer = undefined
      this.sync()
    }, this.options.intervalMs ?? UPDATE_CHECK_INTERVAL_MS)
    void this.run().then((result) => {
      if (result.kind === 'available' && !this.disposed && this.options.enabled()) this.options.onAvailable(result.release)
    })
  }

  /**
   * Explicit user request; runs regardless of the preference and joins an in-flight check.
   * @returns The result to report to the user.
   */
  checkNow(): Promise<DesktopUpdateCheckOutcome> {
    if (this.disposed) return Promise.resolve({ kind: 'failed' })
    return this.run()
  }

  /** Stop automatic checks; in-flight results are no longer presented. */
  dispose(): void {
    this.disposed = true
    clearTimeout(this.timer)
    this.timer = undefined
  }

  private run(): Promise<DesktopUpdateCheckOutcome> {
    this.pending ??= checkLatestRelease(this.options.fetch, this.options.currentVersion, this.options.target)
      .finally(() => { this.pending = undefined })
    return this.pending
  }
}
