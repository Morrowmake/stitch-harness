/**
 * The account pool and the router that wraps every attempt (design §4.3):
 * pick candidates, attempt each until one produces content, fail over only
 * before the first content chunk, never sleep, and build the exhausted error
 * `llm-retry` sees when every account is limited.
 *
 * Portions derived from dsh-plugin-subscriptions
 * (https://github.com/V1ki/dsh-plugin-subscriptions), Copyright (c) 2026 V1ki,
 * MIT License.
 *
 * @module dsh-llm-pi-ai/accounts/router
 */

import { LlmError } from '@deepseek-ai/dsh-llm'
import type { LlmFailure, StreamChunk } from '@deepseek-ai/dsh-llm'
import { classify, REFRESH_FAILURE_CODE } from './classify.ts'
import type { Verdict } from './classify.ts'
import type { ObservationSink } from './capture.ts'
import { AccountHealthRegistry } from './health.ts'
import { accountDisplayLabel } from './label.ts'
import { waitFromReset } from './ratelimit.ts'
import type { AccountDirectory, AccountRuntime, Observation, UsagePeek } from './runtime.ts'
import { sessionKeyOf } from './runtime.ts'
import { select, StickyMap } from './scheduler.ts'
import { PINNED_MODEL_PREFIX } from './types.ts'
import type { AccountId, CoolingReason } from './types.ts'

/** A same-account forced refresh is not repeated within this window. */
const REFRESH_DEBOUNCE_MS = 30_000

/**
 * `~acct:<accountId>:<modelId>` → parts; `undefined` for an ordinary model id.
 * @param model - the requested model id.
 * @returns the pinned account and provider model id, or `undefined` when the id is not pinned.
 */
export function parsePinnedModelId(model: string): { account: AccountId; model: string } | undefined {
  if (!model.startsWith(PINNED_MODEL_PREFIX)) return undefined
  const rest = model.slice(PINNED_MODEL_PREFIX.length)
  const at = rest.indexOf(':')
  if (at <= 0 || at === rest.length - 1) return undefined
  return { account: rest.slice(0, at), model: rest.slice(at + 1) }
}

/**
 * The pinned model id `~acct:<accountId>:<modelId>` that binds a request to one account.
 * @param account - the account the entry pins.
 * @param model - the provider model id.
 * @returns the pinned model id.
 */
export function pinnedModelId(account: AccountId, model: string): string {
  return `${PINNED_MODEL_PREFIX}${account}:${model}`
}

/** What one attempt's response capture saw; the router reads `last` after a failure. */
export class AttemptObserver implements ObservationSink {
  /** The latest observation of the attempt; `undefined` until a response arrives. */
  last: Observation | undefined
  /** The OAuth access token the attempt used (memory only), so a forced refresh expires only that token. */
  credentialStamp: string | undefined

  constructor(
    private readonly onObservation: (obs: Observation) => void,
    private readonly onDiagnostic?: (detail: string) => void,
  ) {}

  observe(observation: Observation): void {
    this.last = observation
    this.onObservation(observation)
  }

  diagnose(detail: string): void {
    this.onDiagnostic?.(detail)
  }

  /**
   * The captured instant the refusing window reopens, if any.
   * @returns the reset or retry-after instant of the last non-2xx observation, or `undefined`.
   */
  hintAt(): number | undefined {
    const last = this.last
    if (last === undefined || last.ok) return undefined
    return last.resetAt ?? last.retryAfterAt
  }

  /**
   * Copy captured `status`/`providerRetryAfterMs` onto an error finish.
   * @param failure - the attempt's error finish.
   * @param now - the current instant, in epoch milliseconds.
   * @returns the failure with captured fields filled where it lacked them.
   */
  enrich(failure: LlmFailure, now: number): LlmFailure {
    const last = this.last
    if (last === undefined || last.ok) return failure
    const hint = this.hintAt()
    return {
      ...failure,
      ...failure.status === undefined ? { status: last.status } : {},
      ...failure.providerRetryAfterMs === undefined && hint !== undefined ? { providerRetryAfterMs: waitFromReset(hint, now) } : {},
    }
  }
}

