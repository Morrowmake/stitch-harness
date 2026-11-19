/**
 * Browser-driven sign-in attempts for pi-ai accounts. The authorization seam
 * runs one flow per credential key, so each attempt registers a flow for its
 * own account's record key, begins it, and withdraws the flow when it
 * settles (the MCP OAuth precedent). Notices and prompts the provider's
 * login raises are held on the attempt for a Remote caller to render and
 * answer; nothing here is persisted except the credential pi-ai commits.
 *
 * @module dsh-llm-pi-ai/accounts/signin
 */

import { randomUUID } from 'node:crypto'
import type { AuthType } from '@earendil-works/pi-ai'
import type { Context } from '@deepseek-ai/cordis'
import type { CredentialKey, CredentialRecord } from '@deepseek-ai/dsh-credentials'
import { AuthorizationDeclinedError } from '@deepseek-ai/dsh-authorization'
import type { AuthorizationPrompt } from '@deepseek-ai/dsh-authorization'
import { APP_IDENTITY } from '@deepseek-ai/dsh-llm'
import { RemoteError } from '@deepseek-ai/dsh-typert-protocol'
import { authContextFrom } from '../auth.ts'
import { catalogProvider } from '../catalog.ts'
import { loginMethods, relay, restate } from '../login.ts'
import { createModels } from '../models.ts'
import { isAccountRoute, isStoredAccountId, newAccountId, recordKeyFor } from './keys.ts'
import { accountCredentialStore } from './store.ts'
import type { AccountId, SignInAttemptId, SignInAttemptView, SignInPromptView, SignInRequest } from './types.ts'

/** Settled attempts stay readable this long, then are dropped. */
export const ATTEMPT_RETENTION_MS = 10 * 60_000
/** Notices kept per attempt (oldest dropped first). */
const MAX_NOTICES = 20
/**
 * Routes whose pi-ai login binds the fixed callback `127.0.0.1:1455` (shared
 * with the Codex CLI): at most one of them signs in at a time per host.
 */
const CALLBACK_1455: Readonly<Record<string, true>> = { 'openai': true, 'openai-codex': true }

/** What the service does when an attempt authorizes or ends without a credential. */
export interface SignInHooks {
  /** Record metadata for the account that now holds a credential. */
  authorized(route: string, account: AccountId, created: boolean, alias: string | undefined): Promise<void>
  /** Any attempt change (for `watch` listeners of the account list). */
  changed(): void
}

interface PendingPrompt {
  view: SignInPromptView
  resolve: (value: string) => void
  reject: (error: unknown) => void
}

interface Attempt {
  view: SignInAttemptView
  route: string
  controller: AbortController
  pending?: PendingPrompt
  listeners: Set<() => void>
  timer?: ReturnType<typeof setTimeout>
}

/** Live and recently settled sign-in attempts of one plugin instance. */
export class SignInAttempts {
  private readonly attempts = new Map<SignInAttemptId, Attempt>()
  private disposed = false

  constructor(private readonly ctx: Context, private readonly hooks: SignInHooks) {}

