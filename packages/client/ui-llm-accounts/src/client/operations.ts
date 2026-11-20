/**
 * The Host calls the account surfaces make, as callbacks bound in the plugin body. Components receive these instead of
 * a context; each outcome names what a surface renders, so Remote namespaces and error codes stay in the apply world.
 */
import type { Context } from '@deepseek-ai/cordis'
import type {
  AccountId, AccountPatch, AccountRetryResult, AccountUsageView, AccountView, ApiKeyAccountAdded, SignInAttemptId,
  SignInAttemptView, SignInRequest,
} from '@deepseek-ai/dsh-api-remotes/client'

/** One Host call's answer: the value, or the refusal a surface shows. */
export type Outcome<T> =
  | { readonly ok: true; readonly value: T }
  /**
   * `busy`: another sign-in holds the provider; `invalid-key`: the key's format was refused; `key-rejected`: the
   * provider refused the key; `other`: the Host's own text.
   */
  | { readonly ok: false; readonly reason: 'busy' | 'invalid-key' | 'key-rejected' | 'other'; readonly message: string }

/** One catalog model the allowlist editor offers. */
export interface CatalogModel {
  readonly id: string
  readonly name: string
}

/** The Host operations the account surfaces invoke. */
export interface AccountsOperations {
  beginSignIn(provider: string, request: SignInRequest): Promise<Outcome<SignInAttemptView>>
  /** Follow one attempt until it settles; the iterable ends when the Host ends the stream or `signal` aborts. */
  watchSignIn(attempt: SignInAttemptId, signal: AbortSignal): AsyncIterable<SignInAttemptView>
  answerSignInPrompt(attempt: SignInAttemptId, promptId: string, answer: { value: string } | { declined: true }): Promise<Outcome<void>>
  cancelSignIn(attempt: SignInAttemptId): Promise<Outcome<void>>
  /** Check the key with the provider, then store it; a key the provider refuses is not stored (`key-rejected`). */
  addApiKeyAccount(provider: string, request: { key: string; alias?: string }): Promise<Outcome<ApiKeyAccountAdded>>
  updateAccount(provider: string, account: AccountId, patch: AccountPatch): Promise<Outcome<AccountView>>
  setDefaultAccount(provider: string, account: AccountId): Promise<Outcome<void>>
  removeAccount(provider: string, account: AccountId): Promise<Outcome<void>>
  /** Re-check a key account with the provider, or clear another account's failure state. */
  retryAccountNow(provider: string, account: AccountId): Promise<Outcome<AccountRetryResult>>
  /** Forced usage refresh; the Host still honours a live failure cooldown. */
  refreshUsage(provider: string, account: AccountId): Promise<Outcome<AccountUsageView>>
  /** The provider's catalog models (pinned `~acct:` entries excluded). */
  catalogModels(provider: string): Promise<Outcome<readonly CatalogModel[]>>
}

type Wire<T> =
  | { readonly ok: true; readonly value: T }
  | { readonly ok: false; readonly error: { readonly code: string; readonly message: string } }

/**
 * Translate one Remote answer into an outcome.
 * @param response - the Remote result.
 * @returns the outcome.
 */
export function outcomeOf<T>(response: Wire<T>): Outcome<T> {
  if (response.ok) return { ok: true, value: response.value }
  const { code, message } = response.error
  const reason = code === 'llm-accounts/attempt-busy' ? 'busy'
    : code === 'llm-accounts/invalid-key' ? 'invalid-key'
      : code === 'llm-accounts/key-rejected' ? 'key-rejected'
        : 'other'
  return { ok: false, reason, message }
}

/** Reserved prefix of pinned per-account model ids; the allowlist names the underlying models only. */
const PINNED_PREFIX = '~acct:'

/**
 * Bind the operations to this plugin's Remote namespaces.
 * @param ctx - the plugin context, which declares `remote.llmAccounts` and `remote.session` in its `inject`.
 * @returns the callbacks the surfaces are injected with.
 */
export function createAccountsOperations(ctx: Context): AccountsOperations {
  const remote = ctx.remote.llmAccounts
  return {
    beginSignIn: async (provider, request) => outcomeOf(await remote.beginSignIn(provider, request)),
    watchSignIn: (attempt, signal) => remote.watchSignIn(attempt, signal),
    answerSignInPrompt: async (attempt, promptId, answer) => outcomeOf(await remote.answerSignInPrompt(attempt, promptId, answer)),
    cancelSignIn: async attempt => outcomeOf(await remote.cancelSignIn(attempt)),
    addApiKeyAccount: async (provider, request) => outcomeOf(await remote.addApiKeyAccount(provider, request)),
    updateAccount: async (provider, account, patch) => outcomeOf(await remote.updateAccount(provider, account, patch)),
    setDefaultAccount: async (provider, account) => outcomeOf(await remote.setDefaultAccount(provider, account)),
    removeAccount: async (provider, account) => outcomeOf(await remote.removeAccount(provider, account)),
    retryAccountNow: async (provider, account) => outcomeOf(await remote.retryAccountNow(provider, account)),
    refreshUsage: async (provider, account) =>
      outcomeOf(await remote.usage(provider, account, { force: true }, AbortSignal.timeout(60_000))),
    catalogModels: async (provider) => {
      const response = outcomeOf(await ctx.remote.session.modelCatalog())
      if (!response.ok) return response
      const group = response.value.groups.find(entry => entry.id === provider)
      const models = (group?.models ?? [])
        .filter(model => !model.id.startsWith(PINNED_PREFIX))
        .map(model => ({ id: model.id, name: model.name }))
      return { ok: true, value: models }
    },
  }
}
