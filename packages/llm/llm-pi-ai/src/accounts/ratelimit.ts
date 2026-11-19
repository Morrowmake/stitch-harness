/**
 * Rate-limit parsing: reset instants off failed responses, usage windows off
 * the whitelisted rate-limit headers of any response, and reset hints off
 * error text for the APIs whose `fetch` cannot be wrapped (Google).
 *
 * Portions derived from dsh-plugin-subscriptions
 * (https://github.com/V1ki/dsh-plugin-subscriptions), Copyright (c) 2026 V1ki,
 * MIT License.
 *
 * @module dsh-llm-pi-ai/accounts/ratelimit
 */

import type { UsageWindowView } from './types.ts'

/** Extra time added to every provider-disclosed wait (clock skew). */
const RESET_GRACE_MS = 2_000
/** Shortest wait ever reported. */
const MIN_WAIT_MS = 1_000
/** Below this a bare number is a delay in seconds rather than an epoch stamp. */
const EPOCH_SECONDS_FLOOR = 1_000_000_000
/** At or above this a bare epoch stamp is already in milliseconds. */
const EPOCH_MILLIS_FLOOR = 1_000_000_000_000
/** How deep {@link resetFromFields} walks. */
const MAX_BODY_DEPTH = 4
const DAY_MS = 86_400_000

/**
 * Interpret a bare numeric value: epoch ms, epoch s, or a delay in seconds,
 * separated by magnitude.
 * @param value - the numeric header or body value.
 * @param now - the current instant, in epoch milliseconds.
 * @returns the reset instant in epoch milliseconds, or undefined for a non-positive or non-finite value.
 */
export function resetInstantFromNumber(value: number, now: number): number | undefined {
  if (!Number.isFinite(value) || value <= 0) return undefined
  if (value >= EPOCH_MILLIS_FLOOR) return value
  if (value >= EPOCH_SECONDS_FLOOR) return value * 1_000
  return now + value * 1_000
}

/**
 * Parse a Go-style duration (`6m0s`, `1h2m3.5s`, `150ms`) into milliseconds.
 * Components must run coarse to fine; zero is not a reset.
 * @param text - the duration text.
 * @returns the duration in milliseconds, or undefined when the text is not a positive duration.
 */
export function durationMs(text: string): number | undefined {
  const trimmed = text.trim()
  if (trimmed.length === 0) return undefined
  const pattern = /(\d+(?:\.\d+)?)(ms|h|m|s)/y
  const units: Record<string, number> = { h: 3_600_000, m: 60_000, s: 1_000, ms: 1 }
  let total = 0
  let matched = false
  let index = 0
  let previousUnit = Number.POSITIVE_INFINITY
  for (;;) {
    pattern.lastIndex = index
    const match = pattern.exec(trimmed)
    if (match === null) break
    const unit = units[match[2] ?? '']
    if (unit === undefined || unit >= previousUnit) return undefined
    previousUnit = unit
    total += Number(match[1]) * unit
    index = pattern.lastIndex
    matched = true
  }
  if (!matched || index !== trimmed.length) return undefined
  return total > 0 ? total : undefined
}

/**
 * Any single rate-limit value (number, numeric string, duration, date) → reset instant.
 * @param value - the header or body value.
 * @param now - the current instant, in epoch milliseconds.
 * @returns the reset instant in epoch milliseconds, or undefined when the value is not a reset.
 */
export function resetInstantFromValue(value: unknown, now: number): number | undefined {
  if (typeof value === 'number') return resetInstantFromNumber(value, now)
  if (typeof value !== 'string') return undefined
  const trimmed = value.trim()
  if (trimmed.length === 0) return undefined
  const numeric = Number(trimmed)
  if (Number.isFinite(numeric)) return resetInstantFromNumber(numeric, now)
  const duration = durationMs(trimmed)
  if (duration !== undefined) return now + duration
  const parsed = Date.parse(trimmed)
  return Number.isFinite(parsed) ? parsed : undefined
}

/**
 * RFC 7231 `retry-after`: delay seconds (never an epoch) or HTTP-date.
 * @param headers - the response headers.
 * @param now - the current instant, in epoch milliseconds.
 * @returns the retry instant in epoch milliseconds, or undefined when the header is absent or unparsable.
 */
export function retryAfterInstant(headers: Headers, now: number): number | undefined {
  const raw = headers.get('retry-after')?.trim()
  if (raw === undefined || raw.length === 0) return undefined
  const seconds = Number(raw)
  if (Number.isFinite(seconds)) return seconds > 0 ? now + seconds * 1_000 : undefined
  const parsed = Date.parse(raw)
  return Number.isFinite(parsed) ? parsed : undefined
}

/**
 * Parse JSON without throwing on HTML gateway pages.
 * @param body - the response body text.
 * @returns the parsed value, or undefined when the body is not JSON.
 */
export function jsonBody(body: string): unknown {
  if (body.length === 0) return undefined
  try {
    const parsed: unknown = JSON.parse(body)
    return parsed
  } catch {
    return undefined
  }
}

