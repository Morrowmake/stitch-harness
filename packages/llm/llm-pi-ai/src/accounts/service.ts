/**
 * The `llmAccounts` Remote: the browser-facing surface of pi-ai multi-account
 * pools. Lists accounts (no network), streams changes, runs sign-in attempts,
 * adds API-key accounts, edits per-account metadata (the Host is the single
 * writer of `providers.<route>.accounts.*`), removes accounts, and serves
 * usage snapshots under the privacy rule: endpoint lookups happen only for
 * signed-in accounts, only while a `watch({ usage: true })` subscriber exists
 * or a caller asks, plus once after a rate-limit/quota failover.
 *
 * @module dsh-llm-pi-ai/accounts/service
 */

import type { Context } from '@deepseek-ai/cordis'
import { normalizeApiKey } from '@deepseek-ai/dsh-credentials'
import type { CredentialKey } from '@deepseek-ai/dsh-credentials'
import type { SettingsPathOp } from '@deepseek-ai/dsh-settings'
import { Remote, RemoteError, TypertRemoteService } from '@deepseek-ai/dsh-typert-protocol'
import { catalogProvider } from '../catalog.ts'
import { PROVIDER_DATA } from '../provider-data.generated.ts'
import { AMBIENT_ACCOUNT, ENV_ACCOUNT, isAccountRoute, newAccountId, parseRecordKey, recordKeyFor } from './keys.ts'
import { sessionKeyOf } from './runtime.ts'
import type { AccountRuntime, AccountsRuntime } from './runtime.ts'
import { SignInAttempts } from './signin.ts'
import type {
  AccountId, AccountPatch, AccountsSnapshot, AccountUsageView, AccountView, ProviderAccountsView,
  SignInAttemptId, SignInAttemptView, SignInRequest,
} from './types.ts'
import { accountToken, isExhaustedWindow, UsageCache, UsageCredentialError, usageFetcherFor } from './usage/index.ts'
import type { FetchFn } from './usage/index.ts'
import { jwtClaims } from './usage/http.ts'

/** Concurrent endpoint lookups while subscribers are watching. */
const USAGE_CONCURRENCY = 2
/** One post-failover usage lookup per account per this window. */
const LIMIT_DEBOUNCE_MS = 60_000
const MAX_ALIAS = 80

/** Test seams; production uses the proxy-aware global fetch and the system clock. */
export interface LlmAccountsOptions {
  fetch?: FetchFn
  now?: () => number
}

declare module '@deepseek-ai/cordis' {
  interface Context {
    /** The pi-ai account-pool Remote. */
    llmAccounts: LlmAccountsRemote
  }
}

interface Watcher {
  notify: () => void
  usage: boolean
}

/**
 * The `llmAccounts` Host Remote: lists and watches the account pools of every
 * pi-ai route, runs sign-in attempts, stores API-key accounts, edits account
 * metadata, and serves cached or freshly polled usage.
 */
export default class LlmAccountsRemote extends TypertRemoteService {
  private readonly runtime: AccountsRuntime
  private readonly usageCache: UsageCache
  private readonly signIns: SignInAttempts
  private readonly watchers = new Set<Watcher>()
  private readonly lifetime = new AbortController()
  private readonly fetchFn: FetchFn
  private readonly now: () => number
  private readonly lastLimited = new Map<string, number>()
  private readonly usageQueue: Array<() => Promise<void>> = []
  private usageActive = 0
  private usageTimer: ReturnType<typeof setInterval> | undefined
  private revision = 0

