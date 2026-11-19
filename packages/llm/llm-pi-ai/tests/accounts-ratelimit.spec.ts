import { describe, expect, it } from 'vitest'
import { capturingFetch, FETCHABLE_APIS, MAX_ERROR_BODY_BYTES, observationOf } from '../src/accounts/capture.ts'
import type { Observation } from '../src/accounts/runtime.ts'
import {
  durationMs, isWhitelistedHeader, refusalReset, resetInstantFromValue, retryAfterInstant, textResetHint, waitFromReset, windowsFromHeaders,
} from '../src/accounts/ratelimit.ts'

const now = 1_800_000_000_000

describe('rate-limit parsing', () => {
  it('parses Go durations strictly', () => {
    expect(durationMs('6m0s')).toBe(360_000)
    expect(durationMs('1h2m3.5s')).toBe(3_723_500)
    expect(durationMs('150ms')).toBe(150)
    expect(durationMs('1s2h')).toBeUndefined()
    expect(durationMs('0s')).toBeUndefined()
    expect(durationMs('6m later')).toBeUndefined()
  })

  it('reads epoch ms, epoch s, delay seconds, and dates', () => {
    expect(resetInstantFromValue(now + 5, now)).toBe(now + 5)
    expect(resetInstantFromValue(1_800_000_100, now)).toBe(1_800_000_100_000)
    expect(resetInstantFromValue('30', now)).toBe(now + 30_000)
    expect(resetInstantFromValue('2027-01-15T00:00:00Z', now)).toBe(Date.parse('2027-01-15T00:00:00Z'))
    expect(waitFromReset(now - 5_000, now)).toBe(1_000)
    expect(waitFromReset(now + 10_000, now)).toBe(12_000)
  })

  it('reads retry-after as seconds or HTTP-date, never as an epoch', () => {
    expect(retryAfterInstant(new Headers({ 'retry-after': '120' }), now)).toBe(now + 120_000)
    expect(retryAfterInstant(new Headers({ 'retry-after': 'Wed, 21 Oct 2026 07:28:00 GMT' }), now)).toBe(Date.parse('Wed, 21 Oct 2026 07:28:00 GMT'))
    expect(retryAfterInstant(new Headers(), now)).toBeUndefined()
  })

  it('reads Codex resets from the body only, ignoring per-window rollover headers', () => {
    const rollover = new Headers({ 'x-codex-primary-reset-after-seconds': '18000' })
    expect(refusalReset('openai-codex', rollover, '{"error":{"type":"usage_limit_reached","resets_in_seconds":42}}', now)).toBe(now + 42_000)
    expect(refusalReset('openai-codex', rollover, '{}', now)).toBeUndefined()
  })

  it('reads Claude unified headers first, then the body; never per-bucket rollover headers', () => {
    const headers = new Headers({
      'anthropic-ratelimit-unified-reset': String(Math.floor(now / 1_000) + 600),
      'anthropic-ratelimit-tokens-reset': '2026-01-01T00:00:00Z',
    })
    expect(refusalReset('anthropic', headers, '', now)).toBe(now + 600_000)
    expect(refusalReset('anthropic', new Headers({ 'anthropic-ratelimit-tokens-reset': '2030-01-01T00:00:00Z' }), '', now)).toBeUndefined()
    expect(refusalReset('anthropic', new Headers(), '{"error":{"resets_at":"2030-01-01T00:00:00Z"}}', now)).toBe(Date.parse('2030-01-01T00:00:00Z'))
  })

  it('reads Google RPC hints from error text', () => {
    expect(textResetHint('429 {"error":{"details":[{"retryDelay": "34s"}]}}', now)).toBe(now + 34_000)
    expect(textResetHint('{"quotaResetDelay":"1h2m"}', now)).toBe(now + 3_720_000)
    expect(textResetHint('Quota exceeded, please retry in 34.5s.', now)).toBe(now + 34_500)
    expect(refusalReset('google', new Headers(), '{"quotaResetDelay":"5s"}', now)).toBe(now + 5_000)
  })

  it('derives usage windows from OpenAI, Anthropic, OpenRouter, and Codex headers', () => {
    expect(windowsFromHeaders(new Headers({
      'x-ratelimit-limit-requests': '100', 'x-ratelimit-remaining-requests': '25', 'x-ratelimit-reset-requests': '6m0s',
    }), now)).toEqual([{ kind: 'requests', limit: 100, remaining: 25, usedPercent: 75, resetsAt: now + 360_000 }])
    expect(windowsFromHeaders(new Headers({
      'anthropic-ratelimit-input-tokens-limit': '1000', 'anthropic-ratelimit-input-tokens-remaining': '1000',
      'anthropic-ratelimit-unified-5h-utilization': '0.42',
    }), now)).toEqual([
      { kind: 'tokens', label: 'input', limit: 1000, remaining: 1000, usedPercent: 0 },
      { kind: 'session', usedPercent: 42, durationMs: 18_000_000 },
    ])
    expect(windowsFromHeaders(new Headers({
      'x-codex-primary-used-percent': '12', 'x-codex-primary-window-minutes': '10080', 'x-codex-primary-reset-after-seconds': '60',
    }), now)).toEqual([{ kind: 'weekly', usedPercent: 12, durationMs: 604_800_000, resetsAt: now + 60_000 }])
  })

  it('whitelists rate-limit headers only', () => {
    expect(isWhitelistedHeader('Retry-After')).toBe(true)
    expect(isWhitelistedHeader('x-ratelimit-remaining-tokens')).toBe(true)
    expect(isWhitelistedHeader('authorization')).toBe(false)
    expect(isWhitelistedHeader('set-cookie')).toBe(false)
  })
})