/**
 * Earliest reset instant under any of `keys`, anywhere in a parsed body.
 * @param value - the parsed body or one of its nested values.
 * @param keys - the field names whose values are reset hints.
 * @param now - the current instant, in epoch milliseconds.
 * @param depth - how many more nesting levels the walk descends.
 * @returns the earliest reset instant found, or undefined when no field holds one.
 */
export function resetFromFields(value: unknown, keys: readonly string[], now: number, depth = MAX_BODY_DEPTH): number | undefined {
  if (depth <= 0 || value === null || typeof value !== 'object') return undefined
  let earliest: number | undefined
  const consider = (candidate: number | undefined): void => {
    if (candidate !== undefined && (earliest === undefined || candidate < earliest)) earliest = candidate
  }
  if (Array.isArray(value)) {
    for (const item of value) consider(resetFromFields(item, keys, now, depth - 1))
    return earliest
  }
  for (const [key, nested] of Object.entries(value)) {
    if (keys.includes(key)) consider(resetInstantFromValue(nested, now))
    else consider(resetFromFields(nested, keys, now, depth - 1))
  }
  return earliest
}

/**
 * The wait to report for a reset instant: +2 s grace, at least 1 s, never capped.
 * @param instant - the reset instant, in epoch milliseconds.
 * @param now - the current instant, in epoch milliseconds.
 * @returns the wait in milliseconds.
 */
export function waitFromReset(instant: number, now: number): number {
  return Math.max(MIN_WAIT_MS, instant - now + RESET_GRACE_MS)
}

const CODEX_RESET_FIELDS = ['resets_in_seconds', 'reset_after_seconds', 'resets_at', 'reset_at'] as const
const CLAUDE_RESET_FIELDS = ['resets_at', 'resetsAt', 'reset_at', 'retry_after'] as const

/**
 * Google RPC `quotaResetDelay` / `quotaResetTimeStamp` / `retryDelay` / "retry in 34.5s" in any text.
 * @param text - the response body or error text.
 * @param now - the current instant, in epoch milliseconds.
 * @returns the reset instant in epoch milliseconds, or undefined when the text names none.
 */
export function textResetHint(text: string, now: number): number | undefined {
  const delayPatterns = [
    /"(?:quotaResetDelay|retryDelay)"\s*:\s*"([^"]+)"/,
    /retry in (\d+(?:\.\d+)?(?:ms|s|m|h)(?:\d+(?:\.\d+)?(?:ms|s|m|h))*)/i,
  ]
  for (const pattern of delayPatterns) {
    const delay = pattern.exec(text)?.[1]
    const ms = delay === undefined ? undefined : durationMs(delay)
    if (ms !== undefined) return now + ms
  }
  const stamp = /"quotaResetTimeStamp"\s*:\s*"([^"]+)"/.exec(text)
  if (stamp?.[1] === undefined) return undefined
  const instant = Date.parse(stamp[1])
  return Number.isFinite(instant) && instant > now ? instant : undefined
}

/**
 * The instant the window that refused a 429/402 reopens, per provider policy:
 * Codex = body fields only; Anthropic = unified headers, then body; Google =
 * RPC body hints; otherwise `retry-after`. Per-bucket rollover headers are
 * never read as a reset (they cannot say which bucket refused).
 * @param route - the provider route that refused.
 * @param headers - the whitelisted response headers.
 * @param body - the bounded response body text.
 * @param now - the current instant, in epoch milliseconds.
 * @returns the reopening instant in epoch milliseconds, or undefined when the response discloses none.
 */
export function refusalReset(route: string, headers: Headers, body: string, now: number): number | undefined {
  if (route === 'openai-codex') return resetFromFields(jsonBody(body), CODEX_RESET_FIELDS, now)
  if (route === 'anthropic') {
    const unified = [headers.get('anthropic-ratelimit-unified-reset'), headers.get('anthropic-ratelimit-unified-fallback-reset')]
      .map(value => resetInstantFromValue(value, now))
      .filter((value): value is number => value !== undefined)
    if (unified.length > 0) return Math.min(...unified)
    return resetFromFields(jsonBody(body), CLAUDE_RESET_FIELDS, now) ?? retryAfterInstant(headers, now)
  }
  return retryAfterInstant(headers, now) ?? textResetHint(body, now)
}

/** Header names worth showing when a 429 disclosed no reset this code recognizes. */
const DIAGNOSTIC_HEADER = /rate-?limit|retry|reset|^x-codex-/i

/**
 * Rate-limit headers (names + values) and the first 200 body chars of an unparsable 429; no auth headers.
 * @param headers - the whitelisted response headers.
 * @param body - the bounded response body text.
 * @returns a one-line diagnostic.
 */
export function rateLimitDiagnostics(headers: Headers, body: string): string {
  const shown: string[] = []
  headers.forEach((value, name) => { if (DIAGNOSTIC_HEADER.test(name)) shown.push(`${name}: ${value}`) })
  return `headers {${shown.join('; ')}} body ${JSON.stringify(body.slice(0, 200))}`
}

