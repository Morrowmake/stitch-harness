/**
 * The keyless search provider: one `ctx.web` search provider that tries its sources in order and
 * answers with the first that succeeds. `ctx.web` selects one provider per search and has no
 * fallback between providers, so the source chain lives here, behind one registered id.
 * @module @deepseek-ai/dsh-web-search-keyless/provider
 */

import { WebError } from '@deepseek-ai/dsh-web'
import type { WebSearchProvider, WebSearchRequest, WebSearchResult, WebSearchSource } from '@deepseek-ai/dsh-web'
import { DUCKDUCKGO_HTML_URL, searchDuckDuckGo } from './duckduckgo.ts'
import { MARGINALIA_API_URL, searchMarginalia } from './marginalia.ts'
import { isSearxngBaseUrl, searchSearxng } from './searxng.ts'
import { RATE_LIMITED_CODE } from './transport.ts'

/** Stable id this provider registers under. */
export const KEYLESS_PROVIDER_ID = 'keyless'

/** Every source the provider can search, in the order a configuration may name them. */
export const KEYLESS_SOURCE_IDS = ['searxng', 'duckduckgo', 'marginalia'] as const

/** One search source. */
export type KeylessSourceId = typeof KEYLESS_SOURCE_IDS[number]

/** Resolved provider options (the plugin's Config supplies the defaults). */
export interface KeylessSearchOptions {
  /** SearXNG instance base URL; SearXNG is unusable without a valid one. */
  readonly searxngUrl?: string
  /** Marginalia `API-Key` header value; Marginalia is unusable when it is empty. */
  readonly marginaliaApiKey: string
  /**
   * Sources to try, in order. Omitted or empty: SearXNG alone when {@link searxngUrl} is usable,
   * otherwise DuckDuckGo, then Marginalia.
   */
  readonly sources?: readonly KeylessSourceId[]
  /** Per-source deadline in milliseconds, over request and body. */
  readonly timeoutMs: number
  /** Upper bound on returned sources, applied below the request's own `maxResults`. */
  readonly maxResults: number
  /** DuckDuckGo HTML endpoint; defaults to {@link DUCKDUCKGO_HTML_URL}. */
  readonly duckduckgoUrl?: string
  /** Marginalia API base; defaults to {@link MARGINALIA_API_URL}. */
  readonly marginaliaUrl?: string
  /** Observe one source's failure before the chain moves on or gives up. */
  readonly onSourceFailure?: (source: KeylessSourceId, error: WebError) => void
}

/**
 * The sources a search tries, in order: the configured order, or the default order, with sources
 * that cannot run (SearXNG without a usable URL, Marginalia without a key) and repeats removed.
 * @param options - the provider options.
 * @returns the usable sources, first tried first.
 */
export function searchOrder(options: KeylessSearchOptions): KeylessSourceId[] {
  const searxngUsable = options.searxngUrl !== undefined && isSearxngBaseUrl(options.searxngUrl)
  const requested: readonly KeylessSourceId[] = options.sources !== undefined && options.sources.length > 0
    ? options.sources
    : searxngUsable ? ['searxng'] : ['duckduckgo', 'marginalia']
  const usable = requested.filter(source =>
    source === 'duckduckgo'
    || (source === 'searxng' && searxngUsable)
    || (source === 'marginalia' && options.marginaliaApiKey.length > 0))
  return [...new Set(usable)]
}

