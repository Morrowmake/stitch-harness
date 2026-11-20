/**
 * The Host calls the first-run steps make, as callbacks bound in the plugin
 * body. Components receive these instead of a context; each outcome names
 * what a step renders, so Remote namespaces and error codes stay in the apply
 * world.
 */
import type { Context } from '@deepseek-ai/cordis'
import type {
  LocalProviderProbeView, SignInAttemptId, SignInAttemptView, SignInRequest,
} from '@deepseek-ai/dsh-api-remotes/client'

/** One Host call's answer: the value, or the refusal a step shows. */
export type Outcome<T> =
  | { readonly ok: true; readonly value: T }
  /**
   * `code` is the Host's error code, which `refusalText` localizes; `message` is the Host's own text, or empty;
   * `details` is the code's structured payload when the Host sent one.
   */
  | { readonly ok: false; readonly code: string; readonly message: string; readonly details?: object }

/** A provider route that already serves requests. */
export interface ConfiguredProvider {
  readonly id: string
  readonly name: string
}

/** A hosted pi-ai catalog provider the picker offers. */
export interface HostedProvider {
  readonly provider: string
  readonly displayName: string
  /** The plan a browser sign-in (OAuth) uses, e.g. `Claude Pro/Max (Anthropic)`; absent when no sign-in can authenticate it. */
  readonly planName?: string
  /** Whether one `*_API_KEY` value authenticates it (a plain key box); otherwise the key goes through pi-ai's prompts. */
  readonly simpleKey: boolean
}

/** One model a provider route serves, for the default-model choice. */
export interface ProviderModel {
  readonly id: string
  readonly name: string
  /** Superseded, dated, or alias entry the step folds under "Older models". */
  readonly older?: boolean
}

/** What saving an API key found: `verified` when the provider accepted it, otherwise saved without a check. */
export interface SavedKey {
  readonly verified: boolean
}

/** A hand-declared OpenAI-compatible route: a local server or a custom URL. */
export interface OpenAICompatibleRoute {
  /** Route key, unique among configured providers. */
  readonly route: string
  readonly displayName: string
  readonly baseURL: string
  /** Key the route sends; local servers that ignore keys still need one on the wire. */
  readonly apiKey: string
  readonly models: readonly string[]
}

/** The Host operations the first-run steps invoke. */
export interface FirstRunOperations {
  /** Routes that serve requests now. */
  configuredProviders(): Promise<Outcome<readonly ConfiguredProvider[]>>
  /** Hosted pi-ai catalog providers, in the Host's order (most-used first). */
  hostedProviders(): Promise<Outcome<readonly HostedProvider[]>>
  /** Ask the Host to probe the local servers (Ollama, LM Studio); runs only when called. */
  probeLocal(signal: AbortSignal): Promise<Outcome<readonly LocalProviderProbeView[]>>
  /** Ask an OpenAI-compatible endpoint which models it serves; the key is used for this call only. */
  discoverModels(baseURL: string, apiKey: string | undefined): Promise<Outcome<readonly string[]>>
  /** Declare an OpenAI-compatible route and store its key. */
  addOpenAICompatible(route: OpenAICompatibleRoute): Promise<Outcome<void>>
  /** Check an API key with the provider and store it as a hosted provider's first account; a rejected key is not stored. */
  addApiKeyAccount(provider: string, key: string): Promise<Outcome<SavedKey>>
  beginSignIn(provider: string, request: SignInRequest): Promise<Outcome<SignInAttemptView>>
  /** Follow one attempt until it settles; the iterable ends when the Host ends the stream or `signal` aborts. */
  watchSignIn(attempt: SignInAttemptId, signal: AbortSignal): AsyncIterable<SignInAttemptView>
  answerSignInPrompt(attempt: SignInAttemptId, promptId: string, answer: { value: string } | { declined: true }): Promise<Outcome<void>>
  cancelSignIn(attempt: SignInAttemptId): Promise<Outcome<void>>
  /** The models one route serves, from the current model catalog. */
  providerModels(provider: string): Promise<Outcome<readonly ProviderModel[]>>
  /** Make one model the default for new Sessions. */
  saveDefaultModel(provider: string, model: string): Promise<Outcome<void>>
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
  return { ok: false, code: response.error.code, message: response.error.message }
}

/** Settings namespace of the pi-ai adapter family, which owns every route this flow adds. */
export const PI_AI_SETTINGS_NS = 'llm-pi-ai'

/** Settings namespace of the default-model service (its row id in the base composition). */
export const DEFAULT_MODEL_SETTINGS_NS = 'agent-default-model'

/** Protocol every route this flow declares speaks. */
const OPENAI_COMPLETIONS = 'openai-completions'

