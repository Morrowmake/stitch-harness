import { describe, expect, it } from 'vitest'
import { credentialKey, isCredentialKeySegment } from '@deepseek-ai/dsh-credentials'
import { classify, cooldownUntil, MAX_HINT_MS, REFRESH_FAILURE_CODE } from '../src/accounts/classify.ts'
import type { FailureInput } from '../src/accounts/classify.ts'
import { buildAccounts } from '../src/accounts/directory.ts'
import { AccountHealthRegistry } from '../src/accounts/health.ts'
import { isAccountId, isAccountRoute, newAccountId, parseRecordKey, recordKeyFor } from '../src/accounts/keys.ts'
import type { AccountRuntime } from '../src/accounts/runtime.ts'
import { allows, isExhausted, select, StickyMap } from '../src/accounts/scheduler.ts'
import { resolveProfiles } from '../src/config.ts'

describe('account keys', () => {
  it('round-trips record keys; the legacy bare key is account main', () => {
    expect(recordKeyFor('openai-codex')).toBe('llm-pi-ai/openai-codex')
    expect(recordKeyFor('openai-codex', 'main')).toBe('llm-pi-ai/openai-codex')
    expect(recordKeyFor('openai-codex', 'k3j9x0a1bc')).toBe('llm-pi-ai/openai-codex--k3j9x0a1bc')
    expect(parseRecordKey(recordKeyFor('openai-codex'))).toEqual({ route: 'openai-codex', account: 'main' })
    expect(parseRecordKey(recordKeyFor('openai-codex', 'k3j9x0a1bc'))).toEqual({ route: 'openai-codex', account: 'k3j9x0a1bc' })
    expect(parseRecordKey(credentialKey('mcp-client', 'openai'))).toBeUndefined()
    // A suffix that is not an account id leaves the whole id as a (legacy) route.
    expect(parseRecordKey(credentialKey('llm-pi-ai', 'zai-coding-cn'))).toEqual({ route: 'zai-coding-cn', account: 'main' })
  })

  it('rejects routes containing "--" and virtual or malformed account ids', () => {
    expect(() => recordKeyFor('a--b')).toThrow(/reserved "--"/)
    expect(isAccountRoute('a--b')).toBe(false)
    expect(() => recordKeyFor('openai', 'env')).toThrow(/no credential record/)
    expect(() => recordKeyFor('openai', 'ambient')).toThrow(/no credential record/)
    expect(() => recordKeyFor('openai', 'ABCDEFGH')).toThrow()
    expect(isAccountId('short')).toBe(false)
    expect(isAccountId('abcdefgh')).toBe(true)
    expect(isAccountId('a'.repeat(17))).toBe(false)
  })

  it('produces keys inside the credential grammar for fresh ids', () => {
    for (let index = 0; index < 50; index += 1) {
      const id = newAccountId()
      expect(isAccountId(id)).toBe(true)
      expect(isCredentialKeySegment(`openai-codex--${id}`)).toBe(true)
      expect(parseRecordKey(recordKeyFor('openai-codex', id))).toEqual({ route: 'openai-codex', account: id })
    }
  })

  it('refuses "--" route keys and reserved ~acct: model ids in profiles', () => {
    expect(() => resolveProfiles({ 'a--b': {} })).toThrow(/reserved for account record keys/)
    expect(() => resolveProfiles({ acme: { api: 'openai-completions', baseURL: 'https://x.test', models: [{ id: '~acct:x:y' }] } }))
      .toThrow(/reserved "~acct:" prefix/)
    expect(() => resolveProfiles({ openai: { accounts: { BAD: {} } } })).toThrow(/not an account id/)
    expect(resolveProfiles({ openai: { accounts: { main: { alias: 'Personal', models: ['gpt-5'] } } } }).get('openai')?.accounts)
      .toEqual({ main: { alias: 'Personal', models: ['gpt-5'] } })
  })
})

describe('account directory (migration)', () => {
  it('treats the legacy record as account main with default metadata', () => {
    const [main] = buildAccounts('openai-codex', undefined, [{ account: 'main', kind: 'grant' }])
    expect(main).toMatchObject({
      id: 'main', kind: 'oauth', isDefault: true, recordKey: 'llm-pi-ai/openai-codex', meta: { pooled: true, pinned: false },
    })
  })

  it('derives the default main → env → oldest, honours defaultAccount, ignores orphan metadata', () => {
    const stored = [{ account: 'bbbbbbbbbb', kind: 'grant' as const }, { account: 'aaaaaaaaaa', kind: 'api-key' as const }]
    const accounts = { aaaaaaaaaa: { createdAt: 20 }, bbbbbbbbbb: { createdAt: 10 }, zzzzzzzzzz: { alias: 'orphan' } }
    expect(buildAccounts('r', { accounts }, stored).map(account => [account.id, account.isDefault]))
      .toEqual([['bbbbbbbbbb', true], ['aaaaaaaaaa', false]])
    const withEnv = buildAccounts('r', { accounts, apiKeyEnv: 'R_KEY' as never }, stored)
    expect(withEnv.find(account => account.isDefault)?.id).toBe('env')
    expect(withEnv.find(account => account.id === 'env')?.kind).toBe('key-ref')
    expect(buildAccounts('r', { accounts, defaultAccount: 'aaaaaaaaaa' }, [...stored, { account: 'main', kind: 'grant' }])[0]?.id)
      .toBe('aaaaaaaaaa')
    expect(buildAccounts('r', { accounts }, [...stored, { account: 'main', kind: 'grant' }])[0]?.id).toBe('main')
    expect(buildAccounts('r', undefined, []).map(account => account.kind)).toEqual(['ambient'])
  })
})

