import { mkdtemp, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import LocalCredentialProvider from '@deepseek-ai/dsh-credentials-local'
import { BlockAssembler, LlmError } from '@deepseek-ai/dsh-llm'
import type { FinishReason, StreamChunk } from '@deepseek-ai/dsh-llm'
import type { Credential, OAuthCredential } from '@earendil-works/pi-ai'
import { PiAiAdapter } from '../src/adapter.ts'
import { authContextFrom } from '../src/auth.ts'
import { PoolDirectory } from '../src/accounts/directory.ts'
import { AccountPool } from '../src/accounts/router.ts'
import { accountCredentialStore } from '../src/accounts/store.ts'
import { resolveProfiles } from '../src/config.ts'
import type { PiAiProviderProfile, ResolvedPiAiProviderProfile } from '../src/config.ts'
import { closeMockServers, mockServer, textEvents } from './mock-server.ts'

const B = 'bbbbbbbbbb'
const C = 'cccccccccc'
const cleanups: (() => Promise<void>)[] = []

afterEach(async () => {
  await closeMockServers()
  await Promise.all(cleanups.splice(0).map(cleanup => cleanup()))
  vi.useRealTimers()
})

interface Rig {
  ctx: Context
  adapter: PiAiAdapter
  pool: AccountPool
  credentialsPath: string
  setProfile: (profile: PiAiProviderProfile) => void
}

/** A real credential store plus an adapter over a hand-declared route, pooled. */
async function rig(
  baseURL: string,
  profile: PiAiProviderProfile = {},
  oauth?: { refresh: (credential: OAuthCredential) => Promise<OAuthCredential> },
): Promise<Rig> {
  const dir = await mkdtemp(join(tmpdir(), 'dsh-pi-pool-'))
  cleanups.push(() => rm(dir, { recursive: true, force: true }))
  const ctx = new Context()
  const credentialsPath = join(dir, '.credentials.yaml')
  await ctx.plugin(LocalCredentialProvider, { path: credentialsPath, watch: false })
  let current: ReadonlyMap<string, ResolvedPiAiProviderProfile> = new Map()
  const setProfile = (next: PiAiProviderProfile): void => {
    const resolved = resolveProfiles({ acme: { api: 'openai-completions', baseURL, models: [{ id: 'm' }, { id: 'n' }], ...next } })
    if (oauth !== undefined) {
      const route = resolved.get('acme')!
      const provider = route.piProvider!
      resolved.set('acme', {
        ...route,
        piProvider: {
          ...provider,
          auth: {
            ...provider.auth,
            oauth: {
              name: 'Acme',
              login: () => Promise.reject(new Error('not in tests')),
              refresh: credential => oauth.refresh(credential),
              toAuth: credential => Promise.resolve({ apiKey: credential.access }),
            },
          },
        },
      })
    }
    current = resolved
  }
  setProfile(profile)
  const profiles = (): ReadonlyMap<string, ResolvedPiAiProviderProfile> => current
  const pool = new AccountPool(new PoolDirectory(ctx, profiles))
  const adapter = new PiAiAdapter({
    profiles,
    resolveApiKey: () => Promise.resolve(undefined),
    auth: {
      credentials: accountCredentialStore(ctx),
      authContext: authContextFrom(ctx),
      accountCredentials: account => accountCredentialStore(ctx, account),
    },
    pool,
  })
  return { ctx, adapter, pool, credentialsPath, setProfile: (next) => { setProfile(next); pool.directory.invalidate() } }
}

async function store(ctx: Context, account: string, credential: Credential): Promise<void> {
  await accountCredentialStore(ctx, account).modify('acme', () => Promise.resolve(credential))
}

async function run(adapter: PiAiAdapter, model = 'm', sessionId?: string): Promise<{ chunks: StreamChunk[]; finish: FinishReason }> {
  const assembler = new BlockAssembler()
  const chunks: StreamChunk[] = []
  for await (const chunk of adapter.stream({
    provider: 'acme', model, messages: [], ...sessionId === undefined ? {} : { sessionId: sessionId as never },
  })) {
    chunks.push(chunk)
    assembler.push(chunk)
  }
  return { chunks, finish: assembler.finish }
}

const RATE_LIMITED = { status: 429, body: '{"error":{"message":"Rate limit reached"}}', headers: { 'retry-after': '30' } }

describe('account router', () => {
  it('fails over a 429 before content to the next account, cooling the first with the provider hint', async () => {
    const server = await mockServer([RATE_LIMITED, { events: textEvents }])
    const { ctx, adapter, pool } = await rig(server.url)
    await store(ctx, 'main', { type: 'api_key', key: 'key-a' })
    await store(ctx, B, { type: 'api_key', key: 'key-b' })

    const before = Date.now()
    const result = await run(adapter, 'm', 'session-1')

    expect(result.finish).toEqual({ kind: 'stop' })
    expect(server.headers.map(headers => headers.authorization)).toEqual(['Bearer key-a', 'Bearer key-b'])
    const view = pool.health.view('acme', 'main', 'm')
    expect(view).toMatchObject({ state: 'cooling', reason: 'RATE_LIMIT', scope: 'model' })
    expect(view.state === 'cooling' && view.until).toBeGreaterThanOrEqual(before + 30_000)
    // API-key rate limits are per model: the other model still serves from main.
    expect(pool.health.isAvailable('acme', 'main', 'n')).toBe(true)
    expect(pool.sticky.get('session-1|acme')).toBe(B)
  })

  it('never fails over after a content chunk', async () => {
    const truncated = textEvents.slice(0, 2)
    const server = await mockServer([{ events: truncated }, { events: textEvents }])
    const { ctx, adapter } = await rig(server.url)
    await store(ctx, 'main', { type: 'api_key', key: 'key-a' })
    await store(ctx, B, { type: 'api_key', key: 'key-b' })

    const result = await run(adapter)

    expect(result.finish.kind).toBe('error')
    expect(server.headers).toHaveLength(1)
  })

  it('surfaces request faults without touching a second account', async () => {
    const server = await mockServer([{ status: 400, body: '{"error":{"message":"invalid request: bad tool"}}' }])
    const { ctx, adapter, pool } = await rig(server.url)
    await store(ctx, 'main', { type: 'api_key', key: 'key-a' })
    await store(ctx, B, { type: 'api_key', key: 'key-b' })

    const result = await run(adapter)

    expect(result.finish).toMatchObject({ kind: 'error', failure: { code: 'INVALID_REQUEST', status: 400 } })
    expect(server.headers).toHaveLength(1)
    expect(pool.health.view('acme', 'main')).toEqual({ state: 'ok' })
  })

  it('throws an exhausted error with the last code and the earliest recovery when every account is limited', async () => {
    const server = await mockServer([RATE_LIMITED, { ...RATE_LIMITED, headers: { 'retry-after': '90' } }])
    const { ctx, adapter } = await rig(server.url, { accounts: { main: { alias: 'Personal' }, [B]: { alias: 'Work' } } })
    await store(ctx, 'main', { type: 'api_key', key: 'key-a' })
    await store(ctx, B, { type: 'api_key', key: 'key-b' })

    const failure = await run(adapter).then(() => undefined, (error: unknown) => error)

    expect(failure).toBeInstanceOf(LlmError)
    const error = failure as LlmError
    expect(error.code).toBe('RATE_LIMIT')
    expect(error.failure.providerRetryAfterMs).toBeGreaterThan(25_000)
    expect(error.failure.providerRetryAfterMs).toBeLessThanOrEqual(32_000)
    expect(error.message).toMatch(/Personal: RATE_LIMIT, recovers in 1m; Work: RATE_LIMIT, recovers in 2m/)
    expect(error.message).not.toContain('key-')
    // The next request does not touch the network: nothing is available.
    await expect(run(adapter)).rejects.toMatchObject({ code: 'RATE_LIMIT' })
    expect(server.headers).toHaveLength(2)
  })

  it('serves pinned entries from exactly their account and never falls over', async () => {
    const server = await mockServer([{ events: textEvents }, RATE_LIMITED])
    const { ctx, adapter, setProfile } = await rig(server.url, { accounts: { [B]: { pinned: true, alias: 'Work' } } })
    await store(ctx, 'main', { type: 'api_key', key: 'key-a' })
    await store(ctx, B, { type: 'api_key', key: 'key-b' })

    expect((await run(adapter, `~acct:${B}:m`)).finish).toEqual({ kind: 'stop' })
    expect(server.headers[0]?.authorization).toBe('Bearer key-b')
    await expect(adapter.resolveModel('acme', `~acct:${B}:m`)).resolves.toMatchObject({ id: `~acct:${B}:m`, name: 'm' })

    // Its own 429 is its own failure: no second account is tried.
    const limited = await run(adapter, `~acct:${B}:m`)
    expect(limited.finish).toMatchObject({ kind: 'error', failure: { code: 'RATE_LIMIT', status: 429, providerRetryAfterMs: expect.any(Number) as number } })
    expect(server.headers).toHaveLength(2)

    // Unpinned (or removed) ⇒ a failure naming the account, never a fallback.
    setProfile({})
    await expect(run(adapter, `~acct:${B}:m`)).rejects.toMatchObject({ code: 'NO_ADAPTER' })
    await expect(run(adapter, '~acct:zzzzzzzzzz:m')).rejects.toThrow(/zzzzzzzzzz/)
  })

  it('carries status and retry-after on a single-account error finish', async () => {
    const server = await mockServer([RATE_LIMITED])
    const { ctx, adapter } = await rig(server.url)
    await store(ctx, 'main', { type: 'api_key', key: 'key-a' })

    const result = await run(adapter)

    expect(result.finish).toMatchObject({ kind: 'error', failure: { code: 'RATE_LIMIT', status: 429 } })
    const failure = result.finish.kind === 'error' ? result.finish.failure : undefined
    expect(failure?.providerRetryAfterMs).toBeGreaterThanOrEqual(30_000)
  })

  it('lists pool models by allowlist and pinned entries with the alias badge', async () => {
    const server = await mockServer([])
    const { ctx, adapter } = await rig(server.url, {
      accounts: { main: { models: ['m'] }, [B]: { pooled: false, pinned: true, alias: 'Work' } },
    })
    await store(ctx, 'main', { type: 'api_key', key: 'key-a' })
    await store(ctx, B, { type: 'api_key', key: 'key-b' })

    const listed = await adapter.listModels('acme')

    expect(listed.map(model => [model.id, model.badge?.text])).toEqual([
      ['m', undefined],
      [`~acct:${B}:m`, 'Work'],
      [`~acct:${B}:n`, 'Work'],
    ])
  })

  it('lists an ambient-only route, and nothing for a missing named key without records', async () => {
    const server = await mockServer([])
    const ambient = await rig(server.url)
    expect((await ambient.adapter.listModels('acme')).map(model => model.id)).toEqual(['m', 'n'])

    const named = await rig(server.url, { apiKeyEnv: 'ACME_MISSING_KEY' })
    const adapter = new PiAiAdapter({
      profiles: () => resolveProfiles({ acme: { api: 'openai-completions', baseURL: server.url, models: [{ id: 'm' }], apiKeyEnv: 'ACME_MISSING_KEY' } }),
      resolveApiKey: () => Promise.reject(new LlmError('missing', 'MISSING_CREDENTIAL')),
      auth: { credentials: accountCredentialStore(named.ctx), authContext: authContextFrom(named.ctx) },
    })
    await expect(adapter.listModels('acme')).resolves.toEqual([])
  })
})

describe('OAuth account auth handling', () => {
  const oauthCredential = (access: string, expires = Date.now() + 3_600_000): Credential =>
    ({ type: 'oauth', access, refresh: `refresh-${access}`, expires })

  it('refreshes once and retries the same account after a 401', async () => {
    const server = await mockServer([{ status: 401, body: '{"error":{"message":"unauthorized"}}' }, { events: textEvents }])
    const refresh = vi.fn((credential: OAuthCredential) => Promise.resolve({ ...credential, access: 'fresh', expires: Date.now() + 3_600_000 }))
    const { ctx, adapter } = await rig(server.url, {}, { refresh })
    await store(ctx, 'main', oauthCredential('stale'))

    const result = await run(adapter)

    expect(result.finish).toEqual({ kind: 'stop' })
    expect(refresh).toHaveBeenCalledTimes(1)
    expect(server.headers.map(headers => headers.authorization)).toEqual(['Bearer stale', 'Bearer fresh'])
  })

  it('fails over and marks sign-in after a second 401', async () => {
    const server = await mockServer([
      { status: 401, body: '{}' }, { status: 401, body: '{}' }, { events: textEvents },
    ])
    const refresh = vi.fn((credential: OAuthCredential) => Promise.resolve({ ...credential, access: `${credential.access}+`, expires: Date.now() + 3_600_000 }))
    const { ctx, adapter, pool } = await rig(server.url, {}, { refresh })
    await store(ctx, 'main', oauthCredential('a'))
    await store(ctx, B, oauthCredential('b'))

    expect((await run(adapter)).finish).toEqual({ kind: 'stop' })
    expect(server.headers.map(headers => headers.authorization)).toEqual(['Bearer a', 'Bearer a+', 'Bearer b'])
    expect(pool.health.view('acme', 'main')).toEqual({ state: 'needs-sign-in', reason: 'AUTH' })
  })

  it('keeps the record and marks sign-in when the refresh is rejected for good', async () => {
    const server = await mockServer([{ events: textEvents }])
    const refresh = vi.fn(() => Promise.reject(new Error('invalid_grant')))
    const { ctx, adapter, pool } = await rig(server.url, {}, { refresh })
    await store(ctx, 'main', oauthCredential('expired', 0))
    await store(ctx, B, { type: 'api_key', key: 'key-b' })

    expect((await run(adapter)).finish).toEqual({ kind: 'stop' })
    expect(server.headers[0]?.authorization).toBe('Bearer key-b')
    expect(pool.health.view('acme', 'main')).toEqual({ state: 'needs-sign-in', reason: 'INVALID_CREDENTIAL' })
    await expect(ctx.credentials.readRecord('llm-pi-ai/acme' as never)).resolves.toMatchObject({ kind: 'grant' })
  })

  it('cools an account for 60 s on a transient refresh failure', async () => {
    const server = await mockServer([{ events: textEvents }])
    const refresh = vi.fn(() => Promise.reject(new Error('fetch failed: ECONNRESET')))
    const { ctx, adapter, pool } = await rig(server.url, {}, { refresh })
    await store(ctx, 'main', oauthCredential('expired', 0))
    await store(ctx, B, { type: 'api_key', key: 'key-b' })

    expect((await run(adapter)).finish).toEqual({ kind: 'stop' })
    expect(pool.health.view('acme', 'main')).toMatchObject({ state: 'cooling', reason: 'REFRESH_FAILED', scope: 'account' })
  })

  it('binds replay state to the serving OAuth account and degrades it on a switch', async () => {
    const server = await mockServer([{ events: textEvents }, { events: textEvents }])
    const { ctx, adapter } = await rig(server.url, {}, { refresh: credential => Promise.resolve(credential) })
    await store(ctx, 'main', oauthCredential('a'))
    const chunks: StreamChunk[] = []
    for await (const chunk of adapter.stream({ provider: 'acme', model: 'm', messages: [] })) chunks.push(chunk)
    const finish = chunks.at(-1)
    expect(finish?.type === 'finish' && (finish.replayState as { response: { account?: string } }).response.account).toBe('main')

    const degraded: string[] = []
    const switched = new PiAiAdapter({
      profiles: () => resolveProfiles({ acme: { api: 'openai-completions', baseURL: server.url, models: [{ id: 'm' }] } }),
      resolveApiKey: () => Promise.resolve('key'),
      auth: { credentials: accountCredentialStore(ctx), authContext: authContextFrom(ctx) },
      onReplayDegrade: ({ reason }) => degraded.push(reason),
    })
    const history = {
      role: 'assistant' as const,
      content: [{ type: 'text' as const, text: 'hello' }],
      source: { provider: 'acme', model: 'm', ...finish?.type === 'finish' && finish.replayState !== undefined ? { replayState: finish.replayState } : {} },
    }
    for await (const _ of switched.stream({ provider: 'acme', model: 'm', messages: [history as never] })) { /* drain */ }
    expect(degraded).toEqual(['account switched'])
  })
})

describe('scoped credential stores', () => {
  it('reads and writes only their own record; sticky device ids survive refresh writes', async () => {
    const server = await mockServer([])
    const { ctx, credentialsPath } = await rig(server.url)
    const main = accountCredentialStore(ctx)
    const other = accountCredentialStore(ctx, B, { deviceId: 'device-b' })
    await main.modify('acme', () => Promise.resolve({ type: 'oauth', access: 'a', refresh: 'r', expires: 1 }))
    await other.modify('acme', () => Promise.resolve({ type: 'oauth', access: 'b', refresh: 'r', expires: 1 }))
    // A refresh returns a fresh object without the sticky member; it survives.
    await accountCredentialStore(ctx, B).modify('acme', () => Promise.resolve({ type: 'oauth', access: 'b2', refresh: 'r2', expires: 2 }))

    await expect(main.read('acme')).resolves.toEqual({ type: 'oauth', access: 'a', refresh: 'r', expires: 1 })
    await expect(other.read('acme')).resolves.toEqual({ type: 'oauth', access: 'b2', refresh: 'r2', expires: 2, deviceId: 'device-b' })
    await expect(main.list()).resolves.toEqual([{ providerId: 'acme', type: 'oauth' }])
    await expect(accountCredentialStore(ctx, C).read('acme')).resolves.toBeUndefined()
    expect((await readFile(credentialsPath, 'utf8')).split('device-b').length - 1).toBe(1)

    await other.delete('acme')
    await expect(main.read('acme')).resolves.toMatchObject({ access: 'a' })
    await expect(other.read('acme')).resolves.toBeUndefined()
    expect(await readFile(credentialsPath, 'utf8')).not.toContain('device-b')
    // A route id containing the separator cannot address a record.
    await expect(main.read('a--b')).resolves.toBeUndefined()
    await expect(main.modify('a--b', () => Promise.resolve(undefined))).rejects.toMatchObject({ code: 'UNSTORABLE_PROVIDER_ID' })
  })

  it('refreshes two accounts independently and in parallel, one refresh per account', async () => {
    const server = await mockServer([{ events: textEvents }, { events: textEvents }, { events: textEvents }])
    const refresh = vi.fn(async (credential: OAuthCredential) => {
      await new Promise(resolve => setTimeout(resolve, 20))
      return { ...credential, access: `${credential.access}-new`, expires: Date.now() + 3_600_000 }
    })
    const { ctx, adapter } = await rig(server.url, { accounts: { [B]: { pinned: true } } }, { refresh })
    await store(ctx, 'main', { type: 'oauth', access: 'a', refresh: 'ra', expires: 0 })
    await store(ctx, B, { type: 'oauth', access: 'b', refresh: 'rb', expires: 0 })

    await Promise.all([run(adapter), run(adapter), run(adapter, `~acct:${B}:m`)])

    expect(refresh.mock.calls.map(([credential]) => credential.access).sort()).toEqual(['a', 'b'])
  })
})