  /**
   * @param ctx - the `llm-pi-ai` plugin context.
   * @param runtime - the pool runtime; optional `fetch`/`now` are test seams.
   */
  constructor(ctx: Context, runtime: AccountsRuntime & LlmAccountsOptions) {
    super(ctx, 'llmAccounts', { namespace: 'llmAccounts' })
    this.runtime = runtime
    this.fetchFn = runtime.fetch ?? ((input, init) => fetch(input, init))
    this.now = runtime.now ?? Date.now
    this.usageCache = new UsageCache({ now: this.now, onChange: () => { this.changed() } })
    this.signIns = new SignInAttempts(ctx, {
      authorized: (route, account, created, alias) => this.recordSignIn(route, account, created, alias),
      changed: () => { this.changed() },
    })
    const disposers = [
      runtime.attachUsage(this.usageCache),
      runtime.health.onChange(() => { this.changed() }),
      runtime.onObservation((route, account, obs) => {
        this.usageCache.observe(route, account, { at: obs.at, windows: obs.windows })
      }),
      runtime.onLimited((route, account) => { this.limited(route, account) }),
      ctx.on('credentials/record-updated', (key: CredentialKey) => {
        const parsed = parseRecordKey(key)
        if (parsed === undefined) return
        this.usageCache.invalidate(parsed.route, parsed.account)
        this.runtime.directory.invalidate()
        this.changed()
      }),
      ctx.on('settings/document-updated', (ns: string) => {
        if (ns === runtime.settingsNs) this.changed()
      }),
    ]
    ctx.effect(() => () => {
      this.lifetime.abort()
      clearInterval(this.usageTimer)
      this.signIns.dispose()
      for (const dispose of disposers) dispose()
    }, 'llmAccounts')
  }

  /**
   * Every configured route's accounts (plus `provider` when it is a catalog
   * provider not configured yet). Performs no network I/O: usage is whatever
   * is cached.
   * @param provider - restrict to one route.
   * @returns the snapshot.
   */
  @Remote
  async list(provider?: string): Promise<AccountsSnapshot> {
    return this.snapshot(provider, undefined)
  }

  /**
   * Stream snapshots: the current one at once, then one per change
   * (records, settings, health, usage, sign-in attempts), coalesced. With
   * `usage: true` the subscription also keeps signed-in accounts' usage
   * fresh while it lasts.
   * @param opts - `usage` subscribes to usage refresh; `sessionId` fills `serving`.
   * @param signal - subscription lifetime.
   * @returns snapshots until the subscriber or the plugin stops.
   */
  @Remote({ mode: 'stream' })
  async* watch(opts: { usage: boolean; sessionId?: string }, signal: AbortSignal): AsyncIterable<AccountsSnapshot> {
    const ended = AbortSignal.any([signal, this.lifetime.signal])
    let wake = Promise.withResolvers<void>()
    let dirty = true
    const watcher: Watcher = {
      usage: opts.usage,
      notify: () => {
        dirty = true
        wake.resolve()
      },
    }
    this.watchers.add(watcher)
    this.syncUsageTimer()
    // A function, not the property, so the post-await re-check is not narrowed away.
    const isEnded = (): boolean => ended.aborted
    ended.addEventListener('abort', watcher.notify, { once: true })
    try {
      while (!isEnded()) {
        if (!dirty) await wake.promise
        if (isEnded()) break
        dirty = false
        wake = Promise.withResolvers<void>()
        const snapshot = await this.snapshot(undefined, opts.sessionId)
        if (opts.usage) this.pumpUsage(snapshot)
        yield snapshot
      }
    } finally {
      this.watchers.delete(watcher)
      this.syncUsageTimer()
      ended.removeEventListener('abort', watcher.notify)
    }
  }

  /**
   * Start a sign-in attempt (new account, or `req.accountId` to re-sign-in).
   * @param provider - the provider route key.
   * @param req - the sign-in method, optional alias, and account to re-sign-in.
   * @returns the attempt's first view; follow it with `watchSignIn`.
   */
  @Remote
  async beginSignIn(provider: string, req: SignInRequest): Promise<SignInAttemptView> {
    return this.signIns.begin(provider, req)
  }

  /**
   * Stream one attempt until it settles.
   * @param attemptId - the attempt to follow.
   * @param signal - subscription lifetime.
   * @returns the attempt's views, ending once it settles.
   */
  @Remote({ mode: 'stream' })
  async* watchSignIn(attemptId: SignInAttemptId, signal: AbortSignal): AsyncIterable<SignInAttemptView> {
    yield* this.signIns.watch(attemptId, AbortSignal.any([signal, this.lifetime.signal]))
  }

  /**
   * Answer or decline the attempt's pending prompt.
   * @param attemptId - the attempt whose prompt is answered.
   * @param promptId - the prompt being answered.
   * @param answer - the entered value, or `declined`.
   */
  @Remote
  answerSignInPrompt(attemptId: SignInAttemptId, promptId: string, answer: { value: string } | { declined: true }): Promise<void> {
    // The executor turns a refusal thrown by the registry into a rejection.
    return new Promise<void>((resolve) => {
      this.signIns.answer(attemptId, promptId, answer)
      resolve()
    })
  }

