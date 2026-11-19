/**
 * In-memory account health: cooldowns (account- or model-scoped), the
 * `needs-sign-in` state, and per-key consecutive-failure counters. Nothing
 * here is persisted; a restart forgets every cooldown.
 *
 * Portions derived from dsh-plugin-subscriptions
 * (https://github.com/V1ki/dsh-plugin-subscriptions), Copyright (c) 2026 V1ki,
 * MIT License.
 *
 * @module dsh-llm-pi-ai/accounts/health
 */

import type { HealthRegistry } from './runtime.ts'
import type { AccountHealth, AccountId, CoolingReason, SignInReason } from './types.ts'

interface Cooldown {
  until: number
  reason: CoolingReason
  scope: 'account' | 'model'
}

const accountKey = (route: string, account: AccountId): string => `${route}/${account}`

/** The pool's health registry; also the `HealthRegistry` the Remote reads. */
export class AccountHealthRegistry implements HealthRegistry {
  private readonly cooldowns = new Map<string, Cooldown>()
  private readonly signIn = new Map<string, SignInReason>()
  private readonly failures = new Map<string, number>()
  private readonly listeners = new Set<() => void>()

  constructor(private readonly clock: () => number = Date.now) {}

  private keyOf(route: string, account: AccountId, model: string | undefined): string {
    return model === undefined ? accountKey(route, account) : `${accountKey(route, account)}/${model}`
  }

  private changed(): void {
    for (const listener of this.listeners) listener()
  }

  /** The live cooldown for an account (and, with `model`, its model lane), longest first. */
  private cooldownOf(route: string, account: AccountId, model: string | undefined, now: number): Cooldown | undefined {
    const candidates = [this.cooldowns.get(accountKey(route, account))]
    if (model !== undefined) candidates.push(this.cooldowns.get(this.keyOf(route, account, model)))
    let best: Cooldown | undefined
    for (const candidate of candidates) {
      if (candidate !== undefined && candidate.until > now && (best === undefined || candidate.until > best.until)) best = candidate
    }
    return best
  }

  view(route: string, account: AccountId, model?: string, now = this.clock()): AccountHealth {
    const reason = this.signIn.get(accountKey(route, account))
    if (reason !== undefined) return { state: 'needs-sign-in', reason }
    const cooling = model === undefined ? this.anyCooldown(route, account, now) : this.cooldownOf(route, account, model, now)
    return cooling === undefined ? { state: 'ok' } : { state: 'cooling', ...cooling }
  }

  /** Account-level view without a model: the longest live cooldown of any lane. */
  private anyCooldown(route: string, account: AccountId, now: number): Cooldown | undefined {
    const prefix = accountKey(route, account)
    let best: Cooldown | undefined
    for (const [key, cooldown] of this.cooldowns) {
      if ((key === prefix || key.startsWith(`${prefix}/`)) && cooldown.until > now && (best === undefined || cooldown.until > best.until)) best = cooldown
    }
    return best
  }

  /**
   * Whether the account can serve `model` now.
   * @param route - the provider route key.
   * @param account - the account id.
   * @param model - the provider model id.
   * @param now - the instant to judge at, in epoch milliseconds.
   * @returns false while the account needs sign-in or the account or model lane is cooling.
   */
  isAvailable(route: string, account: AccountId, model: string, now = this.clock()): boolean {
    return !this.signIn.has(accountKey(route, account)) && this.cooldownOf(route, account, model, now) === undefined
  }

  /**
   * Cool an account (`model` undefined) or one model lane; keeps the longer deadline.
   * @param route - the provider route key.
   * @param account - the account id.
   * @param model - the model lane to cool, or undefined to cool the whole account.
   * @param reason - why the lane is cooling.
   * @param until - the instant the cooldown ends, in epoch milliseconds.
   */
  markCooling(route: string, account: AccountId, model: string | undefined, reason: CoolingReason, until: number): void {
    const key = this.keyOf(route, account, model)
    const current = this.cooldowns.get(key)
    if (current !== undefined && current.until >= until) return
    this.cooldowns.set(key, { until, reason, scope: model === undefined ? 'account' : 'model' })
    this.changed()
  }

  /**
   * Raise an existing (or create a) account cooldown to a usage-derived reset.
   * @param route - the provider route key.
   * @param account - the account id.
   * @param resetsAt - the usage window's reset instant, in epoch milliseconds.
   * @param reason - the reason recorded when no cooldown exists yet.
   */
  applyResetHint(route: string, account: AccountId, resetsAt: number, reason: CoolingReason = 'QUOTA'): void {
    const existing = this.anyCooldown(route, account, this.clock())
    this.markCooling(route, account, undefined, existing?.reason ?? reason, resetsAt)
  }

  /**
   * Hold the account out of rotation until the human signs in again.
   * @param route - the provider route key.
   * @param account - the account id.
   * @param reason - why the account needs sign-in.
   */
  markNeedsSignIn(route: string, account: AccountId, reason: SignInReason): void {
    if (this.signIn.get(accountKey(route, account)) === reason) return
    this.signIn.set(accountKey(route, account), reason)
    this.changed()
  }

  /**
   * Count one more consecutive failure of a key.
   * @param route - the provider route key.
   * @param account - the account id.
   * @param model - the model lane the failure counts against, or undefined for the account.
   * @returns the new consecutive-failure count (1-based).
   */
  noteFailure(route: string, account: AccountId, model: string | undefined): number {
    const key = this.keyOf(route, account, model)
    const count = (this.failures.get(key) ?? 0) + 1
    this.failures.set(key, count)
    return count
  }

  /**
   * A successful attempt clears the account's consecutive-failure counters.
   * @param route - the provider route key.
   * @param account - the account id.
   */
  noteSuccess(route: string, account: AccountId): void {
    const prefix = accountKey(route, account)
    for (const key of [...this.failures.keys()]) if (key === prefix || key.startsWith(`${prefix}/`)) this.failures.delete(key)
  }

  /**
   * Earliest instant any of `accounts` can serve `model` again (sign-in states never recover by time).
   * @param route - the provider route key.
   * @param accounts - the account ids to consider.
   * @param model - the provider model id.
   * @param now - the current instant, in epoch milliseconds.
   * @returns the earliest recovery instant, or undefined when every account needs sign-in.
   */
  earliestRecovery(route: string, accounts: readonly AccountId[], model: string, now = this.clock()): number | undefined {
    let earliest: number | undefined
    for (const account of accounts) {
      if (this.signIn.has(accountKey(route, account))) continue
      const until = this.cooldownOf(route, account, model, now)?.until ?? now
      if (earliest === undefined || until < earliest) earliest = until
    }
    return earliest
  }

  clear(route: string, account?: AccountId): void {
    const prefix = account === undefined ? `${route}/` : accountKey(route, account)
    const matches = (key: string): boolean => account === undefined ? key.startsWith(prefix) : key === prefix || key.startsWith(`${prefix}/`)
    let touched = false
    for (const map of [this.cooldowns, this.signIn, this.failures] as Map<string, unknown>[]) {
      for (const key of [...map.keys()]) {
        if (matches(key)) {
          map.delete(key)
          touched = true
        }
      }
    }
    if (touched) this.changed()
  }

  onChange(cb: () => void): () => void {
    this.listeners.add(cb)
    return () => { this.listeners.delete(cb) }
  }
}
