/**
 * Keyless web search for `ctx.web`: SearXNG, DuckDuckGo's HTML endpoint, and Marginalia's shared
 * public key, tried in order behind one search provider, so search works without an account, a
 * signup, or a paid key. It contributes to the `ctx.web` registry without owning the service.
 * @module @deepseek-ai/dsh-web-search-keyless
 */

import type { Context, Volatile } from '@deepseek-ai/cordis'
import z from '@deepseek-ai/schemastery'
import { MAX_TIMER_DELAY_MS } from '@deepseek-ai/dsh-timeout'
import type {} from '@deepseek-ai/dsh-web'
import { MARGINALIA_PUBLIC_KEY } from './marginalia.ts'
import { KEYLESS_SOURCE_IDS, KeylessSearchProvider } from './provider.ts'
import type { KeylessSourceId } from './provider.ts'

export type { KeylessSourceId } from './provider.ts'

/** Cordis plugin name used by loader diagnostics. */
export const name = 'web-search-keyless'

/** The web seam this provider registers into. */
export const inject = ['web']

/** Plugin config; every field is optional. */
export interface Config {
  /**
   * Base URL of a SearXNG instance with the `json` search format enabled. When it is set and no
   * {@link sources} order is, searches go to this instance only. Each search reads the current
   * value, so a saved setting applies to the next search without remounting the plugin.
   */
  searxngUrl: Volatile<string | undefined>
  /** `API-Key` header sent to Marginalia; `public` is the shared key Marginalia offers without signup. */
  marginaliaApiKey?: string
  /**
   * Sources to try, in order; each source failure other than cancellation moves to the next.
   * Omitted or empty: SearXNG alone when `searxngUrl` is set, otherwise DuckDuckGo, then Marginalia.
   */
  sources?: KeylessSourceId[]
  /** Per-source timeout in milliseconds, over request and response body. */
  timeout?: number
  /** Upper bound on the results of one search, applied below the caller's own bound. */
  maxResults?: number
}

export const Config = z.object({
  searxngUrl: z.string().volatile(),
  marginaliaApiKey: z.string().role('secret').default(MARGINALIA_PUBLIC_KEY),
  sources: z.array(z.union(KEYLESS_SOURCE_IDS)),
  timeout: z.natural().min(1).max(MAX_TIMER_DELAY_MS).default(10_000),
  maxResults: z.natural().min(1).max(100).default(10),
})

/** Register the keyless search provider with `ctx.web`. */
export function apply(ctx: Context, config: Config): void {
  // schemastery (Config) has already filled every defaulted field and resolved `sources` to an array.
  const { searxngUrl, marginaliaApiKey, sources, timeout, maxResults } = config as Required<Config>
  ctx.web.registerSearchProvider(new KeylessSearchProvider(() => {
    // The provider ignores a URL it cannot search, such as an empty one.
    const url = searxngUrl.get()
    return {
      ...url === undefined ? {} : { searxngUrl: url },
      sources,
      marginaliaApiKey,
      timeoutMs: timeout,
      maxResults,
      onSourceFailure: (source, error) => {
        ctx.logger.debug(`web-search-keyless: ${source} failed (${error.code}): ${error.message}`)
      },
    }
  }))
}
