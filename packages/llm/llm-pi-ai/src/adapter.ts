/**
 * Generic pi-ai-backed implementation of the Harness LLM seam.
 *
 * Each resolution produces one **immutable** snapshot — the profiles plus a
 * `Models` collection holding the `Provider` each route built — and an
 * operation captures a whole snapshot before its first `await`. A
 * configuration change builds a *new* collection rather than mutating the one
 * in use, because `Models.streamSimple()` is lazy: it resolves the provider
 * when the stream is first consumed, which is after the credential await, so a
 * mutated collection would let a request that started under one configuration
 * finish under another — or fail with a provider that no longer exists. This is
 * what makes the seam's per-step call freeze (`llm.prepareCall()`) hold all the
 * way down: switching models mid-reply takes effect on the next step, never
 * inside the one in flight.
 *
 * A route naming a credential reference still resolves it through the harness
 * seam and passes it as the request's `apiKey` option, which pi-ai treats as
 * the highest-priority auth override — that is what keeps the fail-loud
 * reference semantics. Everything that override does not cover reaches pi-ai
 * through the collection's own auth: the credential store holds the records a
 * login wrote and a refresh rotates, and the auth context answers the ambient
 * questions a provider asks while resolving. Both are stable across snapshots,
 * so a configuration change rebuilds the collection without forgetting who is
 * signed in.
 *
 * @module dsh-llm-pi-ai/adapter
 */

import { ModelsError } from '@earendil-works/pi-ai'
import type {
  Api,
  AuthContext,
  CredentialStore,
  Model,
  Models,
  ModelThinkingLevel,
  MutableModels,
  SimpleStreamOptions,
  ThinkingLevel,
} from '@earendil-works/pi-ai'
import {
  attributionHeaders,
  contentHasImage,
  LlmAdapter,
  LlmError,
} from '@deepseek-ai/dsh-llm'
import type {
  GenerateOptions,
  ImageAttachmentAccess,
  LlmModelInfo,
  LlmProviderInfo,
  LlmResolvedModelInfo,
  PreparedAdapterCall,
  ReasoningEffortId as ReasoningEffortIdType,
  ResolvedRetryPolicy,
  StreamChunk,
  ToolSchema,
} from '@deepseek-ai/dsh-llm'
import type { AttachmentStore, ImageAttachmentRef } from '@deepseek-ai/dsh-attachment'
import { brandString } from '@deepseek-ai/dsh-brand'
import { idleWatchdog, timeoutOf } from '@deepseek-ai/dsh-timeout'
import type { ResolvedPiAiProviderProfile } from './config.ts'
import { requestImageTarget, toPiContext } from './context.ts'
import { conversationUpdates, createModels, getSupportedThinkingLevels } from './models.ts'
import { bindReplayToAccount } from './replay.ts'
import { toStreamChunks } from './stream.ts'
import { capturingFetch, FETCHABLE_APIS, responseObserver } from './accounts/capture.ts'
import { REFRESH_FAILURE_CODE } from './accounts/classify.ts'
import { AMBIENT_ACCOUNT, ENV_ACCOUNT, MAIN_ACCOUNT } from './accounts/keys.ts'
import { AccountPool, accountLabel, parsePinnedModelId, pinnedModelId } from './accounts/router.ts'
import type { AttemptObserver } from './accounts/router.ts'
import type { AccountRuntime } from './accounts/runtime.ts'
import { allows } from './accounts/scheduler.ts'
import type { AccountId } from './accounts/types.ts'
import { bindThinkingToPrefix } from './prefix-binding.ts'
import type { PrefixDigests } from './prefix-binding.ts'
import type { PiAiRequestHeaderContext } from './types.ts'

/**
 * Initially active declaration added to an Anthropic request whose projected
 * tools are all deferred, because Anthropic rejects a tool list without one.
 */
const ANTHROPIC_TOOL_UPDATE_PLACEHOLDER: ToolSchema = {
  name: 'DeferredToolPlaceholder',
  description: 'Reserved placeholder that keeps deferred tool loading active; never call this tool.',
  parameters: { type: 'object', properties: {} },
}