  /**
   * Start signing one account of a route in (a new account, or re-sign-in of
   * `req.accountId`).
   * @param route - the provider route key.
   * @param req - the sign-in method, optional alias, and account to re-sign-in.
   * @returns the attempt's first view.
   * @throws {RemoteError} `llm-accounts/unsupported` for a route or method pi-ai offers no login for,
   *   `llm-accounts/attempt-busy` while another attempt for the route (or its callback-port family) runs.
   */
  async begin(route: string, req: SignInRequest): Promise<SignInAttemptView> {
    const provider = catalogProvider(route)
    const methods = provider === undefined || !isAccountRoute(route) ? [] : loginMethods(provider)
    const [first, ...rest] = methods
    if (provider === undefined || first === undefined || !methods.some(method => method.id === req.method)) {
      throw new RemoteError('llm-accounts/unsupported', `llm-accounts: "${route}" offers no ${req.method} sign-in`, { provider: route, method: req.method })
    }
    const authorization = this.ctx.get('authorization')
    const credentials = this.ctx.get('credentials')
    if (authorization === undefined || credentials === undefined) {
      throw new RemoteError('llm-accounts/unsupported', 'llm-accounts: this composition mounts no authorization or credentials service', { provider: route, method: req.method })
    }
    if (req.accountId !== undefined && !isStoredAccountId(req.accountId)) {
      throw new RemoteError('llm-accounts/unknown-account', `llm-accounts: account "${req.accountId}" cannot sign in`, { provider: route, account: req.accountId })
    }
    for (const attempt of this.attempts.values()) {
      if (attempt.view.phase !== 'running') continue
      if (attempt.route === route || (CALLBACK_1455[route] === true && CALLBACK_1455[attempt.route] === true)) {
        throw new RemoteError('llm-accounts/attempt-busy', `llm-accounts: a sign-in for "${attempt.route}" is already running`, { provider: route })
      }
    }
    const accountId = req.accountId ?? newAccountId()
    const key = recordKeyFor(route, accountId)
    const id = randomUUID() as SignInAttemptId
    const attempt: Attempt = {
      view: { id, provider: route, accountId, phase: 'running', notices: [] },
      route,
      controller: new AbortController(),
      listeners: new Set(),
    }
    // Claimed before the first await so a concurrent begin sees the route busy.
    this.attempts.set(id, attempt)
    let existing: CredentialRecord | undefined
    try {
      existing = await credentials.readRecord(key)
    } catch (error) {
      this.attempts.delete(id)
      throw error
    }
    const created = existing === undefined
    // Sign in with ChatGPT identifies the installation by a per-account UUID:
    // reuse the one this account's grant already carries, else mint one that
    // lives only inside this account's record.
    const payload = existing?.kind === 'grant' ? existing.payload : undefined
    const stored = typeof payload === 'object' && payload !== null && 'deviceId' in payload ? payload.deviceId : undefined
    const deviceId = route === 'openai' && req.method === 'oauth'
      ? typeof stored === 'string' && stored.length > 0 ? stored : randomUUID()
      : undefined

    const manualCodes = new WeakSet<AuthorizationPrompt>()
    const ctx = this.ctx
    const dispose = authorization.registerFlow({
      key,
      label: provider.name,
      methods: [first, ...rest],
      async run(session) {
        const models = createModels({
          credentials: accountCredentialStore(ctx, accountId, deviceId === undefined ? undefined : { deviceId }),
          authContext: authContextFrom(ctx),
        })
        models.setProvider(provider)
        const type: AuthType = session.method === 'oauth' ? 'oauth' : 'api_key'
        await models.login(route, type, {
          signal: session.signal,
          notify: (event) => { relay(event, session) },
          prompt: (prompt) => {
            const restated = restate(prompt)
            if (prompt.type === 'manual_code') manualCodes.add(restated)
            return session.prompt(restated)
          },
        }, {
          agentName: APP_IDENTITY.product,
          ...deviceId === undefined ? {} : { getDeviceId: () => deviceId },
        })
      },
    })
    const settle = (phase: SignInAttemptView['phase'], error?: string): void => {
      this.dropPrompt(attempt)
      attempt.view = { ...attempt.view, phase, ...error === undefined ? {} : { error } }
      delete attempt.view.prompt
      this.publish(attempt)
      attempt.timer = setTimeout(() => { this.attempts.delete(id) }, ATTEMPT_RETENTION_MS)
      attempt.timer.unref()
    }
    void authorization.begin({
      key,
      method: req.method,
      signal: attempt.controller.signal,
      interaction: {
        notify: (notice) => {
          const notices = [...attempt.view.notices, {
            message: notice.message,
            ...notice.url === undefined ? {} : { url: notice.url },
            ...notice.code === undefined ? {} : { code: notice.code },
          }].slice(-MAX_NOTICES)
          attempt.view = { ...attempt.view, notices }
          this.publish(attempt)
        },
        prompt: prompt => this.ask(attempt, prompt, manualCodes.has(prompt)),
      },
    }).then(
      async (outcome) => {
        if (outcome.status === 'authorized') {
          try {
            await this.hooks.authorized(route, accountId, created, req.alias)
          } catch (error) {
            ctx.logger.warn('llm-pi-ai: recording metadata for a signed-in account failed')
            ctx.logger.warn(error)
          }
          settle('authorized')
        } else {
          await this.discardPartial(key, created)
          settle('cancelled')
        }
      },
      async (error: unknown) => {
        await this.discardPartial(key, created)
        settle('failed', error instanceof Error ? error.message : String(error))
      },
    ).finally(dispose)
    return attempt.view
  }