/** One account attempt: the stream of an account-bound call. */
export type AttemptFn = (account: AccountRuntime, observer: AttemptObserver, signal: AbortSignal | undefined) => AsyncIterable<StreamChunk>

/** One request the pool routes across the accounts of its route. */
export interface RouteRequest {
  /** The provider route key. */
  route: string
  /** The model id as requested (possibly `~acct:` pinned). */
  model: string
  /** The Session the request serves; keys account stickiness. */
  sessionId?: string
  /** Cancels the request and its attempts. */
  signal?: AbortSignal
  /** The provider's display name for failure text; defaults to the route key. */
  providerName?: string
  /** Account display labels for failure text, resolved only when a failure needs them. */
  labels?: () => Promise<ReadonlyMap<AccountId, string>>
}

/** Names the exhausted failure uses in its text. */
export interface FailureNames {
  /** The provider's display name. */
  provider?: string
  /** Account display labels by account id. */
  labels?: ReadonlyMap<AccountId, string>
}

/** Pool state shared by every request of one plugin instance. */
export class AccountPool {
  /** Cooldown and sign-in state of every account of the pool. */
  readonly health: AccountHealthRegistry
  /** Session-to-account stickiness of the pool. */
  readonly sticky = new StickyMap()
  private usage: UsagePeek | undefined
  private readonly observationListeners = new Set<(route: string, account: AccountId, obs: Observation) => void>()
  private readonly limitedListeners = new Set<(route: string, account: AccountId, reason: 'RATE_LIMIT' | 'QUOTA') => void>()
  private readonly lastForcedRefresh = new Map<string, number>()

  constructor(
    readonly directory: AccountDirectory,
    readonly now: () => number = Date.now,
    private readonly debug?: (message: string) => void,
  ) {
    this.health = new AccountHealthRegistry(now)
  }

  /**
   * Let the scheduler peek at cached usage while ordering accounts.
   * @param usage - the usage peek to consult.
   * @returns a detach function that removes `usage` when it is still attached.
   */
  attachUsage(usage: UsagePeek): () => void {
    this.usage = usage
    return () => { if (this.usage === usage) this.usage = undefined }
  }

  /**
   * Listen to every response observation of every attempt.
   * @param cb - receives the route, account, and observation.
   * @returns an unsubscribe function.
   */
  onObservation(cb: (route: string, account: AccountId, obs: Observation) => void): () => void {
    this.observationListeners.add(cb)
    return () => { this.observationListeners.delete(cb) }
  }

  /**
   * Listen to rate-limit and quota refusals that put an account or model lane on cooldown.
   * @param cb - receives the route, account, and limit kind.
   * @returns an unsubscribe function.
   */
  onLimited(cb: (route: string, account: AccountId, reason: 'RATE_LIMIT' | 'QUOTA') => void): () => void {
    this.limitedListeners.add(cb)
    return () => { this.limitedListeners.delete(cb) }
  }

  private emit<T extends unknown[]>(listeners: Set<(...args: T) => void>, ...args: T): void {
    for (const listener of listeners) {
      try { listener(...args) } catch (error) { this.debug?.(`llm-pi-ai: account listener failed: ${String(error)}`) }
    }
  }

  /**
   * Forget health, stickiness, and refresh memory of an account (record updated/removed, sign-in).
   * @param route - the provider route key.
   * @param account - the account to forget, or undefined for every account of the route.
   */
  forget(route: string, account?: AccountId): void {
    this.health.clear(route, account)
    this.sticky.forget(route, account)
    for (const key of [...this.lastForcedRefresh.keys()]) {
      if (key === `${route}/${account}` || (account === undefined && key.startsWith(`${route}/`))) this.lastForcedRefresh.delete(key)
    }
  }