/** One resolution's frozen view: the profiles and the collection built from them. */
interface PiAiSnapshot {
  /** The resolved profiles this collection was built from, used as its identity. */
  profiles: ReadonlyMap<string, ResolvedPiAiProviderProfile>
  /** Providers for exactly those profiles; never mutated once published. */
  models: Models
  /** Per stored account (other than `main`), the same providers over that account's credential store; built lazily. */
  byAccount: Map<AccountId, Models>
}

/** Virtual accounts and `main` resolve through the snapshot's own collection (the legacy store). */
const SHARED_ACCOUNTS: ReadonlySet<AccountId> = new Set([MAIN_ACCOUNT, ENV_ACCOUNT, AMBIENT_ACCOUNT])

/** The one account a route has when no pool is mounted: its key reference, else pi-ai's own discovery. */
function legacyAccount(provider: string, profile: ResolvedPiAiProviderProfile | undefined): AccountRuntime {
  const keyRef = profile?.apiKeyEnv !== undefined
  return {
    provider,
    id: keyRef ? ENV_ACCOUNT : AMBIENT_ACCOUNT,
    kind: keyRef ? 'key-ref' : 'ambient',
    meta: { pooled: true, pinned: false },
    isDefault: true,
  }
}

/** Map a pi-ai auth-resolution failure of a signed-in account to a classifiable `LlmError`. */
function authFailure(error: unknown, provider: string, account: AccountRuntime): unknown {
  if (!(error instanceof ModelsError) || error.code !== 'oauth') return error
  return LlmError.fromFailure({
    message: `llm-pi-ai: signing in to provider "${provider}" as account "${accountLabel(account)}" could not refresh its token`,
    code: REFRESH_FAILURE_CODE,
  }, { cause: error })
}

/** Constructor options for {@link PiAiAdapter}: the two resolution hooks the plugin owns. */
export interface PiAiAdapterOptions {
  /** Current validated profiles by provider route; called once per operation. */
  profiles: () => ReadonlyMap<string, ResolvedPiAiProviderProfile>
  /**
   * Resolve the credential for one already-resolved profile; called once per
   * stream call and frozen for that call, and by `listModels`, which offers no
   * models while it throws `MISSING_CREDENTIAL`. `undefined` defers to the route's own
   * pi-ai auth, which for an installed catalog route is its provider-native
   * ambient discovery; the plugin allows that only for a profile naming no
   * credential at all, because a named reference that misses throws `LlmError`
   * `MISSING_CREDENTIAL` rather than falling back.
   */
  resolveApiKey: (provider: string, profile: ResolvedPiAiProviderProfile) => Promise<string | undefined>
  /**
   * How every collection this adapter builds resolves auth the request-level
   * `apiKey` override does not cover. Required rather than optional: a
   * collection built without them gets pi-ai's in-memory default store, which
   * is empty at every boot and discarded on every configuration change, so a
   * route whose only method is a login would report itself unconfigured on
   * every request no matter how often the human signed in.
   */
  auth: PiAiAuthInjection
  /**
   * Synchronously prepare this call's headers before SDK dispatch. The input
   * contains a fresh copy of profile headers; attribution is enforced afterward.
   * Omission preserves profile headers. Throws fail the call with REQUEST_HEADERS
   * before inference I/O. Do not retain or mutate headers after returning.
   * Non-TypeError messages become public diagnostics and must exclude secrets;
   * TypeError details and non-Error values are replaced with safe guidance.
   * @param request - immutable routing metadata from the prepared call.
   * @param headers - request-owned headers initialized from the profile.
   * @returns headers to pass to pi-ai after applying Harness attribution.
   */
  prepareHeaders?: (request: PiAiRequestHeaderContext, headers: Headers) => Headers
  /** Resolve the optional durable attachment service at request time. */
  resolveAttachments?: () => AttachmentStore | undefined
  /** Bridge one attachment reference into the current model-tool execution world. */
  resolveImageAccess?: (attachments: AttachmentStore, ref: ImageAttachmentRef) => ImageAttachmentAccess | undefined
  /**
   * Observe one assistant history message degrading to provider-neutral
   * conversion because its stored replay state is unusable by this build.
   */
  onReplayDegrade?: (detail: { provider: string; model: string; reason: string }) => void
  /**
   * Observe one request that sent replayed assistant messages without their
   * signed Anthropic thinking because the request prefix changed or was never
   * recorded. Stale messages stay omitted, so later requests of the
   * conversation report them again.
   */
  onThinkingOmitted?: (detail: { provider: string; model: string; count: number }) => void
  /**
   * The multi-account pool. Omitted, each route has exactly one account —
   * its `apiKeyEnv` reference, else pi-ai's own auth over the `main` store.
   */
  pool?: AccountPool
}

