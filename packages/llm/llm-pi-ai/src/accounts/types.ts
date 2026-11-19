/**
 * Browser-safe wire vocabulary of pi-ai multi-account pools: account views,
 * usage snapshots, sign-in attempts, and the `llmAccounts` Remote error codes.
 * Shared by the Host (`llm-pi-ai`) and the client UI (`ui-llm-accounts`).
 *
 * @module @deepseek-ai/dsh-llm-pi-ai/types
 */

/** `'main' | 'env' | 'ambient' | /^[a-z0-9]{8,16}$/`. */
export type AccountId = string
/**
 * How an account authenticates: a stored OAuth grant, a stored API key, the
 * profile's `apiKeyEnv` reference, or pi-ai's ambient discovery.
 */
export type AccountKind = 'oauth' | 'api-key' | 'key-ref' | 'ambient'
/** Opaque id of one sign-in attempt. */
export type SignInAttemptId = string & { readonly __b: 'SignInAttemptId' }

/** Non-secret per-account metadata stored at `providers.<route>.accounts.<id>`. */
export interface AccountProfile {
  /** Display name shown in Settings, the model picker, and the usage badge; absent shows the account id. */
  alias?: string
  /** Default `true`. */
  pooled?: boolean
  /** Default `false`; `true` adds `~acct:<id>:<model>` picker entries. */
  pinned?: boolean
  /** Absent = every model (incl. future ones); `[]` = none. */
  models?: readonly string[]
  /** Pool order among the route's accounts: lower values are tried first after the default account. */
  order?: number
  /** Epoch ms. */
  createdAt?: number
}

/** `null` clears a field. */
export interface AccountPatch {
  alias?: string | null
  pooled?: boolean
  pinned?: boolean
  models?: readonly string[] | null
  order?: number | null
}

/** `REFRESH_FAILED` = a transient OAuth token refresh failure (network/5xx). */
export type CoolingReason = 'RATE_LIMIT' | 'QUOTA' | 'HTTP_402' | 'HTTP_404' | 'REFRESH_FAILED'
/** Why an account needs the human to sign in again before it serves requests. */
export type SignInReason = 'AUTH' | 'INVALID_CREDENTIAL' | 'MISSING_CREDENTIAL'

/** Whether an account can serve now, is cooling until an instant, or needs sign-in. */
export type AccountHealth =
  | { state: 'ok' }
  | { state: 'cooling'; until: number; reason: CoolingReason; scope: 'account' | 'model' }
  | { state: 'needs-sign-in'; reason: SignInReason }

/** One usage window of an account: a subscription session or week, or a request or token bucket. */
export interface UsageWindowView {
  kind: 'session' | 'weekly' | 'other' | 'requests' | 'tokens'
  label?: string
  /** e.g. `'Opus'`. */
  scope?: string
  /** 0-100. */
  usedPercent?: number
  limit?: number
  remaining?: number
  durationMs?: number
  /** Epoch ms. */
  resetsAt?: number
}

/** One account's usage: polled from the provider's usage endpoint or derived from response headers. */
export interface UsageSnapshotView {
  supported: boolean
  source: 'endpoint' | 'headers'
  fetchedAt?: number
  staleAt?: number
  stale?: boolean
  refreshFailed?: boolean
  retryAt?: number
  plan?: string
  windows: readonly UsageWindowView[]
  credits?: { hasCredits: boolean; unlimited: boolean; balance?: string; overageLimitReached?: boolean }
}
/** The usage answer of the `llmAccounts.usage` Remote method. */
export type AccountUsageView = UsageSnapshotView

/** One account of a route as product surfaces show it; never carries a secret. */
export interface AccountView {
  id: AccountId
  provider: string
  kind: AccountKind
  alias?: string
  label: string
  /** Derived at runtime from token claims; never persisted. */
  identity?: { email?: string; plan?: string }
  isDefault: boolean
  pooled: boolean
  pinned: boolean
  models?: readonly string[]
  createdAt?: number
  removable: boolean
  health: AccountHealth
  /** Cached only; never fetched for a `list`. */
  usage?: UsageSnapshotView
}

/** One route's accounts and the sign-in methods it offers. */
export interface ProviderAccountsView {
  provider: string
  displayName: string
  /** Sign-in offered (`loginLabel`). */
  oauth?: { label: string }
  /** `false` = a simple key box suffices. */
  apiKey: { interactive: boolean }
  accounts: readonly AccountView[]
  /** Sticky account for `opts.sessionId`, if any. */
  serving?: AccountId
}

/** Every route's accounts at one revision. */
export interface AccountsSnapshot {
  revision: number
  providers: readonly ProviderAccountsView[]
}

/** How to sign an account in: method, the account to re-sign-in, and an alias for a new one. */
export interface SignInRequest {
  method: 'oauth' | 'api-key'
  accountId?: AccountId
  alias?: string
}

/** A question a running sign-in asks the human: free text, a manual code, a secret, or a choice. */
export type SignInPromptView =
  | { id: string; kind: 'text' | 'manual_code' | 'secret'; message: string; placeholder?: string }
  | { id: string; kind: 'select'; message: string; options: readonly { id: string; label: string; description?: string }[] }

/** One sign-in attempt: its phase, provider notices, pending prompt, and failure text. */
export interface SignInAttemptView {
  id: SignInAttemptId
  provider: string
  accountId: AccountId
  phase: 'running' | 'authorized' | 'cancelled' | 'failed'
  notices: readonly { message: string; url?: string; code?: string }[]
  prompt?: SignInPromptView
  error?: string
}

/** Prefix of pinned per-account model ids: `~acct:<accountId>:<modelId>`. */
export const PINNED_MODEL_PREFIX = '~acct:'

declare module '@deepseek-ai/dsh-typert-protocol' {
  interface RemoteErrorDetailsMap {
    'llm-accounts/unknown-account': { readonly provider: string; readonly account: string }
    'llm-accounts/not-removable': { readonly account: string }
    'llm-accounts/attempt-busy': { readonly provider: string }
    'llm-accounts/attempt-unknown': Record<string, never>
    'llm-accounts/unsupported': { readonly provider: string; readonly method: string }
    'llm-accounts/invalid-key': Record<string, never>
    'llm-accounts/settings-rejected': Record<string, never>
  }
}
