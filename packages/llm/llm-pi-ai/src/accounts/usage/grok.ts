/**
 * Grok subscription usage (`xai` OAuth accounts) from the Grok CLI chat
 * proxy's billing endpoint.
 *
 * Portions derived from dsh-plugin-subscriptions
 * (https://github.com/V1ki/dsh-plugin-subscriptions), Copyright (c) 2026 V1ki,
 * MIT License.
 *
 * @module dsh-llm-pi-ai/accounts/usage/grok
 */

import { attributionHeaders } from '@deepseek-ai/dsh-llm'
import type { UsageWindowView } from '../types.ts'
import { jwtClaims, parseInstant, usageEndpointError } from './http.ts'
import type { FetchedUsage, FetchFn, UsageAuth } from './http.ts'

/** Grok CLI's billing endpoint, answering credits. */
export const GROK_BILLING_URL = 'https://cli-chat-proxy.grok.com/v1/billing?format=credits'

const TIER_NAMES: Readonly<Record<number, string>> = {
  0: 'Free',
  1: 'SuperGrok',
  2: 'X Basic',
  3: 'X Premium',
  4: 'X Premium+',
  5: 'SuperGrok Heavy',
  6: 'SuperGrok Lite',
  7: 'SuperGrok Plus',
}

/**
 * The subscription tier named by an access token's `tier` claim.
 * @param token - the account's access token.
 * @returns the display name (an unknown numeric tier as its number), or undefined.
 */
export function grokTierName(token: string): string | undefined {
  const tier = jwtClaims(token)?.tier
  if (typeof tier !== 'number' || !Number.isInteger(tier)) return undefined
  return TIER_NAMES[tier] ?? String(tier)
}

/** The billing payload subset read here (both credits-config shapes). */
interface BillingConfig {
  creditUsagePercent?: unknown
  currentPeriod?: { type?: unknown; start?: unknown; end?: unknown }
  monthlyLimit?: { val?: unknown }
  used?: { val?: unknown }
  billingPeriodEnd?: unknown
}

/**
 * Fetch one Grok account's usage. Headers are what pi-ai's xAI transport
 * sends on this account's inference (bearer only) plus the adapter's
 * attribution `user-agent`; no CLI identity is claimed, so a proxy that
 * refuses it leaves the account on header-derived usage.
 * @param auth - the account's current access token.
 * @param fetchFn - fetch implementation.
 * @param signal - caller cancellation.
 * @returns the mapped usage.
 * @throws {UsageFetchError} on a non-2xx answer.
 */
export async function fetchGrokUsage(auth: UsageAuth, fetchFn: FetchFn, signal?: AbortSignal): Promise<FetchedUsage> {
  const response = await fetchFn(GROK_BILLING_URL, {
    headers: { accept: 'application/json', ...attributionHeaders(), authorization: `Bearer ${auth.token}` },
    ...signal === undefined ? {} : { signal },
  })
  if (!response.ok) throw usageEndpointError(response, 'grok billing')
  const payload = await response.json() as { config?: BillingConfig | null; subscriptionTier?: unknown }
  const config: BillingConfig = typeof payload.config === 'object' && payload.config !== null ? payload.config : {}
  const windows: UsageWindowView[] = []
  const percent = typeof config.creditUsagePercent === 'number' && Number.isFinite(config.creditUsagePercent)
    ? config.creditUsagePercent
    : undefined
  if (config.currentPeriod !== undefined || percent !== undefined) {
    const resetsAt = parseInstant(config.currentPeriod?.end)
    const start = parseInstant(config.currentPeriod?.start)
    windows.push({
      kind: config.currentPeriod?.type === 'USAGE_PERIOD_TYPE_WEEKLY' ? 'weekly' : 'other',
      usedPercent: percent ?? 0,
      ...start !== undefined && resetsAt !== undefined && resetsAt > start ? { durationMs: resetsAt - start } : {},
      ...resetsAt === undefined ? {} : { resetsAt },
    })
  } else if (typeof config.monthlyLimit?.val === 'number' && config.monthlyLimit.val > 0) {
    const used = typeof config.used?.val === 'number' ? config.used.val : 0
    const resetsAt = parseInstant(config.billingPeriodEnd)
    windows.push({
      kind: 'other',
      usedPercent: (used / config.monthlyLimit.val) * 100,
      ...resetsAt === undefined ? {} : { resetsAt },
    })
  }
  // The billing answer rarely carries the tier; the token's claim does.
  const plan = typeof payload.subscriptionTier === 'string' && payload.subscriptionTier.length > 0
    ? payload.subscriptionTier
    : grokTierName(auth.token)
  return { windows, ...plan === undefined ? {} : { plan } }
}