/** The auth injectables a pi-ai collection is built with. */
export interface PiAiAuthInjection {
  /** Durable storage of the `main` account: logins, and the refreshes pi-ai runs under its own lock. */
  credentials: CredentialStore
  /** Ambient lookups a provider performs while resolving its own auth. */
  authContext: AuthContext
  /** The store of one other stored account; omitted, only `main` exists. */
  accountCredentials?: (account: AccountId) => CredentialStore
}

/** Copy profile stream knobs into pi-ai's common option vocabulary. */
function profileOptions(
  profile: ResolvedPiAiProviderProfile,
  reasoning: ModelThinkingLevel | undefined,
  apiKey: string | undefined,
): SimpleStreamOptions {
  const enabledReasoning: ThinkingLevel | undefined = reasoning === 'off' ? undefined : reasoning
  return {
    ...apiKey === undefined ? {} : { apiKey },
    ...enabledReasoning === undefined ? {} : { reasoning: enabledReasoning },
    ...profile.thinkingBudgets === undefined ? {} : { thinkingBudgets: profile.thinkingBudgets },
    ...profile.cacheRetention === undefined ? {} : { cacheRetention: profile.cacheRetention },
    ...profile.transport === undefined ? {} : { transport: profile.transport },
    ...profile.timeoutMs === undefined ? {} : { timeoutMs: profile.timeoutMs },
    ...profile.websocketConnectTimeoutMs === undefined ? {} : { websocketConnectTimeoutMs: profile.websocketConnectTimeoutMs },
    // The agent recovery layer owns visible attempts; one adapter call is one SDK attempt.
    maxRetries: 0,
  }
}

/**
 * The profile default this exact model can actually take, for DESCRIBING it.
 * A configured level the model does not support yields none rather than
 * throwing: `resolveModel` builds the model catalog, and a catalog that fails
 * takes its whole provider out of every picker — so one mis-set profile field
 * would hide every model on the route, including the ones that support the
 * level. The request path still refuses, which is where a bad configuration
 * belongs: describing what a model can do must not fail because a deployment
 * asked it for something it cannot.
 * @param model - the resolved model descriptor.
 * @param effort - the profile's configured level, if any.
 * @returns the level when this model supports it, otherwise undefined.
 */
function describableReasoningLevel(
  model: Model<Api>,
  effort: ReasoningEffortIdType | ModelThinkingLevel | undefined,
): ModelThinkingLevel | undefined {
  if (effort === undefined) return undefined
  return getSupportedThinkingLevels(model).some(level => level === effort)
    ? effort as ModelThinkingLevel
    : undefined
}

/** Validate an explicit Harness/profile effort without invoking pi-ai's clamp. */
function resolveReasoningLevel(
  model: Model<Api>,
  effort: ReasoningEffortIdType | ModelThinkingLevel | undefined,
): ModelThinkingLevel | undefined {
  if (effort === undefined) return undefined
  const supported = getSupportedThinkingLevels(model)
  if (supported.some(level => level === effort)) return effort as ModelThinkingLevel
  throw new LlmError(
    `pi-ai provider "${model.provider}" model "${model.id}" does not support reasoning effort "${effort}"`,
    'UNSUPPORTED_REASONING_EFFORT',
  )
}

