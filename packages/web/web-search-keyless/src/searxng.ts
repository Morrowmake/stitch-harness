/**
 * A SearXNG instance through its JSON search format. The deployment names the instance; a
 * self-hosted one keeps queries away from shared public instances.
 * @module @deepseek-ai/dsh-web-search-keyless/searxng
 */

import { WebError } from '@deepseek-ai/dsh-web'
import type { WebSearchSource } from '@deepseek-ai/dsh-web'
import { readJsonResults } from './results.ts'
import { isWebUrl, rateLimited, sendSourceRequest } from './transport.ts'

const LABEL = 'SearXNG'

/** One SearXNG search. */
export interface SearxngSearch {
  readonly query: string
  /** Upper bound on returned sources. */
  readonly limit: number
  /** Instance base URL; `/search` is appended to its path. */
  readonly baseUrl: string
  /** Per-source deadline in milliseconds. */
  readonly timeoutMs: number
}

/**
 * Whether a configured base URL can be searched: an absolute http(s) URL without embedded
 * credentials, which `fetch` refuses to send.
 * @param baseUrl - the configured instance URL.
 * @returns true when searches can be sent to it.
 */
export function isSearxngBaseUrl(baseUrl: string): boolean {
  if (!isWebUrl(baseUrl)) return false
  const { username, password } = new URL(baseUrl)
  return username === '' && password === ''
}

/**
 * Search a SearXNG instance.
 * @param search - the query, limit, instance, and deadline.
 * @param signal - caller cancellation.
 * @returns up to `limit` results.
 * @throws {@link WebError} `WEB_PROVIDER_MISCONFIGURED` for HTTP 403, which an instance without
 *   the JSON format answers, `WEB_SEARCH_RATE_LIMITED` for HTTP 429, `WEB_PROVIDER_ERROR` for
 *   another status or a malformed body, and the transport failures.
 */
export async function searchSearxng(search: SearxngSearch, signal?: AbortSignal): Promise<WebSearchSource[]> {
  const url = new URL(search.baseUrl)
  url.pathname = `${url.pathname.replace(/\/+$/u, '')}/search`
  url.search = ''
  url.hash = ''
  url.searchParams.set('q', search.query)
  url.searchParams.set('format', 'json')
  const response = await sendSourceRequest({
    label: LABEL,
    url,
    method: 'GET',
    headers: { accept: 'application/json' },
    timeoutMs: search.timeoutMs,
  }, signal)
  if (response.status === 403) {
    throw new WebError(
      `${LABEL} at ${url.origin} refused the JSON format (HTTP 403). The instance must list json under`
      + ' search.formats in its settings.yml; guide the user to enable it or to configure another instance.',
      'WEB_PROVIDER_MISCONFIGURED',
    )
  }
  if (response.status === 429) throw rateLimited(LABEL, 'HTTP 429')
  if (response.status !== 200) throw new WebError(`${LABEL} answered HTTP ${response.status}`, 'WEB_PROVIDER_ERROR')
  return readJsonResults(LABEL, response.body, { snippet: 'content', publishedAt: 'publishedDate' }).slice(0, search.limit)
}