  /**
   * Candidate accounts for one request, in order. Pinned ids bind to exactly one account.
   * @param accounts - the route's accounts (directory order).
   * @param request - route, requested model, session, signal.
   * @param model - the provider model id with any pin removed.
   * @param pinned - the account a pinned model id binds to, if any.
   * @returns the available accounts in attempt order; empty when none can serve now.
   * @throws LlmError with code `NO_ADAPTER` when the pinned account is removed or unpinned.
   */
  candidates(accounts: readonly AccountRuntime[], request: RouteRequest, model: string, pinned: AccountId | undefined): AccountRuntime[] {
    if (pinned !== undefined) {
      const account = accounts.find(candidate => candidate.id === pinned)
      if (account === undefined || !account.meta.pinned) {
        throw new LlmError(
          'The account this model entry uses was removed or is no longer offered in the model picker. Pick another model.',
          'NO_ADAPTER',
          { cause: new Error(`llm-pi-ai: account "${pinned}" of provider "${request.route}" is not available for pinned model entries (removed or unpinned)`) },
        )
      }
      return this.health.isAvailable(request.route, account.id, model, this.now()) ? [account] : []
    }
    return select({
      route: request.route,
      candidates: accounts,
      modelId: model,
      ...request.sessionId === undefined ? {} : { sessionKey: sessionKeyOf(request.sessionId, request.route) },
      now: this.now(),
      available: account => this.health.isAvailable(request.route, account.id, model, this.now()),
      ...this.usage === undefined ? {} : { usage: this.usage },
      sticky: this.sticky,
    })
  }

  /** Apply a failover verdict to health and notify limit listeners. */
  private record(route: string, account: AccountRuntime, model: string, verdict: Verdict): void {
    if (verdict.action !== 'failover') return
    // Virtual accounts re-resolve their key on every request, so a missing or bad key is not remembered.
    if (verdict.signIn !== undefined && account.kind !== 'key-ref' && account.kind !== 'ambient') {
      this.health.markNeedsSignIn(route, account.id, verdict.signIn)
    }
    if (verdict.cooling !== undefined) {
      this.health.markCooling(route, account.id, verdict.cooling.scope === 'model' ? model : undefined, verdict.cooling.reason, verdict.cooling.until)
    }
    if (verdict.limited !== undefined) this.emit(this.limitedListeners, route, account.id, verdict.limited)
  }

