/**
 * Pure account selection for one request (design §4.5): ordered failover with
 * session affinity and cooldowns. Usage snapshots only *defer* an account a
 * fresh snapshot shows exhausted; nothing here fetches.
 *
 * Portions derived from dsh-plugin-subscriptions
 * (https://github.com/V1ki/dsh-plugin-subscriptions), Copyright (c) 2026 V1ki,
 * MIT License.
 *
 * @module dsh-llm-pi-ai/accounts/scheduler
 */

import type { AccountRuntime, UsagePeek } from './runtime.ts'
import type { AccountId, UsageSnapshotView } from './types.ts'

/** Session affinity bound (oldest evicted). */
export const STICKY_CAPACITY = 1000

/** `sessionKey → account` LRU, in memory only. */
export class StickyMap {
  private readonly entries = new Map<string, AccountId>()

  constructor(private readonly capacity = STICKY_CAPACITY) {}

  /**
   * The account a session is bound to.
   * @param key - the session key (`${sessionId}|${route}`).
   * @returns the bound account id, or undefined when the session has none.
   */
  get(key: string): AccountId | undefined {
    return this.entries.get(key)
  }

  /**
   * Bind a session to an account, marking it most recently used and evicting the oldest past capacity.
   * @param key - the session key (`${sessionId}|${route}`).
   * @param account - the account that served the session.
   */
  remember(key: string, account: AccountId): void {
    this.entries.delete(key)
    this.entries.set(key, account)
    while (this.entries.size > this.capacity) {
      const oldest = this.entries.keys().next().value
      if (oldest === undefined) break
      this.entries.delete(oldest)
    }
  }

  /**
   * Forget every session bound to a removed account of `route`.
   * @param route - the provider route key.
   * @param account - the removed account, or undefined for every account of the route.
   */
  forget(route: string, account?: AccountId): void {
    for (const [key, value] of [...this.entries]) {
      if (key.endsWith(`|${route}`) && (account === undefined || value === account)) this.entries.delete(key)
    }
  }
}

/**
 * `models` absent = all models; `[]` = none.
 * @param models - the account's model allowlist.
 * @param modelId - the requested provider model id.
 * @returns true when the allowlist admits the model.
 */
export function allows(models: readonly string[] | undefined, modelId: string): boolean {
  return models === undefined || models.includes(modelId)
}

/**
 * Order `[default, …by (order ?? ∞, createdAt ?? ∞, id)]`.
 * @param accounts - the accounts to order.
 * @returns a new array in scheduling order.
 */
export function orderAccounts<T extends Pick<AccountRuntime, 'id' | 'isDefault' | 'meta'>>(accounts: readonly T[]): T[] {
  const rank = (value: number | undefined): number => value ?? Number.POSITIVE_INFINITY
  return [...accounts].sort((left, right) => {
    if (left.isDefault !== right.isDefault) return left.isDefault ? -1 : 1
    const byOrder = rank(left.meta.order) - rank(right.meta.order)
    if (byOrder !== 0 && !Number.isNaN(byOrder)) return byOrder
    const byCreated = rank(left.meta.createdAt) - rank(right.meta.createdAt)
    if (byCreated !== 0 && !Number.isNaN(byCreated)) return byCreated
    return left.id < right.id ? -1 : left.id > right.id ? 1 : 0
  })
}

/**
 * Fresh snapshot with a window at ≥100 % that has not reset, and no spendable credits.
 * @param snapshot - the account's cached usage snapshot, if any.
 * @param now - the current instant, in epoch milliseconds.
 * @returns true when the snapshot shows the account exhausted.
 */
export function isExhausted(snapshot: UsageSnapshotView | undefined, now: number): boolean {
  if (snapshot === undefined || snapshot.staleAt === undefined || now > snapshot.staleAt) return false
  if (snapshot.credits !== undefined && (snapshot.credits.unlimited || snapshot.credits.hasCredits)) return false
  return snapshot.windows.some(window => (window.usedPercent ?? 0) >= 100 && (window.resetsAt === undefined || window.resetsAt > now))
}

/** Inputs of {@link select} for one request. */
export interface SelectInput {
  /** The provider route key. */
  route: string
  /** The route's accounts. */
  candidates: readonly AccountRuntime[]
  /** The requested provider model id. */
  modelId: string
  /** The session key the request is sticky to, if any. */
  sessionKey?: string
  /** The current instant, in epoch milliseconds. */
  now: number
  /** Whether the account can serve the model now (not cooling, not needs-sign-in). */
  available: (account: AccountRuntime) => boolean
  /** Cached usage that defers accounts a fresh snapshot shows exhausted. */
  usage?: UsagePeek
  /** Session-to-account stickiness that moves the bound account first. */
  sticky?: { get(key: string): AccountId | undefined }
}

/**
 * Accounts to try, in order; empty ⇒ the caller builds the exhausted error.
 * @param input - the route's accounts, requested model, availability, usage, and stickiness.
 * @returns the accounts to attempt, exhausted ones last.
 */
export function select(input: SelectInput): AccountRuntime[] {
  const { candidates, modelId, now } = input
  let eligible = candidates.filter(account => account.meta.pooled && allows(account.meta.models, modelId) && input.available(account))
  if (eligible.length === 0) {
    // A route never dies because its only usable account (the default) is unpooled.
    const fallback = candidates.find(account => account.isDefault && !account.meta.pooled)
    if (fallback !== undefined && allows(fallback.meta.models, modelId) && input.available(fallback)) eligible = [fallback]
  }
  const preferred: AccountRuntime[] = []
  const deferred: AccountRuntime[] = []
  for (const account of orderAccounts(eligible)) {
    (isExhausted(input.usage?.peek(input.route, account.id), now) ? deferred : preferred).push(account)
  }
  const stickyId = input.sessionKey === undefined ? undefined : input.sticky?.get(input.sessionKey)
  const at = stickyId === undefined ? -1 : preferred.findIndex(account => account.id === stickyId)
  if (at > 0) preferred.unshift(...preferred.splice(at, 1))
  return [...preferred, ...deferred]
}