  /**
   * Withdraw a running attempt.
   * @param attemptId - the attempt to cancel.
   */
  @Remote
  cancelSignIn(attemptId: SignInAttemptId): Promise<void> {
    return new Promise<void>((resolve) => {
      this.signIns.cancel(attemptId)
      resolve()
    })
  }

  /**
   * Store an API key as a new account. The key crosses the wire once and is
   * never returned.
   * @param provider - the provider route key.
   * @param req - the API key and optional alias.
   * @returns the new account's view.
   * @throws {RemoteError} `llm-accounts/invalid-key`, `llm-accounts/unsupported`.
   */
  @Remote
  async addApiKeyAccount(provider: string, req: { key: string; alias?: string }): Promise<AccountView> {
    const check = normalizeApiKey(req.key)
    if (!check.ok) throw new RemoteError('llm-accounts/invalid-key', `llm-accounts: the key is ${check.reason === 'empty' ? 'empty' : 'not a valid API key'}`, {})
    if (!isAccountRoute(provider) || (catalogProvider(provider) === undefined && !this.runtime.routes().has(provider))) {
      throw new RemoteError('llm-accounts/unsupported', `llm-accounts: "${provider}" cannot hold API-key accounts`, { provider, method: 'api-key' })
    }
    const credentials = this.ctx.get('credentials')
    if (credentials === undefined) {
      throw new RemoteError('llm-accounts/unsupported', 'llm-accounts: this composition mounts no credentials service', { provider, method: 'api-key' })
    }
    const id = newAccountId()
    await credentials.modifyRecord(recordKeyFor(provider, id), () => Promise.resolve({ kind: 'api-key', key: check.value }))
    try {
      await this.recordSignIn(provider, id, true, req.alias)
    } catch (error) {
      await credentials.deleteRecord(recordKeyFor(provider, id))
      throw error
    }
    return this.requireView(provider, id)
  }

  /**
   * Edit one account's metadata (`null` clears a field).
   * @param provider - the provider route key.
   * @param account - the account to edit.
   * @param patch - the fields to set or clear.
   * @returns the updated view.
   * @throws {RemoteError} `llm-accounts/unknown-account`, `llm-accounts/settings-rejected`.
   */
  @Remote
  async updateAccount(provider: string, account: AccountId, patch: AccountPatch): Promise<AccountView> {
    await this.requireAccount(provider, account)
    const base = ['providers', provider, 'accounts', account]
    const ops: SettingsPathOp[] = []
    const field = (name: string, value: unknown): void => {
      ops.push(value === null ? { op: 'unset', path: [...base, name] } : { op: 'set', path: [...base, name], value })
    }
    if (patch.alias !== undefined) {
      const alias = patch.alias?.trim() ?? null
      if (alias !== null && alias.length > MAX_ALIAS) throw rejected(`alias exceeds ${String(MAX_ALIAS)} characters`)
      field('alias', alias === '' ? null : alias)
    }
    if (patch.pooled !== undefined) field('pooled', patch.pooled)
    if (patch.pinned !== undefined) field('pinned', patch.pinned)
    if (patch.models !== undefined) {
      if (patch.models !== null && patch.models.some(model => typeof model !== 'string' || model.length === 0)) {
        throw rejected('model ids must be non-empty strings')
      }
      field('models', patch.models === null ? null : [...new Set(patch.models)])
    }
    if (patch.order !== undefined) {
      if (patch.order !== null && !Number.isFinite(patch.order)) throw rejected('order must be a finite number')
      field('order', patch.order)
    }
    await this.mutate(ops)
    return this.requireView(provider, account)
  }

  /**
   * Make one account the route's default.
   * @param provider - the provider route key.
   * @param account - the account to make default.
   */
  @Remote
  async setDefaultAccount(provider: string, account: AccountId): Promise<void> {
    await this.requireAccount(provider, account)
    await this.mutate([{ op: 'set', path: ['providers', provider, 'defaultAccount'], value: account }])
  }

