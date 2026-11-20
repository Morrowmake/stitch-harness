/**
 * Built-artifact boundary check for the `llmAccounts` Remote: every method is
 * called through the real Typert Gateway with the generated strict codecs of
 * `lib/typert.host.js`, so an argument the Host hands out (a sign-in attempt
 * id, an account id) must survive the wire-field validation the browser's
 * calls cross, and every result must satisfy its generated result codec.
 * The in-process harness of `accounts-service.spec.ts` calls the methods
 * directly and cannot see either boundary.
 */

import { existsSync } from 'node:fs'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import AuthorizationService from '@deepseek-ai/dsh-authorization'
import LocalCredentialProvider from '@deepseek-ai/dsh-credentials-local'
import TypertGatewayService from '@deepseek-ai/dsh-api-gateway'
import RemoteAccessService from '@deepseek-ai/dsh-api-remote-access'
import { Peer } from '@deepseek-ai/dsh-client-connection'
import type { PeerScope } from '@deepseek-ai/dsh-typert-protocol'
import TypertRegistry, { type TypertContribution } from '@deepseek-ai/dsh-typert-registry'
import type { AuthInteraction, AuthType, Credential } from '@earendil-works/pi-ai'
import type { SettingsPathOp } from '@deepseek-ai/dsh-settings'
import type { AccountRuntime, AccountsRuntime } from '../src/accounts/runtime.ts'
import type { AccountView, SignInAttemptView } from '../src/accounts/types.ts'

type CredentialStore = { modify: (id: string, mutate: () => Promise<Credential>) => Promise<unknown> }
type LoginMock = (providerId: string, type: AuthType, interaction: AuthInteraction, store: CredentialStore) => Promise<unknown>

const login = vi.hoisted(() => vi.fn<LoginMock>())

// A real login opens a browser; the fake provider prompts like pi-ai's and commits through the attempt's store.
vi.mock('../src/models.ts', async importOriginal => ({
  ...await importOriginal<typeof import('../src/models.ts')>(),
  createModels: (options: { credentials: CredentialStore }) => ({
    setProvider: () => {},
    login: (providerId: string, type: AuthType, interaction: AuthInteraction) => login(providerId, type, interaction, options.credentials),
  }),
}))

const { default: LlmAccountsRemote } = await import('../src/accounts/service.ts')
const { parseRecordKey } = await import('../src/accounts/keys.ts')

const artifact = join(fileURLToPath(new URL('..', import.meta.url)), 'lib/typert.host.js')

interface Codec { create(): { parse(value: unknown): unknown } }
interface BuiltInvocation {
  readonly service: string
  readonly method: string
  readonly result: Codec | { readonly spec: Codec }
}

const dirs: string[] = []

afterEach(async () => {
  login.mockReset()
  await Promise.all(dirs.splice(0).map(dir => rm(dir, { recursive: true, force: true })))
})