function account(id: string, extra: Partial<Omit<AccountRuntime, 'meta'>> & { meta?: Partial<AccountRuntime['meta']> } = {}): AccountRuntime {
  return {
    provider: 'r', id, kind: 'oauth', isDefault: false, ...extra,
    meta: { pooled: true, pinned: false, ...extra.meta },
  }
}

describe('scheduler', () => {
  const now = 1_000_000
  const base = { route: 'r', modelId: 'm', now, available: () => true }

  it('orders the default first, then order/createdAt/id', () => {
    const order = select({ ...base, candidates: [
      account('cccccccc', { meta: { createdAt: 1 } }),
      account('bbbbbbbb', { meta: { order: 1 } }),
      account('aaaaaaaa', { isDefault: true }),
      account('dddddddd'),
    ] }).map(one => one.id)
    expect(order).toEqual(['aaaaaaaa', 'bbbbbbbb', 'cccccccc', 'dddddddd'])
  })

  it('excludes unpooled accounts but falls back to an unpooled default', () => {
    expect(select({ ...base, candidates: [account('aaaaaaaa', { meta: { pooled: false } }), account('bbbbbbbb')] }).map(one => one.id))
      .toEqual(['bbbbbbbb'])
    expect(select({ ...base, candidates: [account('aaaaaaaa', { isDefault: true, meta: { pooled: false } })] }).map(one => one.id))
      .toEqual(['aaaaaaaa'])
  })

  it('applies allowlists: absent = all, [] = none, explicit', () => {
    expect(allows(undefined, 'm')).toBe(true)
    expect(allows([], 'm')).toBe(false)
    expect(allows(['m'], 'm')).toBe(true)
    expect(select({ ...base, candidates: [account('aaaaaaaa', { meta: { models: [] } }), account('bbbbbbbb', { meta: { models: ['x'] } })] }))
      .toEqual([])
  })

  it('skips cooling accounts and defers fresh exhausted snapshots; ignores stale ones', () => {
    const exhausted = { supported: true, source: 'endpoint' as const, staleAt: now + 1, windows: [{ kind: 'session' as const, usedPercent: 100, resetsAt: now + 60_000 }] }
    const usage = { peek: (_route: string, id: string) => id === 'aaaaaaaa' ? exhausted : undefined }
    const candidates = [account('aaaaaaaa', { isDefault: true }), account('bbbbbbbb'), account('cccccccc')]
    expect(select({ ...base, candidates, usage, available: one => one.id !== 'cccccccc' }).map(one => one.id))
      .toEqual(['bbbbbbbb', 'aaaaaaaa'])
    expect(isExhausted({ ...exhausted, staleAt: now - 1 }, now)).toBe(false)
    expect(isExhausted({ ...exhausted, credits: { hasCredits: true, unlimited: false } }, now)).toBe(false)
  })

  it('keeps a session on its failover target after the default recovers', () => {
    const sticky = new StickyMap()
    sticky.remember('s|r', 'bbbbbbbb')
    const candidates = [account('aaaaaaaa', { isDefault: true }), account('bbbbbbbb')]
    expect(select({ ...base, candidates, sticky, sessionKey: 's|r' }).map(one => one.id)).toEqual(['bbbbbbbb', 'aaaaaaaa'])
  })

  it('evicts the oldest sticky entry beyond capacity', () => {
    const sticky = new StickyMap(2)
    sticky.remember('a', 'x')
    sticky.remember('b', 'x')
    sticky.remember('c', 'x')
    expect(sticky.get('a')).toBeUndefined()
    expect(sticky.get('c')).toBe('x')
  })
})

