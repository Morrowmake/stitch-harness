/**
 * Memory-only usage cache per `(route, account)`: endpoint snapshots with a
 * TTL, in-flight dedupe, negative caching that honours the endpoint's own
 * `retry-after`, stale snapshots served through failures, and header-derived
 * windows merged on top. Nothing here is persisted and nothing here decides
 * when to fetch; callers (the `llmAccounts` service) do.
 *
 * Portions derived from dsh-plugin-subscriptions
 * (https://github.com/V1ki/dsh-plugin-subscriptions), Copyright (c) 2026 V1ki,
 * MIT License.
 *
 * @module dsh-llm-pi-ai/accounts/usage/cache
 */

import type { UsagePeek } from '../runtime.ts'
import type { AccountId, UsageSnapshotView } from '../types.ts'
import { mergeWindows } from './headers.ts'
import type { HeaderUsage } from './headers.ts'
import { UsageCredentialError, UsageFetchError } from './http.ts'
import type { FetchedUsage } from './http.ts'

/** Snapshot freshness. */
export const USAGE_TTL_MS = 5 * 60_000
/** Failure cooldown when the endpoint names none. */
export const USAGE_FAILURE_TTL_MS = 5 * 60_000

interface Entry {
  /** Last successful endpoint lookup. */
  snapshot?: FetchedUsage & { fetchedAt: number }
  headers?: HeaderUsage
  /** Live failure cooldown. */
  failure?: { until: number }
  inflight?: Promise<void>
}

/** Clock, lifetimes, and change hook of a {@link UsageCache}. */
export interface UsageCacheOptions {
  /** Clock in epoch milliseconds; defaults to `Date.now`. */
  now?: () => number
  /** How long an endpoint or header snapshot stays fresh; defaults to {@link USAGE_TTL_MS}. */
  ttlMs?: number
  /** How long a failed lookup blocks the next one when the provider names no wait; defaults to {@link USAGE_FAILURE_TTL_MS}. */
  failureTtlMs?: number
  /** Called whenever an account's composed view may have changed. */
  onChange?: (route: string, account: AccountId) => void
}

/** Loads one endpoint snapshot; the signal ends when the caller gives up. */
export type UsageLoader = (signal: AbortSignal | undefined) => Promise<FetchedUsage>

/**
 * Per-account usage: the last endpoint snapshot, newer header-derived windows,
 * and a failure cooldown, composed into one view without I/O on read.
 */
export class UsageCache implements UsagePeek {
  private readonly entries = new Map<string, Entry>()
  private readonly now: () => number
  private readonly ttlMs: number
  private readonly failureTtlMs: number
  private readonly onChange: (route: string, account: AccountId) => void

  constructor(options: UsageCacheOptions = {}) {
    this.now = options.now ?? Date.now
    this.ttlMs = options.ttlMs ?? USAGE_TTL_MS
    this.failureTtlMs = options.failureTtlMs ?? USAGE_FAILURE_TTL_MS
    this.onChange = options.onChange ?? (() => undefined)
  }

  /**
   * The composed view, synchronously and without I/O (the scheduler's read).
   * @returns the view, or undefined when nothing is known about the account.
   */
  peek(route: string, account: AccountId): UsageSnapshotView | undefined {
    const entry = this.entries.get(keyOf(route, account))
    if (entry === undefined) return undefined
    const now = this.now()
    const failure = entry.failure !== undefined && entry.failure.until > now
      ? { refreshFailed: true, retryAt: entry.failure.until }
      : undefined
    const { snapshot, headers } = entry
    if (snapshot !== undefined) {
      const staleAt = snapshot.fetchedAt + this.ttlMs
      const newerHeaders = headers !== undefined && headers.at > snapshot.fetchedAt ? headers.windows : []
      return {
        supported: true,
        source: 'endpoint',
        fetchedAt: snapshot.fetchedAt,
        staleAt,
        ...now >= staleAt ? { stale: true } : {},
        ...failure,
        ...snapshot.plan === undefined ? {} : { plan: snapshot.plan },
        windows: mergeWindows(snapshot.windows, newerHeaders),
        ...snapshot.credits === undefined ? {} : { credits: snapshot.credits },
      }
    }
    if (headers !== undefined) {
      return {
        supported: true,
        source: 'headers',
        fetchedAt: headers.at,
        staleAt: headers.at + this.ttlMs,
        ...now >= headers.at + this.ttlMs ? { stale: true } : {},
        ...failure,
        windows: headers.windows,
      }
    }
    if (failure !== undefined) return { supported: true, source: 'endpoint', ...failure, windows: [] }
    return undefined
  }