/**
 * Selectable reasoning efforts for one model, or nothing at all.
 *
 * A model that carries no reasoning metadata — every hand-declared one, and
 * every catalog model pi-ai marks as non-reasoning — is reported by pi-ai as
 * supporting the single level `off`. Passing that through would offer a control
 * that cannot do what it says: `off` is translated to *omitting* the reasoning
 * option, which for such a model is byte-for-byte the same request as naming no
 * effort — so a provider whose own default is to think would keep thinking with
 * `off` selected. Omitting `reasoning` entirely is the seam's way of saying the
 * capability is unavailable, which leaves the surface offering only the
 * provider's default.
 * @param model - the resolved model descriptor.
 * @param defaultLevel - the profile's configured effort, already validated.
 * @returns the `reasoning` field, or an empty object when none can be offered.
 */
function reasoningInfo(
  model: Model<Api>,
  defaultLevel: ModelThinkingLevel | undefined,
): Pick<LlmResolvedModelInfo, 'reasoning'> | Record<string, never> {
  if (!model.reasoning) return {}
  const levels = getSupportedThinkingLevels(model)
  return {
    reasoning: {
      efforts: levels.map(level => ({
        id: brandString<ReasoningEffortIdType>(level),
        name: `${level.charAt(0).toUpperCase()}${level.slice(1)}`,
      })),
      ...defaultLevel === undefined ? {} : { defaultEffort: brandString<ReasoningEffortIdType>(defaultLevel) },
    },
  }
}

/** Native header TypeErrors can echo credentials; other plugin errors own their public message. */
function requestHeaderDiagnostic(error: unknown): string {
  if (error instanceof TypeError) {
    return 'TypeError during header preparation; check the contributing plugin\'s header names, values, and configuration'
  }
  return error instanceof Error
    ? error.message
    : 'the contributing plugin threw a non-Error value; throw an Error with a safe diagnostic'
}

/** Prepare request-owned headers without allowing contributors to replace attribution. */
function requestHeaders(
  configured: Readonly<Record<string, string>> | undefined,
  options: GenerateOptions<string>,
  baseURL: string,
  prepare: PiAiAdapterOptions['prepareHeaders'],
): Record<string, string> {
  try {
    const initial = new Headers()
    // Profile aliases overwrite case-insensitively; the Headers constructor appends them.
    for (const [name, value] of Object.entries(configured ?? {})) initial.set(name, value)
    const request: PiAiRequestHeaderContext = Object.freeze({
      provider: options.provider,
      model: options.model,
      baseURL,
      ...options.sessionId === undefined ? {} : { sessionId: options.sessionId },
      ...options.purpose === undefined ? {} : { purpose: options.purpose },
    })
    const headers = prepare === undefined ? initial : prepare(request, initial)
    for (const [name, value] of Object.entries(attributionHeaders())) headers.set(name, value)
    return Object.fromEntries(headers)
  } catch (error) {
    throw new LlmError(
      `pi-ai request header preparation failed for provider "${options.provider}": ${requestHeaderDiagnostic(error)}`,
      'REQUEST_HEADERS', { cause: error },
    )
  }
}

/**
 * pi-ai-backed multi-provider adapter. Each operation reads the current
 * profiles, so a configuration change reaches the next request without a
 * restart; model descriptors come from the collection those profiles built.
 */
export class PiAiAdapter extends LlmAdapter {
  private snapshot: PiAiSnapshot | undefined
  /** The configured pool, or a one-account-per-route pool over the profiles. */
  readonly pool: AccountPool

  constructor(private readonly config: PiAiAdapterOptions) {
    super()
    this.pool = config.pool ?? new AccountPool({
      forRoute: route => Promise.resolve([legacyAccount(route, this.current().profiles.get(route))]),
      invalidate: () => {},
    })
  }

  override imageRequestTarget(provider: string, model: string, image: ImageAttachmentRef) {
    const snapshot = this.current()
    this.modelOf(snapshot, provider, model)
    const profile = this.profileOf(snapshot, provider)
    return requestImageTarget(image, { maxPixels: profile.requestImagePixelBudget, maxBytes: profile.requestImageMaxBytes })
  }

