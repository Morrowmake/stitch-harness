/**
 * The `llmAccounts` Remote over a fake pool runtime, the real credential
 * store and authorization seam, and an in-memory settings writer: listing
 * performs no network, writes touch only account metadata, sign-in attempts
 * register flows per attempt, and usage is fetched only for subscribers.
 */

import { mkdtemp, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import AuthorizationService from '@deepseek-ai/dsh-authorization'
import LocalCredentialProvider from '@deepseek-ai/dsh-credentials-local'
import type { AuthInteraction, AuthType, Credential, LoginOptions } from '@earendil-works/pi-ai'
import type { SettingsPathOp } from '@deepseek-ai/dsh-settings'
import type { AccountRuntime, AccountsRuntime as Runtime } from '../src/accounts/runtime.ts'
import type { ProviderAccountsView, SignInReason } from '../src/accounts/types.ts'
import type { FetchFn } from '../src/accounts/usage/http.ts'

type CredentialStore = { modify: (id: string, mutate: () => Promise<Credential>) => Promise<unknown> }
type LoginMock = (
  providerId: string,
  type: AuthType,
  interaction: AuthInteraction,
  options: LoginOptions | undefined,
  store: CredentialStore,
) => Promise<unknown>

const login = vi.hoisted(() => vi.fn<LoginMock>())

// A real login opens a browser; the collection is the boundary worth observing.
vi.mock('../src/models.ts', async importOriginal => ({
  ...await importOriginal<typeof import('../src/models.ts')>(),
  createModels: (options: { credentials: CredentialStore }) => ({
    setProvider: () => {},
    login: (providerId: string, type: AuthType, interaction: AuthInteraction, loginOptions?: LoginOptions) =>
      login(providerId, type, interaction, loginOptions, options.credentials),
  }),
}))

const { default: LlmAccountsRemote } = await import('../src/accounts/service.ts')
const { parseRecordKey, recordKeyFor } = await import('../src/accounts/keys.ts')

const dirs: string[] = []

afterEach(async () => {
  login.mockReset()
  await Promise.all(dirs.splice(0).map(dir => rm(dir, { recursive: true, force: true })))
})

function jwt(payload: Record<string, unknown>): string {
  const encode = (value: unknown): string => Buffer.from(JSON.stringify(value)).toString('base64url')
  return `${encode({ alg: 'none' })}.${encode(payload)}.sig`
}

interface Harness {
  ctx: Context
  remote: InstanceType<typeof LlmAccountsRemote>
  settings: { providers: Record<string, { defaultAccount?: string; accounts?: Record<string, Record<string, unknown>> }> }
  mutations: SettingsPathOp[][]
  fetches: string[]
  limited: (route: string, account: string) => void
  healthChanged: () => void
  resetHints: Array<[string, string, number]>
  credentialsFile: string
}

/** Apply settings path ops to a plain document (what `ctx.settings.mutate` does). */
function apply(doc: Record<string, unknown>, op: SettingsPathOp): void {
  const parent = op.path.slice(0, -1).reduce<Record<string, unknown>>((node, key) => {
    node[key] ??= {}
    return node[key] as Record<string, unknown>
  }, doc)
  const leaf = op.path.at(-1) as string
  if (op.op === 'set') parent[leaf] = op.value
  else Reflect.deleteProperty(parent, leaf)
}

async function harness(fetchFn?: FetchFn): Promise<Harness> {
  const dir = await mkdtemp(join(tmpdir(), 'dsh-pi-accounts-'))
  dirs.push(dir)
  const credentialsFile = join(dir, '.credentials.yaml')
  const ctx = new Context()
  await ctx.plugin(LocalCredentialProvider, { path: credentialsFile, watch: false })
  await ctx.plugin(AuthorizationService)
  const settings: Harness['settings'] = { providers: { 'openai-codex': {}, 'anthropic': {} } }
  const mutations: SettingsPathOp[][] = []
  ctx.provide('settings', {
    mutate: (ns: string, ops: readonly SettingsPathOp[]) => {
      expect(ns).toBe('llm-pi-ai')
      mutations.push([...ops])
      for (const op of ops) apply(settings, op)
      return Promise.resolve()
    },
  } as never)
  const fetches: string[] = []
  const limitedCbs: Array<(route: string, account: string, reason: 'RATE_LIMIT' | 'QUOTA') => void> = []
  const healthCbs: Array<() => void> = []
  const signIn = new Map<string, SignInReason>()
  const resetHints: Array<[string, string, number]> = []
  const runtime: Runtime = {
    settingsNs: 'llm-pi-ai',
    routes: () => new Map(Object.keys(settings.providers).map(route => [route, { displayName: route.toUpperCase() }])),
    endpoint: () => undefined,
    resolveKeyRef: () => Promise.resolve(undefined),
    directory: {
      async forRoute(route) {
        const records = await ctx.credentials.listRecords()
        const profile = settings.providers[route] ?? {}
        const accounts: AccountRuntime[] = []
        for (const record of records) {
          const parsed = parseRecordKey(record.key)
          if (parsed?.route !== route) continue
          const meta = profile.accounts?.[parsed.account] ?? {}
          accounts.push({
            provider: route,
            id: parsed.account,
            kind: record.kind === 'grant' ? 'oauth' : 'api-key',
            meta: { ...meta, pooled: meta.pooled !== false, pinned: meta.pinned === true },
            recordKey: record.key,
            isDefault: profile.defaultAccount === parsed.account,
          })
        }
        if (accounts.length === 0) {
          accounts.push({ provider: route, id: 'ambient', kind: 'ambient', meta: { pooled: true, pinned: false }, isDefault: true })
        }
        return accounts
      },
      invalidate: () => {},
    },
    health: {
      view: (route, account) => {
        const reason = signIn.get(`${route}/${account}`)
        return reason === undefined ? { state: 'ok' } : { state: 'needs-sign-in', reason }
      },
      clear: (route, account) => { signIn.delete(`${route}/${account ?? ''}`) },
      markNeedsSignIn: (route, account, reason) => { signIn.set(`${route}/${account}`, reason) },
      onChange: (cb) => {
        healthCbs.push(cb)
        return () => {}
      },
    },
    sticky: { get: key => key === 's1|openai-codex' ? 'abcdef0123' : undefined },
    models: () => ({ getAuth: () => Promise.resolve({ auth: { apiKey: jwt({ 'https://api.openai.com/auth': { chatgpt_account_id: 'acct' } }) } }) }) as never,
    onObservation: () => () => {},
    onLimited: (cb) => {
      limitedCbs.push(cb)
      return () => {}
    },
    applyResetHint: (route, account, at) => { resetHints.push([route, account, at]) },
    attachUsage: () => () => {},
  }
  const fetch: FetchFn = fetchFn ?? ((url) => {
    fetches.push(url)
    return Promise.resolve(new Response(JSON.stringify({
      rate_limit: { primary_window: { used_percent: 100, limit_window_seconds: 18_000, reset_at: 4_000_000_000 } },
    }), { status: 200 }))
  })
  await ctx.plugin(LlmAccountsRemote, { ...runtime, fetch })
  return {
    ctx,
    remote: ctx.llmAccounts,
    settings,
    mutations,
    fetches,
    limited: (route, account) => { for (const cb of limitedCbs) cb(route, account, 'RATE_LIMIT') },
    healthChanged: () => { for (const cb of healthCbs) cb() },
    resetHints,
    credentialsFile,
  }
}

async function storeGrant(ctx: Context, route: string, account: string, payload: Record<string, unknown> = {}): Promise<void> {
  await ctx.credentials.modifyRecord(recordKeyFor(route, account), () => Promise.resolve({
    kind: 'grant',
    payload: { type: 'oauth', access: jwt({ email: `${account}@example.com` }), refresh: 'rt', expires: 1, ...payload },
  }))
}

/** Run a mocked pi-ai login that commits through the attempt's own store. */
function grantOnLogin(extra?: (options: LoginOptions | undefined) => Record<string, unknown>): void {
  login.mockImplementation(async (providerId, _type, _interaction, options, store) => {
    const granted = { type: 'oauth', access: 'at', refresh: 'rt', expires: 1, ...extra?.(options) } as Credential
    await store.modify(providerId, () => Promise.resolve(granted))
    return granted
  })
}

/** The next streamed value, or undefined once the stream ends. */
async function nextValue<T>(stream: AsyncIterator<T>): Promise<T | undefined> {
  const result = await stream.next()
  return result.done === true ? undefined : result.value
}

async function settled(remote: Harness['remote'], id: Parameters<Harness['remote']['watchSignIn']>[0]): Promise<string> {
  let phase = 'running'
  for await (const view of remote.watchSignIn(id, new AbortController().signal)) phase = view.phase
  return phase
}

describe('llmAccounts list/watch', () => {
  it('lists accounts with identity, defaults and serving account without any network', async () => {
    const h = await harness()
    await storeGrant(h.ctx, 'openai-codex', 'main')
    await storeGrant(h.ctx, 'openai-codex', 'abcdef0123')
    h.settings.providers['openai-codex'] = { defaultAccount: 'main', accounts: { abcdef0123: { alias: 'Work' } } }
    const snapshot = await h.remote.list('openai-codex')
    expect(h.fetches).toHaveLength(0)
    const [codex] = snapshot.providers
    expect(codex?.displayName).toBe('OPENAI-CODEX')
    expect(codex?.oauth?.label).toBeDefined()
    expect(codex?.accounts.map(account => [account.id, account.label, account.isDefault, account.removable])).toEqual([
      ['main', 'main@example.com', true, true],
      ['abcdef0123', 'Work', false, true],
    ])
    const watched = h.remote.watch({ usage: false, sessionId: 's1' }, new AbortController().signal)[Symbol.asyncIterator]()
    const watchedFirst = await nextValue(watched)
    expect(watchedFirst?.providers.find((p: ProviderAccountsView) => p.provider === 'openai-codex')?.serving).toBe('abcdef0123')
    await watched.return?.()
    expect(h.fetches).toHaveLength(0)
  })

  it('re-emits on record, settings and health changes, coalescing bursts', async () => {
    const h = await harness()
    const controller = new AbortController()
    const stream = h.remote.watch({ usage: false }, controller.signal)[Symbol.asyncIterator]()
    const first = await nextValue(stream)
    await storeGrant(h.ctx, 'anthropic', 'main')
    h.healthChanged()
    h.ctx.emit('settings/document-updated', 'llm-pi-ai' as never, 2)
    const second = await nextValue(stream)
    expect(second?.revision).toBeGreaterThan(first?.revision ?? 0)
    expect(second?.providers.find((p: ProviderAccountsView) => p.provider === 'anthropic')?.accounts[0]?.id).toBe('main')
    controller.abort()
    expect((await stream.next()).done).toBe(true)
  })
})

describe('llmAccounts metadata writes', () => {
  it('updateAccount writes only providers.<route>.accounts.<id>', async () => {
    const h = await harness()
    await storeGrant(h.ctx, 'anthropic', 'main')
    const view = await h.remote.updateAccount('anthropic', 'main', { alias: '  Personal ', pooled: false, models: ['a', 'a', 'b'], order: null })
    expect(view).toMatchObject({ alias: 'Personal', pooled: false, models: ['a', 'b'] })
    for (const op of h.mutations.flat()) expect(op.path.slice(0, 4)).toEqual(['providers', 'anthropic', 'accounts', 'main'])
    await expect(h.remote.updateAccount('anthropic', 'main', { alias: 'x'.repeat(81) })).rejects.toMatchObject({ code: 'llm-accounts/settings-rejected' })
  })

  it('setDefaultAccount rejects an unknown account', async () => {
    const h = await harness()
    await storeGrant(h.ctx, 'anthropic', 'main')
    await expect(h.remote.setDefaultAccount('anthropic', 'zzzzzzzz00')).rejects.toMatchObject({ code: 'llm-accounts/unknown-account' })
    await h.remote.setDefaultAccount('anthropic', 'main')
    expect(h.settings.providers.anthropic?.defaultAccount).toBe('main')
  })

  it('removeAccount refuses env/ambient and deletes record, metadata and default', async () => {
    const h = await harness()
    await expect(h.remote.removeAccount('anthropic', 'ambient')).rejects.toMatchObject({ code: 'llm-accounts/not-removable' })
    await expect(h.remote.removeAccount('anthropic', 'env')).rejects.toMatchObject({ code: 'llm-accounts/not-removable' })
    await storeGrant(h.ctx, 'anthropic', 'abcdef0123')
    h.settings.providers.anthropic = { defaultAccount: 'abcdef0123', accounts: { abcdef0123: { alias: 'x' } } }
    await h.remote.removeAccount('anthropic', 'abcdef0123')
    expect(await h.ctx.credentials.readRecord(recordKeyFor('anthropic', 'abcdef0123'))).toBeUndefined()
    expect(h.settings.providers.anthropic).toEqual({ accounts: {} })
  })

  it('addApiKeyAccount validates, checks, stores the key once, and makes the first account default', async () => {
    const h = await harness()
    await expect(h.remote.addApiKeyAccount('anthropic', { key: '   ' })).rejects.toMatchObject({ code: 'llm-accounts/invalid-key' })
    const { account: view, check } = await h.remote.addApiKeyAccount('anthropic', { key: ' sk-test ', alias: 'CI' })
    expect(check).toEqual({ status: 'verified' })
    expect(view).toMatchObject({ kind: 'api-key', alias: 'CI', isDefault: true })
    expect(JSON.stringify(view)).not.toContain('sk-test')
    expect(await h.ctx.credentials.readRecord(recordKeyFor('anthropic', view.id))).toEqual({ kind: 'api-key', key: 'sk-test' })
  })
})

/** A provider double for the key check: answers every request with `reply`, recording URL and headers. */
function keyServer(reply: () => Promise<Response>): { fetch: FetchFn; requests: Array<{ url: string; headers: Headers }> } {
  const requests: Array<{ url: string; headers: Headers }> = []
  return {
    requests,
    fetch: (url, init) => {
      requests.push({ url, headers: new Headers(init.headers) })
      return reply()
    },
  }
}

describe('llmAccounts API key check', () => {
  it('refuses a key the provider rejects (401) and stores nothing', async () => {
    const server = keyServer(() => Promise.resolve(new Response('{"error":"invalid x-api-key"}', { status: 401 })))
    const h = await harness(server.fetch)

    const failure = h.remote.addApiKeyAccount('anthropic', { key: 'sk-ant-wrong' })

    await expect(failure).rejects.toMatchObject({
      code: 'llm-accounts/key-rejected',
      message: 'ANTHROPIC rejected this API key.',
      details: { provider: 'anthropic', status: 401 },
    })
    expect(server.requests.map(request => request.url)).toEqual(['https://api.anthropic.com/v1/models?limit=1000'])
    expect(server.requests[0]?.headers.get('x-api-key')).toBe('sk-ant-wrong')
    expect(await h.ctx.credentials.listRecords()).toEqual([])
    expect(h.mutations).toEqual([])
  })

  it('stores a key the check cannot judge, unverified, saying why', async () => {
    const cases: Array<[() => Promise<Response>, string]> = [
      [() => Promise.reject(new TypeError('fetch failed')), 'unreachable'],
      [() => Promise.resolve(new Response('upstream down', { status: 503 })), 'unreachable'],
      [() => Promise.resolve(new Response('{}', { status: 404 })), 'unexpected'],
      [() => Promise.resolve(new Response('<html>portal</html>', { status: 200 })), 'unexpected'],
    ]
    for (const [reply, reason] of cases) {
      const h = await harness(keyServer(reply).fetch)
      const { account, check } = await h.remote.addApiKeyAccount('anthropic', { key: 'sk-ant-maybe' })
      expect(check).toEqual({ status: 'unverified', reason })
      expect(await h.ctx.credentials.readRecord(recordKeyFor('anthropic', account.id))).toEqual({ kind: 'api-key', key: 'sk-ant-maybe' })
    }
  })

  it('asks OpenRouter its key endpoint, since its model listing is public', async () => {
    const server = keyServer(() => Promise.resolve(new Response('{"data":{"label":"k"}}', { status: 200 })))
    const h = await harness(server.fetch)

    expect((await h.remote.addApiKeyAccount('openrouter', { key: 'sk-or-test' })).check).toEqual({ status: 'verified' })
    expect(server.requests.map(request => request.url)).toEqual(['https://openrouter.ai/api/v1/key'])
    expect(server.requests[0]?.headers.get('authorization')).toBe('Bearer sk-or-test')
  })

  it('retry re-tests a key: rejected keeps it marked, accepted clears it, sign-ins are just cleared', async () => {
    let status = 200
    const h = await harness(keyServer(() => Promise.resolve(new Response('{"data":[]}', { status }))).fetch)
    const { account } = await h.remote.addApiKeyAccount('anthropic', { key: 'sk-ant-key' })

    status = 401
    expect(await h.remote.retryAccountNow('anthropic', account.id)).toEqual({ status: 'rejected' })
    expect((await h.remote.list('anthropic')).providers[0]?.accounts[0]?.health).toEqual({ state: 'needs-sign-in', reason: 'INVALID_CREDENTIAL' })

    status = 503
    expect(await h.remote.retryAccountNow('anthropic', account.id)).toEqual({ status: 'unverified', reason: 'unreachable' })
    expect((await h.remote.list('anthropic')).providers[0]?.accounts[0]?.health).toEqual({ state: 'ok' })

    status = 200
    expect(await h.remote.retryAccountNow('anthropic', account.id)).toEqual({ status: 'verified' })

    await storeGrant(h.ctx, 'openai-codex', 'main')
    expect(await h.remote.retryAccountNow('openai-codex', 'main')).toEqual({ status: 'cleared' })
  })

  it('labels accounts by alias, sign-in email, or position, never by id', async () => {
    const h = await harness()
    await storeGrant(h.ctx, 'openai-codex', 'abcdef0123')
    await h.ctx.credentials.modifyRecord(recordKeyFor('openai-codex', 'b8741dd314'), () => Promise.resolve({ kind: 'api-key', key: 'k' }))
    await h.ctx.credentials.modifyRecord(recordKeyFor('openai-codex', 'c0ffee1234'), () => Promise.resolve({ kind: 'api-key', key: 'k' }))
    h.settings.providers['openai-codex'] = { accounts: { c0ffee1234: { alias: 'Work key' } } }

    const labels = (await h.remote.list('openai-codex')).providers[0]?.accounts.map(account => account.label)

    expect(labels).toEqual(['abcdef0123@example.com', 'Account 2', 'Work key'])
  })
})

describe('llmAccounts usage', () => {
  it('fetches only for usage subscribers, and once after a limit event', async () => {
    const h = await harness()
    await storeGrant(h.ctx, 'openai-codex', 'main')
    await h.remote.list()
    const quiet = h.remote.watch({ usage: false }, new AbortController().signal)[Symbol.asyncIterator]()
    await quiet.next()
    await new Promise(resolve => setTimeout(resolve, 10))
    expect(h.fetches).toHaveLength(0)
    await quiet.return?.()

    h.limited('openai-codex', 'main')
    h.limited('openai-codex', 'main')
    await vi.waitFor(() => { expect(h.resetHints).toEqual([['openai-codex', 'main', 4_000_000_000_000]]) })
    expect(h.fetches).toHaveLength(1)

    const watching = new AbortController()
    const stream = h.remote.watch({ usage: true }, watching.signal)[Symbol.asyncIterator]()
    await stream.next()
    // The post-limit snapshot was expired, then refreshed: fresh now, so no second call.
    await new Promise(resolve => setTimeout(resolve, 10))
    expect(h.fetches).toHaveLength(1)
    watching.abort()
  })

  it('a forced refresh respects the failure cooldown; non-endpoint accounts never fetch', async () => {
    let calls = 0
    const h = await harness(() => {
      calls += 1
      return Promise.resolve(new Response('{}', { status: 429, headers: { 'retry-after': '600' } }))
    })
    await storeGrant(h.ctx, 'openai-codex', 'main')
    const signal = new AbortController().signal
    expect(await h.remote.usage('openai-codex', 'main', { force: true }, signal)).toMatchObject({ refreshFailed: true })
    await h.remote.usage('openai-codex', 'main', { force: true }, signal)
    expect(calls).toBe(1)
    await h.ctx.credentials.modifyRecord(recordKeyFor('anthropic', 'abcdef0123'), () => Promise.resolve({ kind: 'api-key', key: 'k' }))
    expect(await h.remote.usage('anthropic', 'abcdef0123', {}, signal)).toEqual({ supported: false, source: 'headers', windows: [] })
    expect(calls).toBe(1)
  })
})

describe('llmAccounts local probe', () => {
  it('probes only when asked, through the Remote fetch seam, and only the loopback listing URLs', async () => {
    const urls: string[] = []
    const h = await harness((url) => {
      urls.push(url)
      return Promise.resolve(url.includes(':11434/')
        ? new Response(JSON.stringify({ models: [{ name: 'llama3.2:latest' }] }), { status: 200 })
        : new Response('', { status: 404 }))
    })
    expect(urls).toEqual([])
    const views = await h.remote.probeLocalProviders(new AbortController().signal)
    expect(urls.sort()).toEqual(['http://localhost:11434/api/tags', 'http://localhost:1234/v1/models'])
    expect(views).toEqual([
      { id: 'ollama', displayName: 'Ollama', baseURL: 'http://localhost:11434/v1', running: true, models: ['llama3.2:latest'] },
      { id: 'lmstudio', displayName: 'LM Studio', baseURL: 'http://localhost:1234/v1', running: false, models: [] },
    ])
    // Nothing is stored: settings stay untouched.
    expect(h.mutations).toEqual([])
  })
})

describe('llmAccounts sign-in', () => {
  it('registers a flow per attempt, records metadata, and leaves no flow behind', async () => {
    const h = await harness()
    grantOnLogin()
    expect(h.ctx.authorization.list()).toEqual([])
    const view = await h.remote.beginSignIn('anthropic', { method: 'oauth', alias: 'Personal' })
    expect(h.ctx.authorization.list().map(entry => entry.key)).toEqual([recordKeyFor('anthropic', view.accountId)])
    expect(await settled(h.remote, view.id)).toBe('authorized')
    expect(h.ctx.authorization.list()).toEqual([])
    expect(h.settings.providers.anthropic).toMatchObject({ defaultAccount: view.accountId, accounts: { [view.accountId]: { alias: 'Personal' } } })
  })

  it('openai sign-in gets a per-account device id stored only in that record', async () => {
    const h = await harness()
    const seen: string[] = []
    grantOnLogin((options) => {
      const id = options?.getDeviceId?.() ?? 'missing'
      seen.push(id)
      return {}
    })
    const first = await h.remote.beginSignIn('openai', { method: 'oauth' })
    expect(await settled(h.remote, first.id)).toBe('authorized')
    const second = await h.remote.beginSignIn('openai', { method: 'oauth' })
    expect(await settled(h.remote, second.id)).toBe('authorized')
    const again = await h.remote.beginSignIn('openai', { method: 'oauth', accountId: first.accountId })
    expect(await settled(h.remote, again.id)).toBe('authorized')
    expect(seen[0]).toMatch(/^[0-9a-f-]{36}$/)
    expect(seen[1]).not.toBe(seen[0])
    expect(seen[2]).toBe(seen[0])
    const yaml = await readFile(h.credentialsFile, 'utf8')
    expect(yaml.split(seen[0] ?? '').length - 1).toBe(1)
    expect(JSON.stringify(h.settings)).not.toContain(seen[0])
    await h.remote.removeAccount('openai', first.accountId)
    expect(await readFile(h.credentialsFile, 'utf8')).not.toContain(seen[0])
  })

  it('refuses a second attempt on the 1455 callback family and round-trips manual_code prompts', async () => {
    const h = await harness()
    const { promise: answered, resolve } = Promise.withResolvers<string>()
    login.mockImplementation(async (providerId, _type, interaction, _options, store) => {
      resolve(await interaction.prompt({ type: 'manual_code', message: 'Paste the callback URL' }))
      const granted = { type: 'oauth', access: 'at', refresh: 'rt', expires: 1 } as Credential
      await store.modify(providerId, () => Promise.resolve(granted))
      return granted
    })
    const view = await h.remote.beginSignIn('openai-codex', { method: 'oauth' })
    await expect(h.remote.beginSignIn('openai', { method: 'oauth' })).rejects.toMatchObject({ code: 'llm-accounts/attempt-busy' })
    const stream = h.remote.watchSignIn(view.id, new AbortController().signal)[Symbol.asyncIterator]()
    let current = await nextValue(stream)
    while (current?.prompt === undefined) current = await nextValue(stream)
    const prompt = current.prompt
    expect(prompt).toMatchObject({ kind: 'manual_code', message: 'Paste the callback URL' })
    await h.remote.answerSignInPrompt(view.id, prompt.id, { value: 'http://127.0.0.1:1455/cb?code=x' })
    expect(await answered).toBe('http://127.0.0.1:1455/cb?code=x')
    for (let next = await stream.next(); !next.done; next = await stream.next()) current = next.value
    expect(current?.phase).toBe('authorized')
  })

  it('cancel withdraws and a failed new-account attempt leaves no record', async () => {
    const h = await harness()
    login.mockImplementation((_id: string, _type: AuthType, interaction: AuthInteraction) => interaction.prompt({ type: 'text', message: 'code?' }))
    const view = await h.remote.beginSignIn('anthropic', { method: 'oauth' })
    await vi.waitFor(() => { expect(h.ctx.authorization.list()[0]?.inFlight).toBe(true) })
    await h.remote.cancelSignIn(view.id)
    expect(await settled(h.remote, view.id)).toBe('cancelled')

    login.mockImplementation(async (providerId, _type, _interaction, _options, store) => {
      await store.modify(providerId, () => Promise.resolve({ type: 'oauth', access: 'a', refresh: 'r', expires: 1 } as Credential))
      throw new Error('exchange failed')
    })
    const failing = await h.remote.beginSignIn('anthropic', { method: 'oauth' })
    expect(await settled(h.remote, failing.id)).toBe('failed')
    expect(await h.ctx.credentials.readRecord(recordKeyFor('anthropic', failing.accountId))).toBeUndefined()
    await expect(h.remote.cancelSignIn('nope' as never)).rejects.toMatchObject({ code: 'llm-accounts/attempt-unknown' })
  })

  it('rejects unsupported providers and methods', async () => {
    const h = await harness()
    await expect(h.remote.beginSignIn('no-such-route', { method: 'oauth' })).rejects.toMatchObject({ code: 'llm-accounts/unsupported' })
    void parseRecordKey
  })
})