  /**
   * Whether the endpoint snapshot is fresh or a failure cooldown is live (nothing to fetch now).
   * @param route - the provider route key.
   * @param account - the account id.
   * @returns true when a refresh would not poll now.
   */
  settled(route: string, account: AccountId): boolean {
    const entry = this.entries.get(keyOf(route, account))
    if (entry === undefined) return false
    const now = this.now()
    if (entry.failure !== undefined && entry.failure.until > now) return true
    return entry.snapshot !== undefined && now < entry.snapshot.fetchedAt + this.ttlMs
  }

  /**
   * Refresh one account through `load` unless a fresh snapshot exists
   * (`force` skips that check) or a failure cooldown is live (never skipped).
   * Concurrent callers share one lookup.
   * @param route - the provider route key.
   * @param account - the account id.
   * @param load - polls the account's usage endpoint.
   * @param options - `force` skips the freshness check; `signal` ends this caller's wait.
   * @returns the composed view after the lookup (stale data survives failures).
   * @throws {UsageCredentialError} when the account has no usable token (not negative-cached).
   */
  async refresh(
    route: string,
    account: AccountId,
    load: UsageLoader,
    options: { force?: boolean; signal?: AbortSignal } = {},
  ): Promise<UsageSnapshotView | undefined> {
    const key = keyOf(route, account)
    let entry = this.entries.get(key)
    if (entry === undefined) {
      entry = {}
      this.entries.set(key, entry)
    }
    const now = this.now()
    const cooling = entry.failure !== undefined && entry.failure.until > now
    const fresh = entry.snapshot !== undefined && now < entry.snapshot.fetchedAt + this.ttlMs
    if (cooling || (fresh && options.force !== true)) return this.peek(route, account)
    entry.inflight ??= this.load(route, account, entry, load, options.signal)
    await entry.inflight
    return this.peek(route, account)
  }

  private async load(route: string, account: AccountId, entry: Entry, load: UsageLoader, signal: AbortSignal | undefined): Promise<void> {
    try {
      const fetched = await load(signal)
      entry.snapshot = { ...fetched, fetchedAt: this.now() }
      delete entry.failure
    } catch (error) {
      if (error instanceof UsageCredentialError) throw error
      if (signal?.aborted === true) throw error
      const wait = error instanceof UsageFetchError && error.retryAfterMs !== undefined ? error.retryAfterMs : this.failureTtlMs
      entry.failure = { until: this.now() + wait }
    } finally {
      delete entry.inflight
      // A removal during the lookup dropped the entry; do not resurrect it.
      if (this.entries.get(keyOf(route, account)) === entry) this.onChange(route, account)
    }
  }

  /**
   * Merge header-derived windows from an inference response.
   * @param route - the provider route key.
   * @param account - the account id.
   * @param headers - the observation instant and its windows (empty windows are ignored).
   */
  observe(route: string, account: AccountId, headers: HeaderUsage): void {
    if (headers.windows.length === 0) return
    const key = keyOf(route, account)
    const entry = this.entries.get(key) ?? {}
    this.entries.set(key, entry)
    if (entry.headers !== undefined && entry.headers.at > headers.at) return
    entry.headers = entry.headers === undefined
      ? headers
      : { at: headers.at, windows: mergeWindows(entry.headers.windows, headers.windows) }
    this.onChange(route, account)
  }

  /**
   * Mark the endpoint snapshot stale so the next refresh re-polls (keeps the failure cooldown).
   * @param route - the provider route key.
   * @param account - the account id.
   */
  expire(route: string, account: AccountId): void {
    const snapshot = this.entries.get(keyOf(route, account))?.snapshot
    if (snapshot !== undefined) snapshot.fetchedAt = Math.min(snapshot.fetchedAt, this.now() - this.ttlMs)
  }

  /**
   * Forget one account (or every account of the route): removal or a new sign-in.
   * @param route - the provider route key.
   * @param account - the account to forget, or undefined for every account of the route.
   */
  invalidate(route: string, account?: AccountId): void {
    for (const key of [...this.entries.keys()]) {
      if (account === undefined ? key.startsWith(`${route}\u0000`) : key === keyOf(route, account)) this.entries.delete(key)
    }
  }

  /**
   * Drop entries of accounts that no longer exist.
   * @param route - the provider route key.
   * @param accounts - the route's current account ids.
   */
  retain(route: string, accounts: ReadonlySet<AccountId>): void {
    for (const key of [...this.entries.keys()]) {
      const [entryRoute, entryAccount] = key.split('\u0000')
      if (entryRoute === route && entryAccount !== undefined && !accounts.has(entryAccount)) this.entries.delete(key)
    }
  }
}

function keyOf(route: string, account: AccountId): string {
  return `${route}\u0000${account}`
}