/** Reserved prefix of pinned per-account model ids; the default names the underlying models only. */
const PINNED_PREFIX = '~acct:'

/**
 * The conventional credential reference for a route, the same one the Models page derives.
 * @param route - provider route id.
 * @returns the reference name, e.g. `OLLAMA_API_KEY`.
 */
export function deriveKeyRef(route: string): string {
  return `${route.toUpperCase().replace(/[^A-Z0-9]+/g, '_')}_API_KEY`
}

/**
 * Bind the operations to this plugin's Remote namespaces.
 * @param ctx - the plugin context, which declares every Remote namespace used here in its `inject`.
 * @returns the callbacks the steps are injected with.
 */
export function createFirstRunOperations(ctx: Context): FirstRunOperations {
  const accounts = ctx.remote.llmAccounts
  return {
    configuredProviders: async () => outcomeOf(await ctx.remote.llm.listProviders()),
    hostedProviders: async () => {
      const response = outcomeOf(await ctx.remote.llm.listConfigurableProviders())
      if (!response.ok) return response
      return {
        ok: true,
        value: response.value
          .filter(entry => entry.settingsNs === PI_AI_SETTINGS_NS && entry.declared === false && entry.error === undefined)
          .map(entry => ({
            provider: entry.provider,
            displayName: entry.displayName,
            ...entry.nativeAuth?.oauth === true ? { planName: entry.nativeAuth.oauthName ?? entry.displayName } : {},
            simpleKey: (entry.nativeAuth?.env ?? []).some(name => name.endsWith('_API_KEY')),
          })),
      }
    },
    probeLocal: async signal => outcomeOf(await accounts.probeLocalProviders(signal)),
    discoverModels: async (baseURL, apiKey) => {
      const response = await ctx.remote.llm.discoverModels(PI_AI_SETTINGS_NS, {
        api: OPENAI_COMPLETIONS, baseURL, ...apiKey === undefined ? {} : { apiKey },
      })
      if (response.ok) return { ok: true, value: response.value.map(model => model.id) }
      // The step tells an unreachable host from a foreign or locked server by the refusal's reason.
      const { code, message, details } = response.error
      return { ok: false, code, message, details }
    },
    addOpenAICompatible: async (route) => {
      const keyRef = deriveKeyRef(route.route)
      const profile = {
        displayName: route.displayName,
        apiKeyEnv: keyRef,
        api: OPENAI_COMPLETIONS,
        baseURL: route.baseURL,
        models: route.models.map(id => ({ id })),
      }
      // The key lands first: the route registers the moment its profile does, and a
      // request in between would otherwise name a reference nothing has set.
      const stored = outcomeOf(await ctx.remote.credentials.set(keyRef, route.apiKey))
      if (!stored.ok) return stored
      const written = outcomeOf(await ctx.remote.settings.mutate(
        PI_AI_SETTINGS_NS,
        [{ op: 'set', path: ['providers', route.route], value: profile }],
        undefined,
      ))
      return written.ok ? { ok: true, value: undefined } : written
    },
    addApiKeyAccount: async (provider, key) => {
      const response = outcomeOf(await accounts.addApiKeyAccount(provider, { key }))
      return response.ok ? { ok: true, value: { verified: response.value.check.status === 'verified' } } : response
    },
    beginSignIn: async (provider, request) => outcomeOf(await accounts.beginSignIn(provider, request)),
    watchSignIn: (attempt, signal) => accounts.watchSignIn(attempt, signal),
    answerSignInPrompt: async (attempt, promptId, answer) => outcomeOf(await accounts.answerSignInPrompt(attempt, promptId, answer)),
    cancelSignIn: async attempt => outcomeOf(await accounts.cancelSignIn(attempt)),
    providerModels: async (provider) => {
      const response = outcomeOf(await ctx.remote.session.modelCatalog())
      if (!response.ok) return response
      const group = response.value.groups.find(entry => entry.id === provider)
      const models = (group?.models ?? [])
        .filter(model => !model.id.startsWith(PINNED_PREFIX))
        .map(model => ({ id: model.id, name: model.name, ...model.older === true ? { older: true } : {} }))
      return { ok: true, value: models }
    },
    saveDefaultModel: async (provider, model) => {
      // The same complete selection `agentDefaultModel.saveSelection` stores: a
      // reasoning effort chosen for another model does not carry over.
      const response = outcomeOf(await ctx.remote.settings.mutate(DEFAULT_MODEL_SETTINGS_NS, [
        { op: 'set', path: ['provider'], value: provider },
        { op: 'set', path: ['model'], value: model },
        { op: 'unset', path: ['reasoningEffort'] },
      ], undefined))
      return response.ok ? { ok: true, value: undefined } : response
    },
  }
}
