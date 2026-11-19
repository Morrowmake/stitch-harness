/** Opt-in check of the latest GitHub release; it never downloads or installs anything. */
import { gt, prerelease, valid } from 'semver'
import type { DesktopUpdateCheckResult } from './ipc.ts'

/** The only update endpoint; GitHub excludes drafts and prereleases from it. */
export const LATEST_RELEASE_URL = 'https://api.github.com/repos/Morrowmake/stitch-harness/releases/latest'
/** Every offered release page must belong to the project's own releases. */
const RELEASE_PAGE_PREFIX = 'https://github.com/Morrowmake/stitch-harness/releases/'
/** Automatic checks run at startup and then once a day while the preference stays on. */
export const UPDATE_CHECK_INTERVAL_MS = 24 * 60 * 60 * 1000
const REQUEST_TIMEOUT_MS = 15_000

/** A newer published release; `url` is opened in the external browser and never reaches the renderer. */
export interface DesktopRelease {
  readonly version: string
  readonly name: string
  readonly url: string
}

/** Host-side check outcome; the renderer receives it without the release page URL. */
export type DesktopUpdateCheckOutcome =
  | { readonly kind: 'available'; readonly release: DesktopRelease }
  | Exclude<DesktopUpdateCheckResult, { kind: 'available' }>

/** Proxy-aware request function; production passes Electron's `net.fetch`. */
export type DesktopUpdateFetch = (url: string, init: RequestInit) => Promise<Response>

/**
 * Select an offerable release from GitHub's `releases/latest` response.
 * Drafts are never offered; prereleases only when the running version is itself a prerelease.
 * @param body - Untrusted JSON response.
 * @param currentVersion - Running application version.
 * @returns The newer release, or undefined when the running version is current.
 * @throws When the response is not a usable release.
 */
export function newerRelease(body: unknown, currentVersion: string): DesktopRelease | undefined {
  if (typeof body !== 'object' || body === null) throw new Error('desktop update: release response is not an object')
  const { tag_name: tag, name, html_url: url, draft, prerelease: preview } = body as Record<string, unknown>
  if (typeof tag !== 'string' || typeof url !== 'string' || !url.startsWith(RELEASE_PAGE_PREFIX)) {
    throw new Error('desktop update: release response lacks a tag or project release page')
  }
  const version = valid(tag.replace(/^v/u, ''))
  const current = valid(currentVersion)
  if (version === null || current === null) throw new Error('desktop update: release or running version is not semver')
  if (draft === true) return undefined
  if ((preview === true || prerelease(version) !== null) && prerelease(current) === null) return undefined
  if (!gt(version, current)) return undefined
  return { version, name: typeof name === 'string' && name.trim() !== '' ? name.trim() : tag, url }
}

/**
 * Request the latest release with no credentials, cookies, or headers beyond the product User-Agent.
 * @param fetch - Proxy-aware request function.
 * @param currentVersion - Running application version, also sent as the User-Agent version.
 * @returns The comparison result; any network, HTTP, or format failure is `failed`.
 */
export async function checkLatestRelease(fetch: DesktopUpdateFetch, currentVersion: string): Promise<DesktopUpdateCheckOutcome> {
  try {
    const response = await fetch(LATEST_RELEASE_URL, {
      method: 'GET',
      headers: { 'User-Agent': `Stitch/${currentVersion}`, Accept: 'application/vnd.github+json' },
      credentials: 'omit',
      cache: 'no-store',
      redirect: 'follow',
      referrerPolicy: 'no-referrer',
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    })
    if (!response.ok) throw new Error(`desktop update: GitHub answered HTTP ${String(response.status)}`)
    const release = newerRelease(await response.json(), currentVersion)
    return release === undefined ? { kind: 'current', version: currentVersion } : { kind: 'available', release }
  } catch (error) {
    console.warn('desktop update: check failed', error instanceof Error ? error.message : String(error))
    return { kind: 'failed' }
  }
}

/** Gating, daily scheduling, and joining of checks; with the preference off no request is made. */
export class DesktopUpdateChecker {
  private timer: ReturnType<typeof setTimeout> | undefined
  private pending: Promise<DesktopUpdateCheckOutcome> | undefined
  private disposed = false

  /**
   * @param options.currentVersion - Running application version.
   * @param options.enabled - Current persisted preference.
   * @param options.fetch - Proxy-aware request function.
   * @param options.onAvailable - Presents an automatically found release; never awaited.
   * @param options.intervalMs - Delay between automatic checks.
   */
  constructor(private readonly options: {
    readonly currentVersion: string
    readonly enabled: () => boolean
    readonly fetch: DesktopUpdateFetch
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
    this.pending ??= checkLatestRelease(this.options.fetch, this.options.currentVersion)
      .finally(() => { this.pending = undefined })
    return this.pending
  }
}