async function gateway() {
  // The built artifact path is resolved at run time: the suite skips when the package is not built.
  const { TYPERT } = await import(pathToFileURL(artifact).href) as { TYPERT: TypertContribution }
  const invocations = TYPERT.invocations as readonly unknown[] as readonly BuiltInvocation[]
  const dir = await mkdtemp(join(tmpdir(), 'dsh-pi-accounts-gateway-'))
  dirs.push(dir)
  const ctx = new Context()
  await ctx.plugin(TypertRegistry)
  await ctx.plugin(RemoteAccessService)
  await ctx.plugin(TypertGatewayService)
  ctx.typert.register(TYPERT)
  await ctx.plugin(LocalCredentialProvider, { path: join(dir, '.credentials.yaml'), watch: false })
  await ctx.plugin(AuthorizationService)
  const settings: Record<string, unknown> = { providers: { anthropic: {} } }
  ctx.provide('settings', {
    mutate: (_ns: string, ops: readonly SettingsPathOp[]) => {
      for (const op of ops) {
        const parent = op.path.slice(0, -1).reduce<Record<string, unknown>>((node, key) => {
          node[key] ??= {}
          return node[key] as Record<string, unknown>
        }, settings)
        if (op.op === 'set') parent[op.path.at(-1) as string] = op.value
        else Reflect.deleteProperty(parent, op.path.at(-1) as string)
      }
      return Promise.resolve()
    },
  } as never)
  const runtime: AccountsRuntime = {
    settingsNs: 'llm-pi-ai',
    routes: () => new Map([['anthropic', { displayName: 'Anthropic' }]]),
    directory: {
      async forRoute(route) {
        const accounts: AccountRuntime[] = []
        for (const record of await ctx.credentials.listRecords()) {
          const parsed = parseRecordKey(record.key)
          if (parsed?.route !== route) continue
          accounts.push({
            provider: route,
            id: parsed.account,
            kind: record.kind === 'grant' ? 'oauth' : 'api-key',
            meta: { pooled: true, pinned: false },
            recordKey: record.key,
            isDefault: false,
          })
        }
        return accounts
      },
      invalidate: () => {},
    },
    health: { view: () => ({ state: 'ok' }), clear: () => {}, onChange: () => () => {} },
    sticky: { get: () => undefined },
    models: () => ({ getAuth: () => Promise.resolve(undefined) }) as never,
    onObservation: () => () => {},
    onLimited: () => () => {},
    applyResetHint: () => {},
    attachUsage: () => () => {},
  }
  // Usage polls and local-server probes answer "nothing there" without leaving the process.
  await ctx.plugin(LlmAccountsRemote, { ...runtime, fetch: () => Promise.resolve(new Response('', { status: 404 })) })

  const peer: PeerScope = new Peer(ctx[Context.root], { principal: { kind: 'owner' } })
  const resultCodec = (method: string): Codec => {
    const invocation = invocations.find(candidate => candidate.service === 'llmAccounts' && candidate.method === method)
    if (invocation === undefined) throw new Error(`no generated llmAccounts.${method} invocation`)
    return 'spec' in invocation.result ? invocation.result.spec : invocation.result
  }
  /** One unary call through the Gateway; a result must satisfy its generated codec. */
  const call = async <T>(method: string, args: Record<string, unknown>): Promise<T> => {
    const value = await ctx.typertGateway.invoke({ peer, namespace: 'llmAccounts', method, args })
    if (value !== undefined) resultCodec(method).create().parse(value)
    return value as T
  }
  /** One stream opened through the Gateway; every item must satisfy its generated codec. */
  async function* stream<T>(method: string, args: Record<string, unknown>): AsyncIterable<T> {
    for await (const value of await ctx.typertGateway.stream({ peer, namespace: 'llmAccounts', method, args })) {
      resultCodec(method).create().parse(value)
      yield value as T
    }
  }
  return { call, stream }
}

describe.skipIf(!existsSync(artifact))('llmAccounts through the Typert Gateway', () => {
  it('passes Host-issued sign-in attempt ids back through watch, answer, and cancel', async () => {
    const { call, stream } = await gateway()
    login.mockImplementation(async (providerId, _type, interaction, store) => {
      await interaction.prompt({ type: 'manual_code', message: 'Paste the authorization code' })
      const granted = { type: 'oauth', access: 'at', refresh: 'rt', expires: 1 } as Credential
      await store.modify(providerId, () => Promise.resolve(granted))
      return granted
    })
    const begun = await call<SignInAttemptView>('beginSignIn', { provider: 'anthropic', req: { method: 'oauth', alias: 'Personal' } })
    let last: SignInAttemptView | undefined
    for await (const view of stream<SignInAttemptView>('watchSignIn', { attemptId: begun.id })) {
      last = view
      if (view.prompt !== undefined) await call('answerSignInPrompt', { attemptId: begun.id, promptId: view.prompt.id, answer: { value: 'code#state' } })
    }
    expect(last).toMatchObject({ id: begun.id, phase: 'authorized' })

    login.mockImplementation((_id, _type, interaction) => interaction.prompt({ type: 'text', message: 'code?' }))
    const pending = await call<SignInAttemptView>('beginSignIn', { provider: 'anthropic', req: { method: 'oauth' } })
    const watched = stream<SignInAttemptView>('watchSignIn', { attemptId: pending.id })[Symbol.asyncIterator]()
    let view = (await watched.next()).value as SignInAttemptView
    while (view.prompt === undefined) view = (await watched.next()).value as SignInAttemptView
    await call('cancelSignIn', { attemptId: pending.id })
    for (let next = await watched.next(); next.done !== true; next = await watched.next()) view = next.value
    expect(view.phase).toBe('cancelled')
  })

  it('passes account ids and options of every other method through the generated codecs', async () => {
    const { call, stream } = await gateway()
    const account = await call<AccountView>('addApiKeyAccount', { provider: 'anthropic', req: { key: 'sk-ant-api03-gateway-fixture', alias: 'Key' } })
    await call('updateAccount', { provider: 'anthropic', account: account.id, patch: { alias: 'Renamed', pinned: true, models: null } })
    await call('setDefaultAccount', { provider: 'anthropic', account: account.id })
    await call('retryAccountNow', { provider: 'anthropic', account: account.id })
    await call('usage', { provider: 'anthropic', account: account.id, opts: { force: true } })
    await call('list', { provider: 'anthropic' })
    const watched = stream('watch', { opts: { usage: false } })[Symbol.asyncIterator]()
    expect((await watched.next()).done).toBe(false)
    await watched.return?.()
    await call('probeLocalProviders', {})
    await call('removeAccount', { provider: 'anthropic', account: account.id })
  })
})