  /**
   * The snapshot for the current profiles. Resolution memoizes its result, so
   * an unchanged configuration is recognized by identity; a changed one gets a
   * brand-new collection, leaving any snapshot an operation already captured
   * untouched for as long as that operation holds it.
   */
  private current(): PiAiSnapshot {
    const profiles = this.config.profiles()
    if (this.snapshot?.profiles === profiles) return this.snapshot
    this.snapshot = { profiles, models: this.collection(profiles, this.config.auth.credentials), byAccount: new Map() }
    return this.snapshot
  }

  /** A collection holding every profile's provider over one credential store. */
  private collection(profiles: ReadonlyMap<string, ResolvedPiAiProviderProfile>, credentials: CredentialStore): Models {
    const models: MutableModels = createModels({ credentials, authContext: this.config.auth.authContext })
    for (const profile of profiles.values()) {
      if (profile.piProvider !== undefined) models.setProvider(profile.piProvider)
    }
    return models
  }

  /** The collection serving one account: `main` and the virtual accounts share the snapshot's own. */
  private modelsFor(snapshot: PiAiSnapshot, account: AccountId): Models {
    const scoped = this.config.auth.accountCredentials
    if (SHARED_ACCOUNTS.has(account) || scoped === undefined) return snapshot.models
    let models = snapshot.byAccount.get(account)
    if (models === undefined) {
      models = this.collection(snapshot.profiles, scoped(account))
      snapshot.byAccount.set(account, models)
    }
    return models
  }

  /**
   * The account-scoped collection of the current snapshot (sign-in and usage fetchers).
   * @param account - the account id; `main` and the virtual accounts share the snapshot's own collection.
   * @returns the pi-ai model collection reading that account's credentials.
   */
  accountModels(account: AccountId): Models {
    return this.modelsFor(this.current(), account)
  }

  /** The credential store pi-ai refreshes one account's token through. */
  private storeFor(account: AccountId): CredentialStore {
    const scoped = this.config.auth.accountCredentials
    return SHARED_ACCOUNTS.has(account) || scoped === undefined ? this.config.auth.credentials : scoped(account)
  }

  /** The profile for one route within one snapshot, or the not-owned failure. */
  private profileOf(snapshot: PiAiSnapshot, provider: string): ResolvedPiAiProviderProfile {
    const profile = snapshot.profiles.get(provider)
    if (profile === undefined) {
      throw new LlmError(`pi-ai adapter does not own provider "${provider}"`, 'NO_ADAPTER')
    }
    return profile
  }

  /** The configured descriptor for one route/model pair (a pinned `~acct:` id names its underlying model). */
  private modelOf(snapshot: PiAiSnapshot, provider: string, requested: string): Model<Api> {
    const model = parsePinnedModelId(requested)?.model ?? requested
    const profile = this.profileOf(snapshot, provider)
    const failure = profile.modelErrors.get(model)
      ?? (profile.piProvider === undefined ? profile.catalogError : undefined)
    if (failure !== undefined) throw new LlmError(failure, 'INVALID_CONFIG')
    const resolved = snapshot.models.getModel(provider, model)
    if (resolved === undefined) {
      throw new LlmError(`pi-ai provider "${provider}" has no configured model "${model}"`, 'UNKNOWN_MODEL')
    }
    return resolved
  }

  override providerInfo(provider: string): LlmProviderInfo {
    // The configured name, not the route key: `displayName` exists so a
    // deployment can label a route, and a label only the configuration surface
    // reads would leave every selector showing the raw key.
    return { id: provider, name: this.current().profiles.get(provider)?.displayName ?? provider }
  }

  override providerRetryPolicy(provider: string): ResolvedRetryPolicy | undefined {
    return this.current().profiles.get(provider)?.retryPolicy
  }

