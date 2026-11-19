/**
 * Usage-endpoint mappers (fixtures ported from dsh-plugin-subscriptions,
 * Copyright (c) 2026 V1ki, MIT License): payload → windows, request headers,
 * typed failures. No network: every fetch is a fake.
 */

import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { userAgent } from '@deepseek-ai/dsh-llm'
import type { Models } from '@earendil-works/pi-ai'
import { CLAUDE_USAGE_URL, fetchClaudeUsage } from '../src/accounts/usage/claude.ts'
import { CODEX_USAGE_URL, codexAccountId, fetchCodexUsage } from '../src/accounts/usage/codex.ts'
import { fetchGrokUsage, GROK_BILLING_URL, grokTierName } from '../src/accounts/usage/grok.ts'
import { UsageCredentialError, UsageFetchError } from '../src/accounts/usage/http.ts'
import type { FetchFn } from '../src/accounts/usage/http.ts'
import { accountToken, usageFetcherFor } from '../src/accounts/usage/index.ts'

const fixture = (name: string): unknown => JSON.parse(readFileSync(new URL(`fixtures/accounts/${name}.json`, import.meta.url), 'utf8'))

function jwt(payload: Record<string, unknown>): string {
  const encode = (value: unknown): string => Buffer.from(JSON.stringify(value)).toString('base64url')
  return `${encode({ alg: 'none' })}.${encode(payload)}.sig`
}

function fakeFetch(payload: unknown, status = 200, headers: Record<string, string> = {}): {
  fetchFn: FetchFn
  requests: { url: string; headers: Record<string, string> }[]
} {
  const requests: { url: string; headers: Record<string, string> }[] = []
  const fetchFn: FetchFn = (url, init) => {
    const seen: Record<string, string> = {}
    new Headers(init.headers).forEach((value, key) => { seen[key] = value })
    requests.push({ url, headers: seen })
    return Promise.resolve(new Response(JSON.stringify(payload), { status, headers }))
  }
  return { fetchFn, requests }
}

const CODEX_TOKEN = jwt({ 'https://api.openai.com/auth': { chatgpt_account_id: 'acct-1', chatgpt_plan_type: 'plus' } })

describe('codex usage', () => {
  it('maps windows, plan and resets, presenting pi-ai inference headers for the account', async () => {
    const { fetchFn, requests } = fakeFetch(fixture('codex-usage'))
    await expect(fetchCodexUsage({ token: CODEX_TOKEN }, fetchFn)).resolves.toEqual({
      plan: 'plus',
      windows: [
        { kind: 'session', usedPercent: 27, durationMs: 18_000_000, resetsAt: 1_782_770_922_000 },
        { kind: 'weekly', usedPercent: 4, durationMs: 604_800_000, resetsAt: 1_783_357_722_000 },
      ],
    })
    expect(requests).toHaveLength(1)
    expect(requests[0]?.url).toBe(CODEX_USAGE_URL)
    expect(requests[0]?.headers).toMatchObject({
      'authorization': `Bearer ${CODEX_TOKEN}`,
      'chatgpt-account-id': 'acct-1',
      'originator': 'pi',
      'user-agent': userAgent(),
    })
  })

  it('classifies a weekly lane in primary_window by duration and maps credits', async () => {
    const { fetchFn } = fakeFetch(fixture('codex-weekly-credits'))
    const usage = await fetchCodexUsage({ token: CODEX_TOKEN }, fetchFn)
    expect(usage.windows).toEqual([{ kind: 'weekly', usedPercent: 100, durationMs: 604_800_000, resetsAt: 1_794_553_515_000 }])
    expect(usage.credits).toEqual({ hasCredits: true, unlimited: false, balance: '13677.1121360000' })
  })

  it('falls back to slot kinds, other durations, and reset_after_seconds', async () => {
    const { fetchFn } = fakeFetch({
      rate_limit: {
        primary_window: { used_percent: 10, reset_after_seconds: 100 },
        secondary_window: { used_percent: 5, limit_window_seconds: 10_800 },
      },
      credits: { balance: 'not-a-number' },
    })
    const usage = await fetchCodexUsage({ token: CODEX_TOKEN }, fetchFn, undefined, 1_000)
    expect(usage).toEqual({
      windows: [
        { kind: 'session', usedPercent: 10, resetsAt: 101_000 },
        { kind: 'other', usedPercent: 5, durationMs: 10_800_000 },
      ],
    })
  })

  it('refuses a token naming no ChatGPT account without calling out', async () => {
    const { fetchFn, requests } = fakeFetch({})
    await expect(fetchCodexUsage({ token: 'opaque' }, fetchFn)).rejects.toBeInstanceOf(UsageCredentialError)
    expect(requests).toHaveLength(0)
    expect(codexAccountId(CODEX_TOKEN)).toBe('acct-1')
  })

  it('throws a typed error with retryAfterMs on non-2xx', async () => {
    const { fetchFn } = fakeFetch({ error: 'nope' }, 429, { 'retry-after': '462' })
    const error: unknown = await fetchCodexUsage({ token: CODEX_TOKEN }, fetchFn).catch((caught: unknown) => caught)
    expect(error).toBeInstanceOf(UsageFetchError)
    expect(error).toMatchObject({ status: 429, retryAfterMs: 462_000 })
  })
})