describe('response capture', () => {
  it('passes 2xx through without reading its body', async () => {
    const seen: Observation[] = []
    let bodyRead = false
    const body = new ReadableStream({ pull() { bodyRead = true } }, { highWaterMark: 0 })
    const inner = (() => Promise.resolve(new Response(body, {
      status: 200, headers: { 'x-ratelimit-limit-tokens': '10', 'x-ratelimit-remaining-tokens': '5', 'set-cookie': 'secret' },
    }))) as typeof fetch
    const response = await capturingFetch('openai', { observe: obs => seen.push(obs) }, inner, () => now)('https://api.test')
    expect(response.status).toBe(200)
    expect(bodyRead).toBe(false)
    expect(seen).toEqual([{ at: now, status: 200, ok: true, windows: [{ kind: 'tokens', limit: 10, remaining: 5, usedPercent: 50 }] }])
  })

  it('reads at most 64 KiB of a non-2xx body and leaves the response readable', async () => {
    const seen: Observation[] = []
    const huge = `{"error":{"resets_in_seconds":7}}${' '.repeat(MAX_ERROR_BODY_BYTES * 2)}`
    const inner = (() => Promise.resolve(new Response(huge, { status: 429, headers: { 'retry-after': '3' } }))) as typeof fetch
    const response = await capturingFetch('openai-codex', { observe: obs => seen.push(obs) }, inner, () => now)('https://api.test')
    expect(seen[0]).toMatchObject({ status: 429, ok: false, retryAfterAt: now + 3_000, resetAt: now + 7_000 })
    expect((await response.text()).length).toBe(huge.length)
  })

  it('reports an unparsable refusal as a diagnostic without auth headers', () => {
    const diagnostics: string[] = []
    observationOf('openai', 429, new Headers({ 'x-ratelimit-reset-tokens': 'soon' }), 'slow down', now, { observe: () => {}, diagnose: detail => diagnostics.push(detail) })
    expect(diagnostics[0]).toContain('x-ratelimit-reset-tokens: soon')
    expect(diagnostics[0]).not.toContain('authorization')
  })

  it('never injects fetch for the Google APIs', () => {
    expect(FETCHABLE_APIS.has('google-generative-ai')).toBe(false)
    expect(FETCHABLE_APIS.has('google-vertex')).toBe(false)
    expect(FETCHABLE_APIS.has('anthropic-messages')).toBe(true)
  })
})