/** The keyless search provider. */
export class KeylessSearchProvider implements WebSearchProvider {
  readonly id = KEYLESS_PROVIDER_ID
  /** Picker description: what this provider suits and what it costs or cannot do. */
  readonly description: NonNullable<WebSearchProvider['description']> = {
    en: 'Free, with no account or key. Searches a configured SearXNG instance, otherwise DuckDuckGo with Marginalia as fallback; public sources may rate-limit.',
    zh: '免费，无需账号或密钥。已配置 SearXNG 实例时使用它，否则使用 DuckDuckGo，并以 Marginalia 作为后备；公共来源可能限流。',
    ja: '無料で、アカウントもキーも不要です。SearXNG インスタンスが設定されていればそれを使い、なければ DuckDuckGo を使って Marginalia をフォールバックにします。公開ソースはレート制限されることがあります。',
    es: 'Gratis, sin cuenta ni clave. Busca en una instancia de SearXNG configurada o, si no la hay, en DuckDuckGo con Marginalia como respaldo; las fuentes públicas pueden limitar la frecuencia.',
    fr: 'Gratuit, sans compte ni clé. Interroge une instance SearXNG configurée, sinon DuckDuckGo avec Marginalia en secours ; les sources publiques peuvent limiter le débit.',
    de: 'Kostenlos, ohne Konto oder Schlüssel. Sucht über eine konfigurierte SearXNG-Instanz, sonst über DuckDuckGo mit Marginalia als Ausweichquelle; öffentliche Quellen können drosseln.',
    ru: 'Бесплатно, без учётной записи и ключа. Ищет через настроенный экземпляр SearXNG, иначе через DuckDuckGo с резервным Marginalia; публичные источники могут ограничивать частоту запросов.',
    pt: 'Gratuito, sem conta nem chave. Pesquisa numa instância SearXNG configurada ou, sem ela, no DuckDuckGo com o Marginalia como alternativa; fontes públicas podem limitar a frequência.',
  }

  /**
   * @param resolveOptions - the options for the next operation, read once at each operation's entry
   *   so one search never mixes two settings snapshots. A thunk because a saved setting (the SearXNG
   *   URL) must reach the next search without re-registering the provider.
   */
  constructor(private readonly resolveOptions: () => KeylessSearchOptions) {}

  /** Usable when at least one source can run; checks configuration only. */
  available(): boolean {
    return searchOrder(this.resolveOptions()).length > 0
  }

  /**
   * Try each source in {@link searchOrder} and answer with the first that succeeds, even with no
   * results. Caller cancellation stops the chain; any other source failure moves to the next source.
   * @param request - the query and optional result bound.
   * @param signal - caller cancellation.
   * @returns the answering source's results, at most the smaller of the two bounds.
   * @throws {@link WebError} `WEB_ABORTED` on cancellation, `WEB_PROVIDER_UNAVAILABLE` when no source
   *   can run, the only source's own failure, or a combined failure naming every source.
   */
  async search(request: WebSearchRequest, signal?: AbortSignal): Promise<WebSearchResult> {
    const options = this.resolveOptions()
    const order = searchOrder(options)
    const limit = Math.max(1, Math.min(request.maxResults ?? options.maxResults, options.maxResults))
    const failures: WebError[] = []
    for (const source of order) {
      try {
        return { sources: await searchSource(options, source, request.query, limit, signal), truncated: false }
      } catch (error: unknown) {
        if (!(error instanceof WebError) || error.code === 'WEB_ABORTED') throw error
        options.onSourceFailure?.(source, error)
        failures.push(error)
      }
    }
    const [only] = failures
    if (only === undefined) {
      throw new WebError('no keyless search source is usable; configure web-search-keyless.sources', 'WEB_PROVIDER_UNAVAILABLE')
    }
    if (failures.length === 1) throw only
    const rateLimited = failures.every(failure => failure.code === RATE_LIMITED_CODE)
    throw new WebError(
      `Web search failed on every source: ${failures.map(failure => failure.message).join('; ')}.`
      + ' Public sources limit request rates; retry later, or guide the user to configure a SearXNG instance'
      + ' in web-search-keyless.searxngUrl.',
      rateLimited ? RATE_LIMITED_CODE : 'WEB_PROVIDER_ERROR',
      { cause: new AggregateError(failures, 'every keyless search source failed') },
    )
  }
}

/** Run one source with one operation's options. */
async function searchSource(
  options: KeylessSearchOptions, source: KeylessSourceId, query: string, limit: number, signal: AbortSignal | undefined,
): Promise<WebSearchSource[]> {
  const { timeoutMs } = options
  switch (source) {
    case 'searxng':
      // searchOrder() lists SearXNG only with a usable URL.
      return await searchSearxng({ query, limit, baseUrl: options.searxngUrl as string, timeoutMs }, signal)
    case 'duckduckgo':
      return await searchDuckDuckGo({ query, limit, endpoint: options.duckduckgoUrl ?? DUCKDUCKGO_HTML_URL, timeoutMs }, signal)
    case 'marginalia':
      return await searchMarginalia({
        query, limit, endpoint: options.marginaliaUrl ?? MARGINALIA_API_URL, apiKey: options.marginaliaApiKey, timeoutMs,
      }, signal)
  }
}