  /**
   * Delete a stored account: its credential record (and with it any device
   * id), its metadata, and its in-memory health and usage.
   * @param provider - the provider route key.
   * @param account - the stored account to remove.
   * @throws {RemoteError} `llm-accounts/not-removable` for `env`/`ambient`.
   */
  @Remote
  async removeAccount(provider: string, account: AccountId): Promise<void> {
    if (account === ENV_ACCOUNT || account === AMBIENT_ACCOUNT) {
      throw new RemoteError('llm-accounts/not-removable', `llm-accounts: account "${account}" is not stored here`, { account })
    }
    const runtime = await this.requireAccount(provider, account)
    if (runtime.recordKey !== undefined) await this.ctx.get('credentials')?.deleteRecord(runtime.recordKey)
    const ops: SettingsPathOp[] = [{ op: 'unset', path: ['providers', provider, 'accounts', account] }]
    if (runtime.isDefault) ops.push({ op: 'unset', path: ['providers', provider, 'defaultAccount'] })
    await this.mutate(ops)
    this.runtime.health.clear(provider, account)
    this.usageCache.invalidate(provider, account)
    this.lastLimited.delete(`${provider}\u0000${account}`)
    this.changed()
  }

  /**
   * One account's usage; `force` re-polls a fresh snapshot but never cuts a
   * live failure cooldown short. Accounts without a usage endpoint answer
   * their header-derived view (or `supported: false`).
   * @param provider - the provider route key.
   * @param account - the account whose usage is read.
   * @param opts - `force` re-polls the usage endpoint instead of answering a fresh cached snapshot.
   * @param signal - cancels the poll.
   * @returns the account's usage view; marked `refreshFailed` when its credential could not poll.
   */
  @Remote
  async usage(provider: string, account: AccountId, opts: { force?: boolean }, signal: AbortSignal): Promise<AccountUsageView> {
    const runtime = await this.requireAccount(provider, account)
    const fallback: AccountUsageView = { supported: false, source: 'headers', windows: [] }
    if (usageFetcherFor(provider, runtime.kind) === undefined) return this.usageCache.peek(provider, account) ?? fallback
    try {
      return await this.refreshUsage(runtime, { force: opts.force === true, signal })
        ?? { supported: true, source: 'endpoint', windows: [] }
    } catch (error) {
      if (!(error instanceof UsageCredentialError)) throw error
      return this.usageCache.peek(provider, account) ?? { supported: true, source: 'endpoint', refreshFailed: true, windows: [] }
    }
  }

  /**
   * Clear one account's cooldowns and sign-in state so the next request tries it.
   * @param provider - the provider route key.
   * @param account - the account to retry.
   */
  @Remote
  async retryAccountNow(provider: string, account: AccountId): Promise<void> {
    await this.requireAccount(provider, account)
    this.runtime.health.clear(provider, account)
  }

  private async snapshot(only: string | undefined, sessionId: string | undefined): Promise<AccountsSnapshot> {
    const routes = this.runtime.routes()
    const ids = only === undefined
      ? [...routes.keys()]
      : routes.has(only) || catalogProvider(only) !== undefined ? [only] : []
    const providers: ProviderAccountsView[] = []
    for (const route of ids) {
      const provider = catalogProvider(route)
      const oauth = provider?.auth.oauth
      const env = PROVIDER_DATA[route]?.env ?? []
      const accounts = routes.has(route) ? await this.runtime.directory.forRoute(route) : []
      this.usageCache.retain(route, new Set(accounts.map(account => account.id)))
      const views: AccountView[] = []
      for (const [index, account] of accounts.entries()) views.push(await this.view(account, index))
      const serving = sessionId === undefined ? undefined : this.runtime.sticky.get(sessionKeyOf(sessionId, route))
      providers.push({
        provider: route,
        displayName: routes.get(route)?.displayName ?? provider?.name ?? route,
        ...oauth === undefined ? {} : { oauth: { label: oauth.loginLabel ?? oauth.name } },
        // A provider whose key is one `*_API_KEY` value takes a plain key box;
        // multi-field credentials (AWS, Vertex, gateways) go through pi-ai's prompts.
        apiKey: { interactive: !env.some(name => name.endsWith('_API_KEY')) },
        accounts: views,
        ...serving === undefined ? {} : { serving },
      })
    }
    return { revision: this.revision, providers }
  }