  /**
   * Route one request across the accounts of its route.
   * @param accounts - the route's accounts (directory order).
   * @param request - route, requested model (maybe pinned), session, signal.
   * @param attempt - streams one account-bound attempt.
   * @param forceRefresh - expire and refresh an OAuth account's token under its record lock.
   * @returns the stream chunks of the first attempt that succeeds, or of a single-account route's failed attempt.
   * @throws LlmError when every candidate fails or none is available.
   */
  async * route(
    accounts: readonly AccountRuntime[],
    request: RouteRequest,
    attempt: AttemptFn,
    forceRefresh: (account: AccountRuntime, observer: AttemptObserver) => Promise<void>,
  ): AsyncGenerator<StreamChunk> {
    const pinned = parsePinnedModelId(request.model)
    const model = pinned?.model ?? request.model
    const candidates = this.candidates(accounts, request, model, pinned?.account)
    // A pinned request reports on its own account only.
    const scope = pinned === undefined ? accounts : accounts.filter(account => account.id === pinned.account)
    if (candidates.length === 0) throw this.exhausted(request.route, model, scope, undefined, await failureNames(request, accounts))
    let last: { account: AccountRuntime; error: LlmError; replay?: StreamChunk[] } | undefined
    for (const account of candidates) {
      let refreshed = (this.now() - (this.lastForcedRefresh.get(`${request.route}/${account.id}`) ?? -Infinity)) < REFRESH_DEBOUNCE_MS
      for (;;) {
        const observer = new AttemptObserver(
          (obs) => { this.emit(this.observationListeners, request.route, account.id, obs) },
          this.debug === undefined ? undefined : detail => this.debug?.(`llm-pi-ai: unparsable rate-limit refusal from "${request.route}": ${detail}`),
        )
        const iterator = attempt(account, observer, request.signal)[Symbol.asyncIterator]()
        const leading: StreamChunk[] = []
        let first: IteratorResult<StreamChunk> | undefined
        let failure: LlmError | undefined
        try {
          first = await iterator.next()
          while (!first.done && first.value.type === 'usage') {
            leading.push(first.value)
            first = await iterator.next()
          }
          if (first.done) {
            // A stream that ends with no terminal chunk: let the caller see the same outcome.
            yield* leading
            this.health.noteSuccess(request.route, account.id)
            return
          }
          if (first.value.type === 'finish' && first.value.reason.kind === 'error') {
            failure = LlmError.fromFailure(first.value.reason.failure)
          }
        } catch (error) {
          await iterator.return?.(undefined).catch(() => {})
          // A cancelled caller gets the attempt's own (ABORTED) failure, never a failover.
          if (request.signal?.aborted === true) throw error
          if (!(error instanceof LlmError)) throw error
          failure = error
        }
        if (failure === undefined) {
          if (request.sessionId !== undefined) this.sticky.remember(sessionKeyOf(request.sessionId, request.route), account.id)
          this.health.noteSuccess(request.route, account.id)
          try {
            yield* leading
            yield (first as IteratorYieldResult<StreamChunk>).value
            for (let next = await iterator.next(); next.done !== true; next = await iterator.next()) yield next.value
          } finally {
            await iterator.return?.(undefined).catch(() => {})
          }
          return
        }
        await iterator.return?.(undefined).catch(() => {})
        // An error finish is replayed verbatim when it reaches the caller, preserving the in-band error style.
        const replay = first !== undefined && first.done !== true && first.value.type === 'finish' ? [...leading, first.value] : undefined
        const now = this.now()
        const verdict = classify({
          code: failure.code,
          message: failureText(failure),
          ...failure.failure.status === undefined ? {} : { status: failure.failure.status },
          route: request.route,
          kind: account.kind,
          ...hintOf(observer, failure, now),
          now,
          attempt: this.health.noteFailure(request.route, account.id, model),
          refreshed,
        })
        if (verdict.action === 'throw') {
          if (replay !== undefined) {
            yield* replay
            return
          }
          throw failure
        }
        if (verdict.action === 'retry-same') {
          refreshed = true
          this.lastForcedRefresh.set(`${request.route}/${account.id}`, now)
          try {
            await forceRefresh(account, observer)
            continue
          } catch (error) {
            if (request.signal?.aborted === true) throw error
            const refreshFailure = error instanceof LlmError ? error : new LlmError(failureText(error), 'AUTH', { cause: error })
            const after = classify({
              code: refreshFailure.code, message: failureText(refreshFailure), route: request.route, kind: account.kind,
              now, attempt: 1, refreshed: true,
            })
            this.record(request.route, account, model, after.action === 'failover' ? after : { action: 'failover', signIn: 'AUTH' })
            last = { account, error: refreshFailure }
            break
          }
        }
        this.record(request.route, account, model, verdict)
        last = { account, error: failure, ...replay === undefined ? {} : { replay } }
        break
      }
    }
    if (scope.length === 1 && last !== undefined) {
      // A single-account route behaves as before: its own failure, enriched with captured hints.
      if (last.replay !== undefined) {
        yield* last.replay
        return
      }
      throw last.error
    }
    throw this.exhausted(request.route, model, scope, last, await failureNames(request, accounts))
  }

