/**
 * Shared vocabulary of the usage-endpoint fetchers: the fetched shape, the
 * typed endpoint failure, and token-claim decoding.
 *
 * Portions derived from dsh-plugin-subscriptions
 * (https://github.com/V1ki/dsh-plugin-subscriptions), Copyright (c) 2026 V1ki,
 * MIT License.
 *
 * @module dsh-llm-pi-ai/accounts/usage/http
 */

import type { UsageSnapshotView } from '../types.ts'

/** Injectable `fetch` (tests pass a fake; production uses the proxy-aware global). */
export type FetchFn = (input: string, init: RequestInit) => Promise<Response>

/** What one endpoint lookup yields before the cache stamps freshness on it. */
export type FetchedUsage = Pick<UsageSnapshotView, 'windows' | 'plan' | 'credits'>

/** The bearer token (and Codex account id) a fetcher authenticates with. */
export interface UsageAuth {
  token: string
}

/** A usage endpoint answered non-2xx. `retryAfterMs` comes from its `retry-after`. */
export class UsageFetchError extends Error {
  constructor(message: string, readonly status: number, readonly retryAfterMs?: number) {
    super(message)
    this.name = 'UsageFetchError'
  }
}

/** The account has no usable token: never negative-cached (re-sign-in recovers at once). */
export class UsageCredentialError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'UsageCredentialError'
  }
}

/**
 * Read the `retry-after` header as milliseconds (delay-seconds or HTTP-date).
 * @param response - the refusing response.
 * @param now - clock for HTTP-date values.
 * @returns the delay, or undefined when absent or unparsable.
 */
export function retryAfterMs(response: Response, now = Date.now()): number | undefined {
  const raw = response.headers.get('retry-after')
  if (raw === null || raw.trim() === '') return undefined
  const seconds = Number(raw)
  if (Number.isFinite(seconds)) return seconds > 0 ? seconds * 1000 : undefined
  const at = Date.parse(raw)
  return Number.isFinite(at) && at > now ? at - now : undefined
}

/**
 * The typed failure for a non-2xx usage response. The body is not read: only
 * the status and `retry-after` decide what happens next.
 * @param response - the refusing response.
 * @param label - endpoint name for the message.
 * @returns the error to throw.
 */
export function usageEndpointError(response: Response, label: string): UsageFetchError {
  return new UsageFetchError(`${label} endpoint error (HTTP ${String(response.status)})`, response.status, retryAfterMs(response))
}

/**
 * Decode a JWT payload without verifying it (display-only claims).
 * @param token - a compact JWT, or any opaque token.
 * @returns the claims object, or undefined when the token is not a JWT.
 */
export function jwtClaims(token: string): Record<string, unknown> | undefined {
  const parts = token.split('.')
  if (parts.length !== 3 || parts[1] === undefined) return undefined
  try {
    const parsed: unknown = JSON.parse(Buffer.from(parts[1], 'base64url').toString('utf8'))
    return typeof parsed === 'object' && parsed !== null && !Array.isArray(parsed)
      ? parsed as Record<string, unknown>
      : undefined
  } catch {
    return undefined
  }
}

/**
 * RFC3339 → epoch ms, or undefined when absent/unparsable.
 * @param value - the timestamp field of a usage response.
 * @returns the instant in epoch milliseconds, or undefined.
 */
export function parseInstant(value: unknown): number | undefined {
  if (typeof value !== 'string' || value.length === 0) return undefined
  const parsed = Date.parse(value)
  return Number.isFinite(parsed) ? parsed : undefined
}