  private async view(account: AccountRuntime, index: number): Promise<AccountView> {
    const identity = account.kind === 'oauth' && account.recordKey !== undefined ? await this.identity(account.recordKey) : undefined
    const usage = this.usageCache.peek(account.provider, account.id)
    const fallbackLabel = account.kind === 'key-ref' ? 'Environment key' : account.kind === 'ambient' ? 'Ambient credentials' : `Account ${String(index + 1)}`
    return {
      id: account.id,
      provider: account.provider,
      kind: account.kind,
      ...account.meta.alias === undefined ? {} : { alias: account.meta.alias },
      label: account.meta.alias ?? identity?.email ?? fallbackLabel,
      ...identity === undefined ? {} : { identity },
      isDefault: account.isDefault,
      pooled: account.meta.pooled,
      pinned: account.meta.pinned,
      ...account.meta.models === undefined ? {} : { models: account.meta.models },
      ...account.meta.createdAt === undefined ? {} : { createdAt: account.meta.createdAt },
      removable: account.kind === 'oauth' || account.kind === 'api-key',
      health: this.runtime.health.view(account.provider, account.id),
      ...usage === undefined ? {} : { usage },
    }
  }

  /** Display identity from the access token's claims; derived per read, never stored. */
  private async identity(key: CredentialKey): Promise<{ email?: string; plan?: string } | undefined> {
    const record = await this.ctx.get('credentials')?.readRecord(key)
    const payload = record?.kind === 'grant' ? record.payload : undefined
    const access = typeof payload === 'object' && payload !== null && 'access' in payload ? payload.access : undefined
    const claims = typeof access === 'string' ? jwtClaims(access) : undefined
    if (claims === undefined) return undefined
    const profile = claims['https://api.openai.com/profile']
    const auth = claims['https://api.openai.com/auth']
    const email = typeof claims.email === 'string' ? claims.email
      : typeof profile === 'object' && profile !== null && 'email' in profile && typeof profile.email === 'string' ? profile.email
        : undefined
    const plan = typeof auth === 'object' && auth !== null && 'chatgpt_plan_type' in auth && typeof auth.chatgpt_plan_type === 'string'
      ? auth.chatgpt_plan_type
      : undefined
    if (email === undefined && plan === undefined) return undefined
    return { ...email === undefined ? {} : { email }, ...plan === undefined ? {} : { plan } }
  }

  private async requireAccount(provider: string, account: AccountId): Promise<AccountRuntime> {
    const found = this.runtime.routes().has(provider)
      ? (await this.runtime.directory.forRoute(provider)).find(candidate => candidate.id === account)
      : undefined
    if (found === undefined) {
      throw new RemoteError('llm-accounts/unknown-account', `llm-accounts: "${provider}" has no account "${account}"`, { provider, account })
    }
    return found
  }

  private async requireView(provider: string, account: AccountId): Promise<AccountView> {
    this.runtime.directory.invalidate()
    const accounts = await this.runtime.directory.forRoute(provider)
    const index = accounts.findIndex(candidate => candidate.id === account)
    const found = accounts[index]
    if (found === undefined) {
      throw new RemoteError('llm-accounts/unknown-account', `llm-accounts: "${provider}" has no account "${account}"`, { provider, account })
    }
    return this.view(found, index)
  }

  /** Metadata for an account that just received a credential; the first stored account becomes the default. */
  private async recordSignIn(route: string, account: AccountId, created: boolean, alias: string | undefined): Promise<void> {
    const base = ['providers', route, 'accounts', account]
    const ops: SettingsPathOp[] = []
    const trimmed = alias?.trim()
    if (trimmed !== undefined && trimmed.length > 0) ops.push({ op: 'set', path: [...base, 'alias'], value: trimmed.slice(0, MAX_ALIAS) })
    if (created) {
      ops.push({ op: 'set', path: [...base, 'createdAt'], value: this.now() })
      const others = this.runtime.routes().has(route) ? await this.runtime.directory.forRoute(route) : []
      if (!others.some(other => other.id !== account && other.kind !== 'ambient')) {
        ops.push({ op: 'set', path: ['providers', route, 'defaultAccount'], value: account })
      }
    }
    this.runtime.health.clear(route, account)
    this.usageCache.invalidate(route, account)
    if (ops.length > 0) await this.mutate(ops)
  }