  /**
   * Every candidate failed or none is available: code = last failure's, retry-after = earliest recovery.
   * The message is plain guidance naming the provider and the accounts by
   * label (key accounts are told about their key, signed-in accounts to sign
   * in again); the per-account developer detail rides on its `cause`.
   * @param route - the provider route key.
   * @param model - the provider model id.
   * @param accounts - the accounts the request could have used.
   * @param last - the last attempted account and its error, if any attempt ran.
   * @param names - the provider name and account labels for the text.
   * @returns the error naming each unavailable account and when it recovers.
   */
  exhausted(
    route: string,
    model: string,
    accounts: readonly AccountRuntime[],
    last: { account: AccountRuntime; error: LlmError } | undefined,
    names: FailureNames = {},
  ): LlmError {
    const now = this.now()
    const details: string[] = []
    const ids: AccountId[] = []
    const problems = new Map<Problem, { labels: string[]; until?: number }>()
    const note = (problem: Problem, label: string, until?: number): void => {
      const entry = problems.get(problem) ?? { labels: [] }
      entry.labels.push(label)
      if (until !== undefined) entry.until = Math.min(entry.until ?? until, until)
      problems.set(problem, entry)
    }
    let signInOnly = accounts.length > 0
    for (const [index, account] of accounts.entries()) {
      const label = names.labels?.get(account.id) ?? accountDisplayLabel(account, index)
      const keyAccount = account.kind !== 'oauth'
      const view = this.health.view(route, account.id, model, now)
      if (view.state === 'ok') {
        // Key references and ambient credentials are never marked; their last failure speaks for them.
        if (last?.account.id === account.id) {
          const code = last.error.code
          if (code === 'AUTH' || code === 'INVALID_CREDENTIAL') note(keyAccount ? 'key-rejected' : 'sign-in', label)
          else if (code === 'MISSING_CREDENTIAL') note(keyAccount ? 'key-missing' : 'sign-in', label)
        }
        continue
      }
      ids.push(account.id)
      if (view.state === 'needs-sign-in') {
        details.push(`${account.id}: sign in again (${view.reason})`)
        note(!keyAccount ? 'sign-in' : view.reason === 'MISSING_CREDENTIAL' ? 'key-missing' : 'key-rejected', label)
      } else {
        signInOnly = false
        details.push(`${account.id}: ${view.reason}, recovers in ${formatDuration(view.until - now)}`)
        note(COOLING_PROBLEM[view.reason], label, view.until)
      }
    }
    if (ids.length === 0) signInOnly = false
    const recovery = this.health.earliestRecovery(route, ids, model, now)
    const lastCode = last?.error.code === REFRESH_FAILURE_CODE ? 'INVALID_CREDENTIAL' : last?.error.code
    const code = signInOnly ? (lastCode === 'AUTH' ? 'AUTH' : 'INVALID_CREDENTIAL') : lastCode ?? coolingCode(this.health, route, accounts, model, now)
    const provider = names.provider ?? route
    const sentences = [...problems].map(([problem, { labels, until }]) =>
      PROBLEM_TEXT[problem]({ provider, model, who: listed(labels), many: labels.length > 1, wait: formatDuration((until ?? now) - now) }))
    const message = sentences.length > 0
      ? sentences.join(' ')
      : `None of your ${provider} accounts can use ${model} right now. Check them in Settings → Models.`
    const detail = `llm-pi-ai: every account of provider "${route}" is unavailable for model "${model}"`
      + (details.length === 0 ? '' : `: ${details.join('; ')}`)
    return LlmError.fromFailure({
      message,
      code,
      ...last?.error.failure.status === undefined ? {} : { status: last.error.failure.status },
      ...recovery === undefined || recovery <= now || signInOnly ? {} : { providerRetryAfterMs: Math.max(1, recovery - now) },
      ...last?.error.failure.requestId === undefined ? {} : { requestId: last.error.failure.requestId },
    }, { cause: new Error(detail, last === undefined ? undefined : { cause: last.error }) })
  }
}

/** Why one account cannot serve, grouped so the text names each problem once. */
type Problem = 'key-rejected' | 'key-missing' | 'sign-in' | 'rate-limited' | 'quota' | 'refresh-failed' | 'model-unavailable'

/** The problem each cooldown reason states. */
const COOLING_PROBLEM: Readonly<Record<CoolingReason, Problem>> = {
  RATE_LIMIT: 'rate-limited',
  QUOTA: 'quota',
  HTTP_402: 'quota',
  HTTP_404: 'model-unavailable',
  REFRESH_FAILED: 'refresh-failed',
}

/** Inputs of one problem sentence. */
interface ProblemFacts {
  provider: string
  model: string
  /** The affected accounts' labels, joined for prose. */
  who: string
  /** Whether more than one account is affected. */
  many: boolean
  /** Time until the earliest affected account recovers. */
  wait: string
}