describe('claude usage', () => {
  it('maps legacy buckets and skips null ones, with the OAuth inference identity', async () => {
    const { fetchFn, requests } = fakeFetch(fixture('claude-legacy'))
    await expect(fetchClaudeUsage({ token: 'at' }, fetchFn)).resolves.toEqual({
      windows: [
        { kind: 'session', usedPercent: 6, durationMs: 18_000_000, resetsAt: Date.parse('2026-04-08T18:59:59Z') },
        { kind: 'weekly', usedPercent: 35, durationMs: 604_800_000, resetsAt: Date.parse('2026-04-14T16:59:59Z') },
        { kind: 'weekly', scope: 'Sonnet', usedPercent: 21, durationMs: 604_800_000 },
      ],
    })
    expect(requests[0]?.url).toBe(CLAUDE_USAGE_URL)
    expect(requests[0]?.headers).toMatchObject({
      'authorization': 'Bearer at',
      'anthropic-beta': 'claude-code-20250219,oauth-2025-04-20',
      'x-app': 'cli',
      'user-agent': userAgent(),
    })
  })

  it('prefers the modern limits array, scoped lanes included', async () => {
    const { fetchFn } = fakeFetch(fixture('claude-modern'))
    expect((await fetchClaudeUsage({ token: 'at' }, fetchFn)).windows).toEqual([
      { kind: 'session', usedPercent: 12, resetsAt: Date.parse('2026-04-08T18:59:59Z') },
      { kind: 'weekly', usedPercent: 40, durationMs: 604_800_000, resetsAt: Date.parse('2026-04-14T16:59:59Z') },
      { kind: 'weekly', scope: 'Opus', usedPercent: 7, durationMs: 604_800_000, resetsAt: Date.parse('2026-04-14T16:59:59Z') },
    ])
  })

  it('carries retry-after on a 429', async () => {
    const { fetchFn } = fakeFetch({}, 429, { 'retry-after': '30' })
    await expect(fetchClaudeUsage({ token: 'at' }, fetchFn)).rejects.toMatchObject({ status: 429, retryAfterMs: 30_000 })
  })
})

describe('grok usage', () => {
  it('maps the credits-config shape without claiming a CLI identity', async () => {
    const { fetchFn, requests } = fakeFetch(fixture('grok-credits'))
    await expect(fetchGrokUsage({ token: 'at' }, fetchFn)).resolves.toEqual({
      plan: 'SuperGrok Heavy',
      windows: [{ kind: 'weekly', usedPercent: 2, durationMs: 604_800_000, resetsAt: Date.parse('2026-08-18T10:14:00Z') }],
    })
    expect(requests[0]?.url).toBe(GROK_BILLING_URL)
    expect(requests[0]?.headers.authorization).toBe('Bearer at')
    expect(requests[0]?.headers['x-xai-token-auth']).toBeUndefined()
  })

  it('derives the percent from legacy cents and the plan from the token tier', async () => {
    const { fetchFn } = fakeFetch(fixture('grok-legacy'))
    await expect(fetchGrokUsage({ token: jwt({ tier: 5 }) }, fetchFn)).resolves.toEqual({
      plan: 'SuperGrok Heavy',
      windows: [{ kind: 'other', usedPercent: 25, resetsAt: Date.parse('2026-09-01T00:00:00Z') }],
    })
  })

  it('answers no windows for an empty config and throws on non-2xx', async () => {
    await expect(fetchGrokUsage({ token: 'at' }, fakeFetch({ config: null }).fetchFn)).resolves.toEqual({ windows: [] })
    await expect(fetchGrokUsage({ token: 'at' }, fakeFetch({}, 403).fetchFn)).rejects.toMatchObject({ status: 403 })
  })

  it('names tiers from the JWT claim', () => {
    expect(grokTierName(jwt({ tier: 1 }))).toBe('SuperGrok')
    expect(grokTierName(jwt({ tier: 42 }))).toBe('42')
    expect(grokTierName(jwt({ tier: 'pro' }))).toBeUndefined()
    expect(grokTierName('opaque')).toBeUndefined()
  })
})

describe('usage registry', () => {
  it('offers endpoints only to signed-in accounts of known routes', () => {
    expect(usageFetcherFor('openai-codex', 'oauth')).toBeDefined()
    expect(usageFetcherFor('anthropic', 'oauth')).toBeDefined()
    expect(usageFetcherFor('xai', 'oauth')).toBeDefined()
    expect(usageFetcherFor('anthropic', 'api-key')).toBeUndefined()
    expect(usageFetcherFor('github-copilot', 'oauth')).toBeUndefined()
  })

  it('reads the token from the api-key slot or a bearer header', async () => {
    const models = (auth: unknown): Models => ({ getAuth: () => Promise.resolve(auth) }) as never
    await expect(accountToken(models({ auth: { apiKey: 'k' } }), 'x')).resolves.toBe('k')
    await expect(accountToken(models({ auth: { headers: { Authorization: 'Bearer h' } } }), 'x')).resolves.toBe('h')
    await expect(accountToken(models(undefined), 'x')).rejects.toBeInstanceOf(UsageCredentialError)
  })
})