  private async mutate(ops: readonly SettingsPathOp[]): Promise<void> {
    if (ops.length === 0) return
    const settings = this.ctx.get('settings')
    if (settings === undefined) throw rejected('this composition mounts no settings service')
    try {
      await settings.mutate(this.runtime.settingsNs, ops)
    } catch (error) {
      throw rejected(error instanceof Error ? error.message : String(error), error)
    }
    this.runtime.directory.invalidate()
    this.changed()
  }

  private async refreshUsage(
    account: AccountRuntime,
    options: { force: boolean; signal?: AbortSignal },
  ): Promise<AccountUsageView | undefined> {
    const fetcher = usageFetcherFor(account.provider, account.kind)
    if (fetcher === undefined) return this.usageCache.peek(account.provider, account.id)
    return this.usageCache.refresh(account.provider, account.id, async (signal) => {
      const token = await accountToken(this.runtime.models(account.provider, account.id), account.provider, signal)
      return fetcher({ token }, this.fetchFn, signal)
    }, options)
  }

  /** Queue lookups for subscribed accounts whose snapshot is stale (bounded concurrency). */
  private pumpUsage(snapshot: AccountsSnapshot): void {
    for (const provider of snapshot.providers) {
      for (const account of provider.accounts) {
        if (usageFetcherFor(provider.provider, account.kind) === undefined) continue
        if (this.usageCache.settled(provider.provider, account.id)) continue
        this.enqueueUsage(provider.provider, account.id, false)
      }
    }
  }

  private enqueueUsage(route: string, account: AccountId, afterLimit: boolean): void {
    this.usageQueue.push(async () => {
      const runtime = (await this.runtime.directory.forRoute(route)).find(candidate => candidate.id === account)
      if (runtime === undefined || (!afterLimit && this.usageCache.settled(route, account))) return
      const view = await this.refreshUsage(runtime, { force: false, signal: this.lifetime.signal })
      if (!afterLimit || view === undefined) return
      const now = this.now()
      const resets = view.windows.filter(window => isExhaustedWindow(window, now)).map(window => window.resetsAt ?? now)
      const credits = view.credits
      const spendable = credits !== undefined && (credits.unlimited || credits.hasCredits) && credits.overageLimitReached !== true
      if (resets.length > 0 && !spendable) this.runtime.applyResetHint(route, account, Math.max(...resets))
    })
    this.drainUsage()
  }

  private drainUsage(): void {
    while (this.usageActive < USAGE_CONCURRENCY && !this.lifetime.signal.aborted) {
      const job = this.usageQueue.shift()
      if (job === undefined) return
      this.usageActive += 1
      void job().catch((error: unknown) => {
        this.ctx.logger.debug('llm-pi-ai: usage lookup failed: %s', error instanceof Error ? error.message : String(error))
      }).finally(() => {
        this.usageActive -= 1
        this.drainUsage()
      })
    }
  }

  /** After a rate-limit/quota failover: one lookup (debounced) to learn the real reset. */
  private limited(route: string, account: AccountId): void {
    const key = `${route}\u0000${account}`
    const now = this.now()
    const last = this.lastLimited.get(key)
    if (last !== undefined && now - last < LIMIT_DEBOUNCE_MS) return
    this.lastLimited.set(key, now)
    this.usageCache.expire(route, account)
    this.enqueueUsage(route, account, true)
  }

  /** Re-poll stale snapshots on a TTL timer only while a usage subscriber exists. */
  private syncUsageTimer(): void {
    const subscribed = [...this.watchers].some(watcher => watcher.usage)
    if (subscribed && this.usageTimer === undefined) {
      this.usageTimer = setInterval(() => { this.changed() }, 60_000)
      this.usageTimer.unref()
    } else if (!subscribed && this.usageTimer !== undefined) {
      clearInterval(this.usageTimer)
      this.usageTimer = undefined
    }
  }

  private changed(): void {
    this.revision += 1
    for (const watcher of this.watchers) watcher.notify()
  }
}

function rejected(message: string, cause?: unknown): RemoteError<'llm-accounts/settings-rejected'> {
  return new RemoteError('llm-accounts/settings-rejected', `llm-accounts: ${message}`, {}, cause === undefined ? undefined : { cause })
}