  /**
   * Pool entries (catalog models allowed by a pooled account, or by the
   * default account) plus `~acct:<id>:<model>` entries for every pinned
   * account. A route with no usable account offers nothing: a named key that
   * does not resolve and no stored account is today's `MISSING_CREDENTIAL → []`.
   */
  override listModels(provider: string): Promise<readonly LlmModelInfo[]> {
    return Promise.resolve().then(async () => {
      const snapshot = this.current()
      const profile = this.profileOf(snapshot, provider)
      const usable: AccountRuntime[] = []
      for (const account of await this.pool.directory.forRoute(provider)) {
        if (account.kind === 'key-ref' || account.kind === 'ambient') {
          try { await this.config.resolveApiKey(provider, profile) }
          catch (error) {
            // A named key that does not resolve cannot serve a request.
            if (error instanceof LlmError && error.code === 'MISSING_CREDENTIAL') continue
            throw error
          }
        }
        usable.push(account)
      }
      const catalog = snapshot.models.getModels(provider)
      const entry = (model: Model<Api>): LlmModelInfo => ({
        provider,
        id: model.id,
        name: model.name,
        inputModalities: [...model.input],
      })
      const pooled = catalog
        .filter(model => usable.some(account => (account.meta.pooled || account.isDefault) && allows(account.meta.models, model.id)))
        .map(entry)
      const pinned = usable.filter(account => account.meta.pinned).flatMap(account => catalog.map(model => ({
        ...entry(model),
        id: pinnedModelId(account.id, model.id),
        badge: { text: accountLabel(account), tone: 'info' as const },
      })))
      return [...pooled, ...pinned]
    })
  }

  override resolveModel(
    provider: string,
    model: string,
    _signal?: AbortSignal,
  ): Promise<LlmResolvedModelInfo> {
    return Promise.resolve().then(() => {
      const snapshot = this.current()
      return this.modelInfo(snapshot, provider, model)
    })
  }

  /**
   * Every account of a route shares one catalog descriptor today (per-account
   * model overrides do not exist), so the capability intersection a failover
   * needs is the descriptor itself.
   */
  private modelInfo(snapshot: PiAiSnapshot, provider: string, model: string): LlmResolvedModelInfo {
    const profile = this.profileOf(snapshot, provider)
    const resolvedModel = this.modelOf(snapshot, provider, model)
    const defaultLevel = describableReasoningLevel(resolvedModel, profile.reasoning)
    // Only a cap the deployment configured is a request default; the
    // catalog's `maxTokens` sizes the model and stops there.
    const configuredMaxTokens = profile.configuredMaxTokens.get(resolvedModel.id)
    return {
      provider,
      id: model,
      name: resolvedModel.name,
      inputModalities: [...resolvedModel.input],
      context: { contextWindow: resolvedModel.contextWindow },
      ...configuredMaxTokens === undefined ? {} : { defaultMaxTokens: configuredMaxTokens },
      ...reasoningInfo(resolvedModel, defaultLevel),
      ...conversationUpdates(resolvedModel),
    }
  }

  override prepareCall(provider: string, model: string, _signal?: AbortSignal): Promise<PreparedAdapterCall> {
    const snapshot = this.current()
    return Promise.resolve({
      model: this.modelInfo(snapshot, provider, model),
      stream: options => this.routeStream(options, snapshot),
    })
  }

  stream(options: GenerateOptions): AsyncIterable<StreamChunk> {
    return this.routeStream(options, this.current())
  }

  /** Route one call across the accounts of its provider; see `accounts/router.ts`. */
  private async * routeStream(options: GenerateOptions, snapshot: PiAiSnapshot): AsyncIterable<StreamChunk> {
    if (options.stop !== undefined) {
      throw new LlmError('llm-pi-ai does not support GenerateOptions.stop', 'UNSUPPORTED_OPTION')
    }
    this.modelOf(snapshot, options.provider, options.model)
    const accounts = await this.pool.directory.forRoute(options.provider)
    yield * this.pool.route(
      accounts,
      {
        route: options.provider,
        model: options.model,
        ...options.sessionId === undefined ? {} : { sessionId: String(options.sessionId) },
        ...options.signal === undefined ? {} : { signal: options.signal },
      },
      (account, observer) => this.streamAttempt(options, snapshot, account, observer),
      (account, observer) => this.forceRefresh(snapshot, options.provider, account, observer, options.signal),
    )
  }

