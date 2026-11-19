/**
 * ChatGPT subscription usage (`openai-codex` OAuth accounts) from the
 * backend `wham/usage` endpoint — the source of the Codex CLI `/status`
 * rate-limit lines. Reset-credit endpoints are deliberately not called.
 *
 * Portions derived from dsh-plugin-subscriptions
 * (https://github.com/V1ki/dsh-plugin-subscriptions), Copyright (c) 2026 V1ki,
 * MIT License.
 *
 * @module dsh-llm-pi-ai/accounts/usage/codex
 */

import { attributionHeaders } from '@deepseek-ai/dsh-llm'
import type { UsageSnapshotView, UsageWindowView } from '../types.ts'
import { jwtClaims, UsageCredentialError, usageEndpointError } from './http.ts'
import type { FetchedUsage, FetchFn, UsageAuth } from './http.ts'

/** ChatGPT's usage endpoint for a Codex subscription account. */
export const CODEX_USAGE_URL = 'https://chatgpt.com/backend-api/wham/usage'

/** The claim namespace pi-ai reads the ChatGPT account id from. */
const AUTH_CLAIM = 'https://api.openai.com/auth'

const SESSION_WINDOW_SECONDS = 5 * 60 * 60
const WEEKLY_WINDOW_SECONDS = 7 * 24 * 60 * 60

/** One `rate_limit.*_window` object of the payload (subset). */
interface CodexUsageWindow {
  used_percent?: number
  limit_window_seconds?: number
  reset_at?: number
  reset_after_seconds?: number
}

/**
 * The ChatGPT account id carried in an access token, as pi-ai's Codex
 * transport reads it for every inference request.
 * @param token - the account's access token.
 * @returns the id, or undefined when the token carries none.
 */
export function codexAccountId(token: string): string | undefined {
  const auth = jwtClaims(token)?.[AUTH_CLAIM]
  const id = typeof auth === 'object' && auth !== null ? (auth as Record<string, unknown>).chatgpt_account_id : undefined
  return typeof id === 'string' && id.length > 0 ? id : undefined
}

function matchesWindow(seconds: number, expected: number): boolean {
  return seconds >= expected * 0.95 && seconds <= expected * 1.05
}

/**
 * Classify a window by its reported duration: the backend has been observed
 * to report the weekly lane as `primary_window`, so slot position is only
 * the fallback when the duration is absent.
 */
function windowKind(window: CodexUsageWindow, fallback: UsageWindowView['kind']): UsageWindowView['kind'] {
  const seconds = window.limit_window_seconds
  if (typeof seconds !== 'number' || !Number.isFinite(seconds) || seconds <= 0) return fallback
  if (matchesWindow(seconds, SESSION_WINDOW_SECONDS)) return 'session'
  if (matchesWindow(seconds, WEEKLY_WINDOW_SECONDS)) return 'weekly'
  return 'other'
}

function usageWindow(value: unknown, fallback: UsageWindowView['kind'], now: number): UsageWindowView | undefined {
  if (typeof value !== 'object' || value === null) return undefined
  const window = value as CodexUsageWindow
  if (typeof window.used_percent !== 'number' || !Number.isFinite(window.used_percent)) return undefined
  let resetsAt: number | undefined
  if (typeof window.reset_at === 'number' && window.reset_at > 0) resetsAt = window.reset_at * 1000
  else if (typeof window.reset_after_seconds === 'number' && window.reset_after_seconds > 0) {
    resetsAt = now + window.reset_after_seconds * 1000
  }
  const durationMs = typeof window.limit_window_seconds === 'number' ? window.limit_window_seconds * 1000 : undefined
  return {
    kind: windowKind(window, fallback),
    usedPercent: window.used_percent,
    ...durationMs !== undefined && Number.isFinite(durationMs) && durationMs > 0 ? { durationMs } : {},
    ...resetsAt === undefined ? {} : { resetsAt },
  }
}

function balanceString(value: unknown): string | undefined {
  if (typeof value === 'number' && Number.isFinite(value)) return String(value)
  if (typeof value !== 'string') return undefined
  const trimmed = value.trim()
  return trimmed.length > 0 && Number.isFinite(Number(trimmed)) ? trimmed : undefined
}

/**
 * Map the purchased-credit object. Undefined when the backend omitted it, so
 * a missing field is never reported as a zero balance.
 * @param value - the payload's `credits` member.
 * @returns the credit view, or undefined.
 */
export function codexCredits(value: unknown): UsageSnapshotView['credits'] {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return undefined
  const credits = value as Record<string, unknown>
  const balance = balanceString(credits.balance)
  const unlimited = credits.unlimited === true
  if (typeof credits.has_credits !== 'boolean' && !unlimited && balance === undefined && credits.overage_limit_reached !== true) {
    return undefined
  }
  const hasCredits = typeof credits.has_credits === 'boolean'
    ? credits.has_credits
    : unlimited || (balance !== undefined && Number(balance) > 0)
  return {
    hasCredits,
    unlimited,
    ...balance === undefined ? {} : { balance },
    ...credits.overage_limit_reached === true ? { overageLimitReached: true } : {},
  }
}

/**
 * Fetch one ChatGPT account's usage. Headers are those pi-ai's Codex
 * transport sends on inference for the same account (`originator: pi`,
 * `chatgpt-account-id`, bearer) plus the harness attribution `user-agent`
 * the adapter forces onto every request.
 * @param auth - the account's current access token.
 * @param fetchFn - fetch implementation.
 * @param signal - caller cancellation.
 * @param now - clock for `reset_after_seconds`.
 * @returns the mapped usage.
 * @throws {UsageCredentialError} when the token names no ChatGPT account.
 * @throws {UsageFetchError} on a non-2xx answer.
 */
export async function fetchCodexUsage(auth: UsageAuth, fetchFn: FetchFn, signal?: AbortSignal, now = Date.now()): Promise<FetchedUsage> {
  const accountId = codexAccountId(auth.token)
  if (accountId === undefined) throw new UsageCredentialError('codex usage: the access token names no ChatGPT account')
  const response = await fetchFn(CODEX_USAGE_URL, {
    headers: {
      'originator': 'pi',
      'accept': 'application/json',
      ...attributionHeaders(),
      'authorization': `Bearer ${auth.token}`,
      'chatgpt-account-id': accountId,
    },
    ...signal === undefined ? {} : { signal },
  })
  if (!response.ok) throw usageEndpointError(response, 'codex usage')
  const payload = await response.json() as {
    plan_type?: unknown
    rate_limit?: { primary_window?: unknown; secondary_window?: unknown }
    credits?: unknown
  }
  const windows: UsageWindowView[] = []
  const primary = usageWindow(payload.rate_limit?.primary_window, 'session', now)
  const secondary = usageWindow(payload.rate_limit?.secondary_window, 'weekly', now)
  if (primary !== undefined) windows.push(primary)
  if (secondary !== undefined) windows.push(secondary)
  const credits = codexCredits(payload.credits)
  return {
    windows,
    ...typeof payload.plan_type === 'string' && payload.plan_type.length > 0 ? { plan: payload.plan_type } : {},
    ...credits === undefined ? {} : { credits },
  }
}
