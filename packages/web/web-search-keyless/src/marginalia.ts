/**
 * Marginalia Search through its JSON API. The shared `public` key needs no signup but shares one
 * rate limit among all its users; Marginalia licenses results under CC-BY-NC-SA 4.0.
 * @module @deepseek-ai/dsh-web-search-keyless/marginalia
 */

import { WebError } from '@deepseek-ai/dsh-web'
import type { WebSearchSource } from '@deepseek-ai/dsh-web'
import { readJsonResults } from './results.ts'
import { rateLimited, sendSourceRequest } from './transport.ts'

/** Default Marginalia API base; `/search` is appended. */
export const MARGINALIA_API_URL = 'https://api2.marginalia-search.com'

/** The shared key Marginalia offers without signup. */
export const MARGINALIA_PUBLIC_KEY = 'public'

/** Largest `count` the API accepts. */
const MAX_COUNT = 100

const LABEL = 'Marginalia'

/** One Marginalia search. */
export interface MarginaliaSearch {
  readonly query: string
  /** Upper bound on returned sources, sent as `count`. */
  readonly limit: number
  /** API base. */
  readonly endpoint: string
  /** Value of the `API-Key` header. */
  readonly apiKey: string
  /** Per-source deadline in milliseconds. */
  readonly timeoutMs: number
}

/**
 * Search Marginalia.
 * @param search - the query, limit, endpoint, key, and deadline.
 * @param signal - caller cancellation.
 * @returns up to `limit` results.
 * @throws {@link WebError} `WEB_SEARCH_RATE_LIMITED` for HTTP 429 or 503, `WEB_PROVIDER_ERROR` for
 *   a rejected key, another status, or a malformed body, and the transport failures.
 */
export async function searchMarginalia(search: MarginaliaSearch, signal?: AbortSignal): Promise<WebSearchSource[]> {
  const url = new URL(`${search.endpoint.replace(/\/+$/u, '')}/search`)
  url.searchParams.set('query', search.query)
  url.searchParams.set('count', String(Math.min(search.limit, MAX_COUNT)))
  const response = await sendSourceRequest({
    label: LABEL,
    url,
    method: 'GET',
    headers: { 'accept': 'application/json', 'api-key': search.apiKey },
    timeoutMs: search.timeoutMs,
  }, signal)
  if (response.status === 429 || response.status === 503) {
    throw rateLimited(LABEL, `HTTP ${response.status}${statusDetail(response.body)}`)
  }
  if (response.status === 401 || response.status === 403) {
    throw new WebError(
      `${LABEL} rejected the configured API key (HTTP ${response.status}); the user can restore the shared "public" key in web-search-keyless.marginaliaApiKey`,
      'WEB_PROVIDER_ERROR',
    )
  }
  if (response.status !== 200) {
    throw new WebError(`${LABEL} answered HTTP ${response.status}${statusDetail(response.body)}`, 'WEB_PROVIDER_ERROR')
  }
  // Marginalia names the excerpt `description` and reports no publication time.
  return readJsonResults(LABEL, response.body, { snippet: 'description' }).slice(0, search.limit)
}

/** A short plain-text error body (Marginalia answers limits with text such as `Daily Limit Exceeded`). */
function statusDetail(body: string): string {
  const text = body.trim()
  return text.length > 0 && text.length <= 200 && !text.startsWith('<') ? `: ${text}` : ''
}
