/** Pure display helpers shared by the accounts section, the usage bars, and the badge. */
import type { Translate } from '@deepseek-ai/dsh-client-ui-slots'
import type {
  AccountView, AccountsSnapshot, ProviderAccountsView, UsageSnapshotView, UsageWindowView,
} from '@deepseek-ai/dsh-api-remotes/client'
import type { LlmAccountsKey } from './locales.ts'

type T = Translate<LlmAccountsKey>

/** What a usage reading shows: the consumed share or the share still available. */
export type UsageMode = 'used' | 'left'

const MINUTE = 60_000

/**
 * What a provider's sign-in signs in with. The Host's method label may already read "Sign in with ChatGPT"; the
 * localized `add.signIn` template supplies that phrase itself, so only the target is kept.
 * @param label - the Host's sign-in method label.
 * @returns the label without a leading English "Sign in with".
 */
export function signInTarget(label: string): string {
  return label.replace(/^sign in with\s+/i, '')
}

/**
 * Compact remaining time, rounded up to the minute so a pending reset never reads as zero.
 * @param ms - milliseconds until the instant.
 * @param t - the plugin translator.
 * @returns localized text such as `2h 5m`.
 */
export function formatRemaining(ms: number, t: T): string {
  if (ms < MINUTE) return t('time.soon')
  const minutes = Math.ceil(ms / MINUTE)
  if (minutes >= 24 * 60) {
    return t('time.days', { d: Math.floor(minutes / (24 * 60)), h: Math.floor((minutes % (24 * 60)) / 60) })
  }
  if (minutes >= 60) return t('time.hours', { h: Math.floor(minutes / 60), m: minutes % 60 })
  return t('time.minutes', { m: minutes })
}

/**
 * The consumed share of one window, from its percentage or its limit/remaining pair.
 * @param window - one usage window.
 * @returns 0-100, or undefined when the window carries neither reading.
 */
export function usedPercentOf(window: UsageWindowView): number | undefined {
  const used = window.usedPercent
    ?? (window.limit !== undefined && window.remaining !== undefined && window.limit > 0
      ? 100 * (1 - window.remaining / window.limit)
      : undefined)
  return used === undefined ? undefined : Math.min(100, Math.max(0, used))
}

/**
 * The share a reading displays in the chosen mode, rounded to a whole percent.
 * @param used - consumed share 0-100.
 * @param mode - used or left.
 * @returns whole percent.
 */
export function shownPercent(used: number, mode: UsageMode): number {
  return Math.round(mode === 'used' ? used : 100 - used)
}

/**
 * The window's short name: its own label, else the kind's localized name, plus a scope such as `Opus`.
 * @param window - one usage window.
 * @param t - the plugin translator.
 * @returns display name.
 */
export function windowName(window: UsageWindowView, t: T): string {
  const base = window.label ?? t(`usage.window.${window.kind}`)
  return window.scope === undefined ? base : `${base} · ${window.scope}`
}

/**
 * The most constrained window of a snapshot: the highest consumed share.
 * @param usage - a cached usage snapshot.
 * @returns the window and its consumed share, or undefined when no window has a reading.
 */
export function mostConstrained(usage: UsageSnapshotView | undefined): { window: UsageWindowView; used: number } | undefined {
  let best: { window: UsageWindowView; used: number } | undefined
  for (const window of usage?.windows ?? []) {
    const used = usedPercentOf(window)
    if (used !== undefined && (best === undefined || used > best.used)) best = { window, used }
  }
  return best
}

/**
 * Whether a snapshot has anything to draw.
 * @param usage - a cached usage snapshot.
 * @returns true when a window carries a reading.
 */
export function hasReadings(usage: UsageSnapshotView | undefined): boolean {
  return mostConstrained(usage) !== undefined
}

/**
 * The account's display name: the user's alias, else the Host label.
 * @param account - one account view.
 * @returns display name.
 */
export function accountName(account: AccountView): string {
  return account.alias ?? account.label
}

/**
 * The account a provider is serving for the observed session: the sticky one, else the default.
 * @param view - one provider's accounts.
 * @returns the serving account, or undefined without accounts.
 */
export function servingAccount(view: ProviderAccountsView): AccountView | undefined {
  return view.accounts.find(account => account.id === view.serving)
    ?? view.accounts.find(account => account.isDefault)
    ?? view.accounts[0]
}

/**
 * Providers ordered for the badge dialog: the current provider first, then the others in Host order, each kept only
 * when one of its accounts has usage readings.
 * @param snapshot - the accounts snapshot.
 * @param current - the session's current provider, if any.
 * @returns providers with readings.
 */
export function providersWithUsage(snapshot: AccountsSnapshot | undefined, current: string | undefined): ProviderAccountsView[] {
  const rows = (snapshot?.providers ?? []).filter(view => view.accounts.some(account => hasReadings(account.usage)))
  return [
    ...rows.filter(view => view.provider === current),
    ...rows.filter(view => view.provider !== current),
  ]
}