  /**
   * Expire one OAuth account's token under its record lock and refresh it.
   * Only the token the failed attempt used is expired, so concurrent 401s on
   * the same account refresh once: pi-ai re-checks expiry under the lock.
   */
  private async forceRefresh(
    snapshot: PiAiSnapshot,
    provider: string,
    account: AccountRuntime,
    observer: AttemptObserver,
    signal: AbortSignal | undefined,
  ): Promise<void> {
    const used = observer.credentialStamp
    await this.storeFor(account.id).modify(provider, current =>
      Promise.resolve(current?.type === 'oauth' && (used === undefined || current.access === used) ? { ...current, expires: 0 } : undefined))
    try {
      await this.modelsFor(snapshot, account.id).getAuth(provider, signal === undefined ? {} : { signal })
    } catch (error) {
      throw authFailure(error, provider, account)
    }
  }

  /** One SDK attempt as one account. */
  private async * streamAttempt(
    options: GenerateOptions,
    snapshot: PiAiSnapshot,
    account: AccountRuntime,
    observer: AttemptObserver,
  ): AsyncIterable<StreamChunk> {
    // One capture per stream call, taken before any await: the profile, the
    // model descriptor, and the collection all come from the same immutable
    // snapshot, and the credential freezes with them. A configuration change
    // mid-request builds a separate snapshot, so this request finishes under
    // the one it started with and the next call picks up the new one.
    const profile = this.profileOf(snapshot, options.provider)
    const model = this.modelOf(snapshot, options.provider, options.model)
    const models = this.modelsFor(snapshot, account.id)
    const updates = conversationUpdates(model)
    const onReplayDegrade = (reason: string): void => {
      this.config.onReplayDegrade?.({ provider: options.provider, model: options.model, reason })
    }
    // Signed-in accounts bind their replay state (design D4).
    const boundAccount = account.kind === 'oauth' ? account.id : undefined
    const messages = bindReplayToAccount(options.messages, boundAccount, onReplayDegrade)
    // pi-ai collapses Anthropic tool updates without an initially active declaration.
    const tools = options.tools ?? []
    const needsPlaceholder = model.api === 'anthropic-messages' && updates.toolUpdate === 'in-history'
      && tools.every(tool => tool.deferLoading === true)
      && messages.some(message => message.role === 'developer'
        && message.content.some(block => block.type === 'tool-addition' || block.type === 'tool-removal'))
    const request = needsPlaceholder
      ? { ...options, messages, tools: [ANTHROPIC_TOOL_UPDATE_PLACEHOLDER, ...tools] }
      : { ...options, messages }
    const reasoning = resolveReasoningLevel(
      model,
      options.reasoningEffort ?? profile.reasoning,
    )
    // Stored accounts resolve through their own scoped store; the key
    // reference (and, for an `ambient` route, the host's resolver, which
    // answers undefined there) supplies the request-level `apiKey` override.
    const apiKey = account.kind === 'key-ref' || account.kind === 'ambient'
      ? await this.config.resolveApiKey(options.provider, profile)
      : undefined
    if (account.kind === 'oauth') {
      // Pre-flight: runs the locked refresh now, so a failed refresh is a
      // typed failure instead of an opaque stream error.
      let resolved
      try {
        resolved = await models.getAuth(options.provider, options.signal === undefined ? {} : { signal: options.signal })
      } catch (error) {
        throw authFailure(error, options.provider, account)
      }
      if (resolved === undefined) {
        throw new LlmError(
          `llm-pi-ai: account "${accountLabel(account)}" of provider "${options.provider}" holds no credential; sign in again`,
          'MISSING_CREDENTIAL',
        )
      }
      const stored = await this.storeFor(account.id).read(options.provider)
      if (stored?.type === 'oauth') observer.credentialStamp = stored.access
    }

    const consumer = new AbortController()
    const upstream = options.signal === undefined
      ? consumer.signal
      : AbortSignal.any([options.signal, consumer.signal])
    const streamIdleTimeoutMs = profile.streamIdleTimeoutMs
    using watchdog = idleWatchdog(upstream, streamIdleTimeoutMs, 'LLM_STREAM_IDLE_TIMEOUT')

    try {
      const containsImage = messages.some(message => contentHasImage(message.content))
      if (containsImage && !model.input.includes('image')) {
        throw new LlmError(`pi-ai model "${model.id}" does not support image input`, 'UNSUPPORTED_CONTENT')
      }
      const attachments = containsImage ? this.config.resolveAttachments?.() : undefined
      if (containsImage && attachments === undefined) {
        throw new LlmError('pi-ai image input requires the durable attachment service', 'UNSUPPORTED_CONTENT')
      }
      const prefixDigests: PrefixDigests = new Map()
      const converted = attachments === undefined
        ? toPiContext(request, undefined, onReplayDegrade, updates.systemPromptUpdate === 'in-history', prefixDigests)
        : await toPiContext({ ...request, signal: watchdog.signal }, {
          attachments,
          resolveImageAccess: ref => this.config.resolveImageAccess?.(attachments, ref),
          maxRequestImageBytes: profile.maxRequestImageBytes,
          maxRequestImages: profile.maxRequestImages,
          imageOffloadCountQuantum: profile.imageOffloadCountQuantum,
          requestImagePolicy: {
            maxPixels: profile.requestImagePixelBudget,
            maxBytes: profile.requestImageMaxBytes,
          },
        }, onReplayDegrade, updates.systemPromptUpdate === 'in-history', prefixDigests)
      const manualThinking = model.reasoning && reasoning !== undefined && reasoning !== 'off'
        && (model as Model<'anthropic-messages'>).compat?.forceAdaptiveThinking !== true
      const { context, digest } = bindThinkingToPrefix(converted, model.api, prefixDigests, manualThinking, (count) => {
        this.config.onThinkingOmitted?.({ provider: options.provider, model: options.model, count })
      })
      const events = models.streamSimple(model, context, {
        ...profileOptions(profile, reasoning, apiKey),
        ...options.temperature === undefined ? {} : { temperature: options.temperature },
        ...options.maxTokens === undefined ? {} : { maxTokens: options.maxTokens },
        ...options.sessionId === undefined ? {} : { sessionId: String(options.sessionId) },
        // Response capture: status, rate-limit headers, and (non-2xx) a bounded body.
        ...FETCHABLE_APIS.has(model.api)
          ? { fetch: capturingFetch(options.provider, observer) }
          : { onResponse: responseObserver(options.provider, observer) },
        signal: watchdog.signal,
        headers: requestHeaders(profile.headers, options, model.baseUrl, this.config.prepareHeaders),
      })
      // The requested id (pinned or not) is what the durable assistant source records.
      const iterator = toStreamChunks(events, model.contextWindow, options.signal, options.model, digest, {
        ...boundAccount === undefined ? {} : { account: boundAccount },
        enrich: failure => observer.enrich(failure, Date.now()),
      })[Symbol.asyncIterator]()
      let exhausted = false
      try {
        while (true) {
          const result = await watchdog.next(iterator)
          if (result.done) {
            exhausted = true
            return
          }
          yield result.value
        }
      } finally {
        if (!exhausted) {
          consumer.abort('pi-ai stream consumer stopped')
          // A demand the deadline abandoned can stay pending forever, and this
          // generator queues its return behind it; the abort above owns SDK termination.
          /* v8 ignore next -- the detached drain only rejects while unwinding an abandoned stream. */
          void iterator.return(undefined).catch(() => {})
        }
      }
    } catch (error: unknown) {
      if (timeoutOf(watchdog.signal, 'LLM_STREAM_IDLE_TIMEOUT') !== undefined) {
        throw new LlmError(`pi-ai stream idle timeout after ${streamIdleTimeoutMs}ms`, 'TIMEOUT', { cause: error })
      }
      if (options.signal?.aborted) {
        throw new LlmError('pi-ai request aborted by caller', 'ABORTED', { cause: error })
      }
      throw error
    } finally {
      consumer.abort('pi-ai stream consumer stopped')
    }
  }
}
