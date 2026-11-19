/**
 * Pure failure classification for one pool attempt (design §4.4): whether the
 * router fails over to the next account, retries the same OAuth account once
 * after a forced refresh, or throws to the caller (and `llm-retry`).
 *
 * Portions derived from dsh-plugin-subscriptions
 * (https://github.com/V1ki/dsh-plugin-subscriptions), Copyright (c) 2026 V1ki,
 * MIT License.
 *
 * @module dsh-llm-pi-ai/accounts/classify
 */

import type { AccountKind, CoolingReason, SignInReason } from './types.ts'

/** Pre-flight token-refresh failure (pi-ai `ModelsError` code `oauth`); not an `LlmError` code. */
export const REFRESH_FAILURE_CODE = 'OAUTH_REFRESH'

const SECOND = 1_000
const MINUTE = 60 * SECOND
const HOUR = 60 * MINUTE
/** A provider hint longer than this is treated as this (a bogus far-future reset must not lock an account). */
export const MAX_HINT_MS = 8 * 24 * HOUR

/** Refresh errors meaning the grant is gone for good. */
const PERMANENT_REFRESH = /invalid_grant|refresh_token_(?:expired|reused|invalidated)|\b(?:400|401)\b|revoked/i

/** One failed pool attempt, as {@link classify} sees it. */
export interface FailureInput {
  /** `LlmError` code, or {@link REFRESH_FAILURE_CODE}. */
  code: string
  /** Error text (incl. cause chain); never logged. */
  message: string
  /** HTTP status captured from the response, when known. */
  status?: number
  route: string
  kind: AccountKind
  /** Provider-disclosed recovery instant (epoch ms). */
  hintAt?: number
  now: number
  /** Consecutive failures of this cooldown key, including this one (≥1). */
  attempt: number
  /** Whether this account already had its one forced-refresh retry (or refreshed in the last 30 s). */
  refreshed: boolean
}

/** What the router does after a failed attempt: throw, retry the same account once, or fail over with optional bookkeeping. */
export type Verdict =
  | { action: 'throw' }
  | { action: 'retry-same' }
  | {
    action: 'failover'
    cooling?: { reason: CoolingReason; scope: 'account' | 'model'; until: number }
    signIn?: SignInReason
    limited?: 'RATE_LIMIT' | 'QUOTA'
  }

/**
 * `base · 2^(attempt-1)`, capped; a provider hint wins (capped at {@link MAX_HINT_MS}).
 * @param now - the current instant in epoch milliseconds.
 * @param attempt - consecutive failures of the cooldown key, including this one.
 * @param base - the first cooldown in milliseconds.
 * @param cap - the longest backoff cooldown in milliseconds.
 * @param hintAt - the provider-disclosed recovery instant, when known.
 * @returns the instant the cooldown ends, in epoch milliseconds.
 */
export function cooldownUntil(now: number, attempt: number, base: number, cap: number, hintAt?: number): number {
  if (hintAt !== undefined && hintAt > now) return now + Math.min(hintAt - now, MAX_HINT_MS)
  return now + Math.min(cap, base * 2 ** Math.max(0, attempt - 1))
}

/** The effective code: captured 402/404 statuses refine pi-ai's text classification. */
function effectiveCode(input: FailureInput): string {
  if (input.code === 'PI_AI_ERROR' || input.code === 'INVALID_REQUEST' || input.code.startsWith('HTTP_')) {
    if (input.status === 402) return 'HTTP_402'
    if (input.status === 404) return 'HTTP_404'
  }
  return input.code
}

/**
 * Decide what the router does after one failed attempt (design §4.4).
 * @param input - the failure, its account kind, and its cooldown history.
 * @returns the verdict: throw, retry the same account, or fail over with cooling, sign-in, and limit marks.
 */
export function classify(input: FailureInput): Verdict {
  const { now, attempt, hintAt } = input
  switch (effectiveCode(input)) {
    case 'RATE_LIMIT':
      return {
        action: 'failover',
        limited: 'RATE_LIMIT',
        cooling: {
          reason: 'RATE_LIMIT',
          // Subscription (OAuth) limits are per account; API keys and Anthropic OAuth lanes are per model.
          scope: input.kind === 'oauth' && input.route !== 'anthropic' ? 'account' : 'model',
          until: cooldownUntil(now, attempt, 30 * SECOND, 10 * MINUTE, hintAt),
        },
      }
    case 'QUOTA':
    case 'HTTP_402':
      return {
        action: 'failover',
        limited: 'QUOTA',
        cooling: {
          reason: input.code === 'QUOTA' ? 'QUOTA' : 'HTTP_402',
          scope: 'account',
          until: cooldownUntil(now, attempt, 30 * MINUTE, 6 * HOUR, hintAt),
        },
      }
    case 'AUTH':
      if (input.kind === 'oauth' && !input.refreshed) return { action: 'retry-same' }
      return { action: 'failover', signIn: 'AUTH' }
    case 'INVALID_CREDENTIAL':
      return { action: 'failover', signIn: 'INVALID_CREDENTIAL' }
    case 'MISSING_CREDENTIAL':
      return { action: 'failover', signIn: 'MISSING_CREDENTIAL' }
    case REFRESH_FAILURE_CODE:
      if (PERMANENT_REFRESH.test(input.message)) return { action: 'failover', signIn: 'INVALID_CREDENTIAL' }
      return { action: 'failover', cooling: { reason: 'REFRESH_FAILED', scope: 'account', until: now + MINUTE } }
    case 'HTTP_404':
      return { action: 'failover', cooling: { reason: 'HTTP_404', scope: 'model', until: now + 5 * MINUTE } }
    default:
      // SERVER/TIMEOUT/TRANSPORT/EMPTY_RESPONSE belong to llm-retry (D2);
      // the request itself is at fault for everything else.
      return { action: 'throw' }
  }
}