/** One plain sentence of guidance per problem. API-key accounts are never told to sign in. */
const PROBLEM_TEXT: Readonly<Record<Problem, (facts: ProblemFacts) => string>> = {
  'key-rejected': ({ provider, who, many }) =>
    `${provider} rejected the API ${many ? 'keys' : 'key'} for ${who}. Check or replace ${many ? 'them' : 'it'} in Settings → Models.`,
  'key-missing': ({ provider, who }) => `There is no usable ${provider} API key for ${who}. Add one in Settings → Models.`,
  'sign-in': ({ provider, who, many }) =>
    `Your ${provider} ${many ? 'sign-ins' : 'sign-in'} for ${who} ${many ? 'have' : 'has'} expired. Sign in again in Settings → Models.`,
  'rate-limited': ({ provider, who, wait }) => `${provider} is rate-limiting ${who}; try again in ${wait}.`,
  'quota': ({ provider, who, many, wait }) =>
    `${who} ${many ? 'have' : 'has'} used up ${many ? 'their' : 'its'} ${provider} quota; try again in ${wait}.`,
  'refresh-failed': ({ provider, who, wait }) => `Couldn't refresh your ${provider} sign-in for ${who}; try again in ${wait}.`,
  'model-unavailable': ({ provider, model, who, wait }) => `${provider} isn't serving ${model} to ${who} right now; try again in ${wait}.`,
}

/** `A`, `A and B`, `A, B and C`. */
function listed(labels: readonly string[]): string {
  return labels.length <= 1 ? labels.join('') : `${labels.slice(0, -1).join(', ')} and ${labels.at(-1) ?? ''}`
}

/** The request's names for failure text; labels that cannot be read fall back to directory-order defaults. */
async function failureNames(request: RouteRequest, accounts: readonly AccountRuntime[]): Promise<FailureNames> {
  const labels = await request.labels?.().catch(() => undefined)
  // Number accounts by their position in the route's full directory, as Settings does.
  const resolved = labels ?? new Map(accounts.map((account, index) => [account.id, accountDisplayLabel(account, index)]))
  return { ...request.providerName === undefined ? {} : { provider: request.providerName }, labels: resolved }
}

/** The code of the earliest-recovering cooldown, when no attempt ran. */
function coolingCode(
  health: AccountHealthRegistry,
  route: string,
  accounts: readonly AccountRuntime[],
  model: string,
  now: number,
): string {
  let best: { until: number; reason: string } | undefined
  for (const account of accounts) {
    const view = health.view(route, account.id, model, now)
    if (view.state === 'cooling' && (best === undefined || view.until < best.until)) best = view
  }
  if (best === undefined) return 'NO_ADAPTER'
  return best.reason === 'QUOTA' ? 'QUOTA' : best.reason === 'REFRESH_FAILED' ? 'AUTH' : 'RATE_LIMIT'
}

/** The provider hint for classification: captured reset first, then the failure's own retry-after. */
function hintOf(observer: AttemptObserver, failure: LlmError, now: number): { hintAt?: number } {
  const captured = observer.hintAt()
  if (captured !== undefined) return { hintAt: captured }
  const after = failure.failure.providerRetryAfterMs
  return after === undefined ? {} : { hintAt: now + after }
}

/** Error text including its cause chain (for permanent-refresh detection; never logged). */
function failureText(error: unknown): string {
  const parts: string[] = []
  let current: unknown = error
  for (let depth = 0; depth < 5 && current !== undefined && current !== null; depth += 1) {
    parts.push(current instanceof Error ? current.message : typeof current === 'string' ? current : JSON.stringify(current))
    current = current instanceof Error ? current.cause : undefined
  }
  return parts.join(': ')
}

function formatDuration(ms: number): string {
  const minutes = Math.max(1, Math.ceil(ms / 60_000))
  if (minutes < 60) return `${minutes}m`
  const hours = Math.floor(minutes / 60)
  return minutes % 60 === 0 ? `${hours}h` : `${hours}h${minutes % 60}m`
}
