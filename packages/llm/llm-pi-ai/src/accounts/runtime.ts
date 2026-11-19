/**
 * Host-only contract between the account pool (router, directory, health) and
 * the `llmAccounts` Remote service. Slice B consumes {@link AccountsRuntime};
 * the pool reads usage only through {@link UsagePeek}.
 *
 * @module dsh-llm-pi-ai/accounts/runtime
 */

import type { Models } from '@earendil-works/pi-ai'
import type { CredentialKey } from '@deepseek-ai/dsh-credentials'
import type { AccountHealth, AccountId, AccountKind, AccountProfile, UsageSnapshotView, UsageWindowView } from './types.ts'

/** One account of one route as the Host sees it. */
export interface AccountRuntime {
  provider: string
  id: AccountId
  kind: AccountKind
  /** Metadata with defaults applied (`pooled` and `pinned` always set). */
  meta: AccountProfile & { pooled: boolean; pinned: boolean }
  /** Absent for `env`/`ambient`. */
  recordKey?: CredentialKey
  isDefault: boolean
}

/** Accounts per route, from credential records + profile metadata. */
export interface AccountDirectory {
  /** Ordered `[default, …by (order, createdAt, id)]`. */
  forRoute(route: string): Promise<readonly AccountRuntime[]>
  /** Drop cached views (record or settings change). */
  invalidate(): void
}

/** In-memory cooldowns and sign-in state per account. */
export interface HealthRegistry {
  /** Account-level view; with `model`, also model-scoped cooldowns. */
  view(route: string, account: AccountId, model?: string, now?: number): AccountHealth
  /** Forget cooldowns/sign-in state of one account or the whole route. */
  clear(route: string, account?: AccountId): void
  /** Subscribe to any change; returns the disposer. */
  onChange(cb: () => void): () => void
}

/** What one HTTP response of an attempt revealed (headers whitelisted, body parsed then dropped). */
export interface Observation {
  at: number
  status: number
  ok: boolean
  /** Epoch ms from `retry-after` (or provider reset reader). */
  retryAfterAt?: number
  /** Epoch ms of the refusing window's reset, when a 429 names one. */
  resetAt?: number
  windows: readonly UsageWindowView[]
}

/** Implemented by Slice B's usage cache; synchronous, never does I/O. */
export interface UsagePeek {
  peek(route: string, account: AccountId): UsageSnapshotView | undefined
}

/** The pool facts and hooks the `llmAccounts` Remote reads and drives. */
export interface AccountsRuntime {
  /** The accounts of each route. */
  directory: AccountDirectory
  /** Cooldown and sign-in state of every account. */
  health: HealthRegistry
  /** Session-to-account stickiness. */
  sticky: { get(sessionKey: string): AccountId | undefined }
  /** Account-scoped pi-ai collection from the current snapshot. */
  models: (route: string, account: AccountId) => Models
  /** Settings namespace the pool's profiles are stored under. */
  settingsNs: string
  /** Display name of a configured route (`undefined` when not configured). */
  routes: () => ReadonlyMap<string, { displayName: string }>
  /** Listen to every response observation; returns an unsubscribe function. */
  onObservation(cb: (route: string, account: AccountId, obs: Observation) => void): () => void
  /** Listen to rate-limit and quota refusals; returns an unsubscribe function. */
  onLimited(cb: (route: string, account: AccountId, reason: 'RATE_LIMIT' | 'QUOTA') => void): () => void
  /** Raise the account's cooldown to a usage-derived reset. */
  applyResetHint(route: string, account: AccountId, resetsAt: number): void
  /** Install the usage source the scheduler defers exhausted accounts by. */
  attachUsage(usage: UsagePeek): () => void
}

/**
 * The stickiness key of one session on one route: `${sessionId}|${route}`.
 * @param sessionId - the Session id.
 * @param route - the provider route key.
 * @returns the session key.
 */
export function sessionKeyOf(sessionId: string, route: string): string {
  return `${sessionId}|${route}`
}