  /**
   * Stream one attempt's views until it settles (the settled view is the last item).
   * @param id - the attempt to follow.
   * @param signal - ends the stream early.
   * @returns the attempt's views as they change.
   */
  async* watch(id: SignInAttemptId, signal: AbortSignal): AsyncIterable<SignInAttemptView> {
    const attempt = this.require(id)
    let wake = Promise.withResolvers<void>()
    let dirty = true
    const notify = (): void => {
      dirty = true
      wake.resolve()
    }
    attempt.listeners.add(notify)
    // A function, not the properties, so the post-await re-check is not narrowed away.
    const stopped = (): boolean => signal.aborted || this.disposed
    signal.addEventListener('abort', notify, { once: true })
    try {
      while (!stopped()) {
        if (!dirty) await wake.promise
        if (stopped()) break
        dirty = false
        wake = Promise.withResolvers<void>()
        yield attempt.view
        if (attempt.view.phase !== 'running') break
      }
    } finally {
      attempt.listeners.delete(notify)
      signal.removeEventListener('abort', notify)
    }
  }

  /**
   * Answer (or decline) the attempt's pending prompt; a stale prompt id is ignored.
   * @param id - the attempt whose prompt is answered.
   * @param promptId - the prompt being answered.
   * @param answer - the entered value, or `declined`.
   */
  answer(id: SignInAttemptId, promptId: string, answer: { value: string } | { declined: true }): void {
    const attempt = this.require(id)
    const pending = attempt.pending
    if (pending === undefined || pending.view.id !== promptId) return
    delete attempt.pending
    delete attempt.view.prompt
    attempt.view = { ...attempt.view }
    if ('value' in answer) pending.resolve(answer.value)
    else pending.reject(new AuthorizationDeclinedError())
    this.publish(attempt)
  }

  /**
   * Withdraw a running attempt; a settled one is left as it is.
   * @param id - the attempt to cancel.
   */
  cancel(id: SignInAttemptId): void {
    this.require(id).controller.abort()
  }

  /**
   * Whether an attempt is still running for the route (tests, list views).
   * @param route - the provider route key.
   * @returns true while an attempt for the route is running.
   */
  running(route: string): boolean {
    return [...this.attempts.values()].some(attempt => attempt.route === route && attempt.view.phase === 'running')
  }

  /** Withdraw every attempt and end every stream (plugin dispose). */
  dispose(): void {
    this.disposed = true
    for (const attempt of this.attempts.values()) {
      attempt.controller.abort()
      clearTimeout(attempt.timer)
      for (const listener of attempt.listeners) listener()
    }
    this.attempts.clear()
  }

  private require(id: SignInAttemptId): Attempt {
    const attempt = this.attempts.get(id)
    if (attempt === undefined) throw new RemoteError('llm-accounts/attempt-unknown', `llm-accounts: no sign-in attempt "${id}"`, {})
    return attempt
  }

  private ask(attempt: Attempt, prompt: AuthorizationPrompt, manualCode: boolean): Promise<string> {
    this.dropPrompt(attempt)
    const promptId = randomUUID()
    const view: SignInPromptView = prompt.kind === 'select'
      ? { id: promptId, kind: 'select', message: prompt.message, options: prompt.options.map(option => ({ ...option })) }
      : {
        id: promptId,
        kind: manualCode ? 'manual_code' : prompt.kind,
        message: prompt.message,
        ...prompt.placeholder === undefined ? {} : { placeholder: prompt.placeholder },
      }
    const { promise, resolve, reject } = Promise.withResolvers<string>()
    attempt.pending = { view, resolve, reject }
    attempt.view = { ...attempt.view, prompt: view }
    // A flow racing a typed code against a browser callback withdraws the losing question.
    prompt.signal?.addEventListener('abort', () => {
      if (attempt.pending?.view.id !== promptId) return
      this.dropPrompt(attempt)
      this.publish(attempt)
    }, { once: true })
    this.publish(attempt)
    return promise
  }

  /** Reject the pending prompt (superseded, withdrawn, or settled) and clear it from the view. */
  private dropPrompt(attempt: Attempt): void {
    const pending = attempt.pending
    if (pending === undefined) return
    delete attempt.pending
    const { prompt: _dropped, ...view } = attempt.view
    attempt.view = view
    pending.reject(new AuthorizationDeclinedError('the sign-in prompt was withdrawn'))
  }

  /** A failed or withdrawn attempt for a new account leaves no partial record behind. */
  private async discardPartial(key: CredentialKey, created: boolean): Promise<void> {
    if (!created) return
    const credentials = this.ctx.get('credentials')
    try {
      if (await credentials?.readRecord(key) !== undefined) await credentials?.deleteRecord(key)
    } catch (error) {
      this.ctx.logger.warn('llm-pi-ai: discarding a partial sign-in record failed')
      this.ctx.logger.warn(error)
    }
  }

  private publish(attempt: Attempt): void {
    for (const listener of attempt.listeners) listener()
    this.hooks.changed()
  }
}
