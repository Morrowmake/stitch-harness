/**
 * Header-derived usage: the windows an inference response's rate-limit
 * headers revealed (parsed by the pool's capture layer) merged over an
 * endpoint snapshot, or standing alone for accounts with no usage endpoint.
 *
 * Portions derived from dsh-plugin-subscriptions
 * (https://github.com/V1ki/dsh-plugin-subscriptions), Copyright (c) 2026 V1ki,
 * MIT License.
 *
 * @module dsh-llm-pi-ai/accounts/usage/headers
 */

import type { UsageWindowView } from '../types.ts'

/** Header windows observed for one account at one instant. */
export interface HeaderUsage {
  at: number
  windows: readonly UsageWindowView[]
}

/**
 * Overlay newer header windows on a base set: a header window replaces the
 * base window of the same kind and scope; unmatched ones are appended. Order
 * of the base set is kept so bars do not jump.
 * @param base - endpoint windows (older than the observation).
 * @param observed - header windows.
 * @returns the merged windows.
 */
export function mergeWindows(base: readonly UsageWindowView[], observed: readonly UsageWindowView[]): UsageWindowView[] {
  const sameLane = (a: UsageWindowView, b: UsageWindowView): boolean => a.kind === b.kind && a.scope === b.scope
  const merged = base.map(window => observed.find(candidate => sameLane(candidate, window)) ?? window)
  for (const window of observed) {
    if (!base.some(candidate => sameLane(candidate, window))) merged.push(window)
  }
  return merged
}

/**
 * Whether a window says the account is out of budget right now.
 * @param window - one usage window.
 * @param now - the clock.
 * @returns true for ≥100 % used with a reset still ahead.
 */
export function isExhaustedWindow(window: UsageWindowView, now: number): boolean {
  return (window.usedPercent ?? 0) >= 100 && window.resetsAt !== undefined && window.resetsAt > now
}