describe('health registry', () => {
  it('separates model-scoped and account-scoped cooldowns, keeping the longer deadline', () => {
    let now = 0
    const health = new AccountHealthRegistry(() => now)
    health.markCooling('r', 'a', 'm1', 'RATE_LIMIT', 1_000)
    expect(health.isAvailable('r', 'a', 'm1')).toBe(false)
    expect(health.isAvailable('r', 'a', 'm2')).toBe(true)
    health.markCooling('r', 'a', undefined, 'QUOTA', 5_000)
    health.markCooling('r', 'a', undefined, 'QUOTA', 2_000)
    expect(health.view('r', 'a', 'm2')).toEqual({ state: 'cooling', until: 5_000, reason: 'QUOTA', scope: 'account' })
    expect(health.earliestRecovery('r', ['a'], 'm1')).toBe(5_000)
    now = 6_000
    expect(health.view('r', 'a')).toEqual({ state: 'ok' })
    health.markNeedsSignIn('r', 'a', 'AUTH')
    expect(health.view('r', 'a')).toEqual({ state: 'needs-sign-in', reason: 'AUTH' })
    health.clear('r', 'a')
    expect(health.view('r', 'a')).toEqual({ state: 'ok' })
  })
})

describe('failure classification', () => {
  const now = 1_000
  const input = (code: string, extra: Partial<FailureInput> = {}): FailureInput => ({
    code, message: code, route: 'openai-codex', kind: 'oauth', now, attempt: 1, refreshed: false, ...extra,
  })

  it('fails over on rate limits, scoped per account for subscriptions and per model otherwise', () => {
    expect(classify(input('RATE_LIMIT'))).toEqual({
      action: 'failover', limited: 'RATE_LIMIT', cooling: { reason: 'RATE_LIMIT', scope: 'account', until: now + 30_000 },
    })
    expect(classify(input('RATE_LIMIT', { kind: 'api-key' })).action === 'failover'
      && classify(input('RATE_LIMIT', { kind: 'api-key' }))).toMatchObject({ cooling: { scope: 'model' } })
    expect(classify(input('RATE_LIMIT', { route: 'anthropic' }))).toMatchObject({ cooling: { scope: 'model' } })
  })

  it('grows cooldowns exponentially with a cap, and lets a provider hint win up to 8 days', () => {
    expect(cooldownUntil(0, 1, 30_000, 600_000)).toBe(30_000)
    expect(cooldownUntil(0, 3, 30_000, 600_000)).toBe(120_000)
    expect(cooldownUntil(0, 20, 30_000, 600_000)).toBe(600_000)
    expect(classify(input('QUOTA', { attempt: 2 }))).toMatchObject({ limited: 'QUOTA', cooling: { reason: 'QUOTA', until: now + 3_600_000 } })
    expect(classify(input('QUOTA', { attempt: 99 }))).toMatchObject({ cooling: { until: now + 6 * 3_600_000 } })
    expect(classify(input('RATE_LIMIT', { hintAt: now + 5_000 }))).toMatchObject({ cooling: { until: now + 5_000 } })
    expect(classify(input('RATE_LIMIT', { hintAt: now + 99 * MAX_HINT_MS }))).toMatchObject({ cooling: { until: now + MAX_HINT_MS } })
  })

  it('retries an OAuth 401 once after a forced refresh, then marks sign-in', () => {
    expect(classify(input('AUTH'))).toEqual({ action: 'retry-same' })
    expect(classify(input('AUTH', { refreshed: true }))).toEqual({ action: 'failover', signIn: 'AUTH' })
    expect(classify(input('AUTH', { kind: 'api-key' }))).toEqual({ action: 'failover', signIn: 'AUTH' })
    expect(classify(input('INVALID_CREDENTIAL'))).toEqual({ action: 'failover', signIn: 'INVALID_CREDENTIAL' })
    expect(classify(input('MISSING_CREDENTIAL'))).toEqual({ action: 'failover', signIn: 'MISSING_CREDENTIAL' })
  })

  it('separates permanent from transient refresh failures', () => {
    expect(classify(input(REFRESH_FAILURE_CODE, { message: 'refresh failed: invalid_grant' })))
      .toEqual({ action: 'failover', signIn: 'INVALID_CREDENTIAL' })
    expect(classify(input(REFRESH_FAILURE_CODE, { message: 'fetch failed: ECONNRESET' })))
      .toEqual({ action: 'failover', cooling: { reason: 'REFRESH_FAILED', scope: 'account', until: now + 60_000 } })
  })

  it('maps captured 402/404 statuses and throws everything that is not the account’s fault', () => {
    expect(classify(input('PI_AI_ERROR', { status: 402 }))).toMatchObject({ action: 'failover', limited: 'QUOTA', cooling: { reason: 'HTTP_402' } })
    expect(classify(input('PI_AI_ERROR', { status: 404 }))).toMatchObject({ action: 'failover', cooling: { reason: 'HTTP_404', scope: 'model' } })
    for (const code of ['SERVER', 'TIMEOUT', 'TRANSPORT', 'EMPTY_RESPONSE', 'STREAM_CLOSED', 'CONTEXT_WINDOW_EXCEEDED',
      'INVALID_REQUEST', 'ABORTED', 'PI_AI_ERROR', 'UNKNOWN_MODEL', 'HTTP_418', 'MALFORMED_RESPONSE']) {
      expect(classify(input(code))).toEqual({ action: 'throw' })
    }
  })
})