/**
 * Whether a header belongs to the rate-limit whitelist captured from responses.
 * @param name - the header name, in any case.
 * @returns true for whitelisted rate-limit headers.
 */
export function isWhitelistedHeader(name: string): boolean {
  const lower = name.toLowerCase()
  return lower === 'retry-after'
    || /^x-ratelimit-(?:limit|remaining|reset)-(?:requests|tokens)$/.test(lower)
    || /^anthropic-ratelimit-(?:requests|tokens|input-tokens|output-tokens)-(?:limit|remaining|reset)$/.test(lower)
    || /^anthropic-ratelimit-unified-(?:reset|fallback-reset|status|5h-utilization|7d-utilization)$/.test(lower)
    || /^x-codex-(?:primary|secondary)-(?:used-percent|reset-after-seconds|window-minutes)$/.test(lower)
}

function finite(value: string | null): number | undefined {
  if (value === null || value.trim().length === 0) return undefined
  const parsed = Number(value)
  return Number.isFinite(parsed) ? parsed : undefined
}

function bucketWindow(
  kind: 'requests' | 'tokens', label: string | undefined,
  limitRaw: string | null, remainingRaw: string | null, resetRaw: string | null, now: number,
): UsageWindowView | undefined {
  const limit = finite(limitRaw)
  const remaining = finite(remainingRaw)
  if (limit === undefined || remaining === undefined) return undefined
  const resetsAt = resetInstantFromValue(resetRaw, now)
  return {
    kind,
    ...label === undefined ? {} : { label },
    limit,
    remaining,
    ...limit > 0 ? { usedPercent: Math.min(100, Math.max(0, 100 * (1 - remaining / limit))) } : {},
    ...resetsAt === undefined ? {} : { resetsAt },
  }
}

/** A utilization header as a percentage (accepts a 0-1 fraction or 0-100). */
function percentOf(raw: string | null): number | undefined {
  const value = finite(raw)
  if (value === undefined) return undefined
  return Math.min(100, Math.max(0, value <= 1 ? value * 100 : value))
}

/**
 * Usage windows disclosed by the whitelisted rate-limit headers of one
 * response (any status): OpenAI-style `x-ratelimit-*`, Anthropic per-bucket
 * and unified utilization, Codex per-window snapshots.
 * @param headers - the whitelisted response headers.
 * @param now - the response instant, in epoch milliseconds.
 * @returns the usage windows the headers disclose; empty when they disclose none.
 */
export function windowsFromHeaders(headers: Headers, now: number): UsageWindowView[] {
  const windows: UsageWindowView[] = []
  const push = (window: UsageWindowView | undefined): void => { if (window !== undefined) windows.push(window) }
  for (const kind of ['requests', 'tokens'] as const) {
    push(bucketWindow(kind, undefined, headers.get(`x-ratelimit-limit-${kind}`), headers.get(`x-ratelimit-remaining-${kind}`),
      headers.get(`x-ratelimit-reset-${kind}`), now))
  }
  for (const bucket of ['requests', 'tokens', 'input-tokens', 'output-tokens'] as const) {
    push(bucketWindow(bucket === 'requests' ? 'requests' : 'tokens', bucket === 'input-tokens' ? 'input' : bucket === 'output-tokens' ? 'output' : undefined,
      headers.get(`anthropic-ratelimit-${bucket}-limit`), headers.get(`anthropic-ratelimit-${bucket}-remaining`),
      headers.get(`anthropic-ratelimit-${bucket}-reset`), now))
  }
  const unifiedReset = resetInstantFromValue(headers.get('anthropic-ratelimit-unified-reset'), now)
  for (const [name, kind, durationMs] of [['5h', 'session', 5 * 3_600_000], ['7d', 'weekly', 7 * DAY_MS]] as const) {
    const usedPercent = percentOf(headers.get(`anthropic-ratelimit-unified-${name}-utilization`))
    if (usedPercent !== undefined) windows.push({ kind, usedPercent, durationMs, ...kind === 'session' && unifiedReset !== undefined ? { resetsAt: unifiedReset } : {} })
  }
  for (const lane of ['primary', 'secondary'] as const) {
    const usedPercent = finite(headers.get(`x-codex-${lane}-used-percent`))
    if (usedPercent === undefined) continue
    const minutes = finite(headers.get(`x-codex-${lane}-window-minutes`))
    const after = finite(headers.get(`x-codex-${lane}-reset-after-seconds`))
    const durationMs = minutes === undefined ? undefined : minutes * 60_000
    windows.push({
      kind: durationMs === undefined ? (lane === 'primary' ? 'session' : 'weekly') : durationMs >= DAY_MS ? 'weekly' : 'session',
      usedPercent,
      ...durationMs === undefined ? {} : { durationMs },
      ...after === undefined ? {} : { resetsAt: now + after * 1_000 },
    })
  }
  return windows
}
