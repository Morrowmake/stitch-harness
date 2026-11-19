/**
 * DuckDuckGo through its server-rendered HTML endpoint, which needs no key and runs no script.
 * DuckDuckGo offers no official search API, so this source reads the result markup and treats
 * a challenge page or a refusing status as rate limiting, which the source chain falls back from.
 * @module @deepseek-ai/dsh-web-search-keyless/duckduckgo
 */

import { WebError } from '@deepseek-ai/dsh-web'
import type { WebSearchSource } from '@deepseek-ai/dsh-web'
import { classesOf, innerHtml, openingTags, textOf } from './html.ts'
import type { OpeningTag } from './html.ts'
import { isWebUrl, rateLimited, sendSourceRequest } from './transport.ts'

/** Default DuckDuckGo HTML endpoint. */
export const DUCKDUCKGO_HTML_URL = 'https://html.duckduckgo.com/html/'

const LABEL = 'DuckDuckGo'

/** Statuses DuckDuckGo answers a throttled or challenged caller with; 202 carries the challenge page. */
const REFUSING_STATUSES: ReadonlySet<number> = new Set([202, 403, 429])

/** Markers of the bot-challenge ("anomaly") page, which can also arrive with status 200. */
const CHALLENGE_MARKERS = ['anomaly-modal', 'anomaly.js', 'id="challenge-form"']

/** One DuckDuckGo search. */
export interface DuckDuckGoSearch {
  readonly query: string
  /** Upper bound on returned sources. */
  readonly limit: number
  /** HTML endpoint. */
  readonly endpoint: string
  /** Per-source deadline in milliseconds. */
  readonly timeoutMs: number
}

/**
 * Search DuckDuckGo with a form POST, which carries the query in the body rather than the URL.
 * @param search - the query, limit, endpoint, and deadline.
 * @param signal - caller cancellation.
 * @returns up to `limit` organic results.
 * @throws {@link WebError} `WEB_SEARCH_RATE_LIMITED` for a refusing status or a challenge page,
 *   `WEB_PROVIDER_ERROR` for another status or an unrecognized page, and the transport failures.
 */
export async function searchDuckDuckGo(search: DuckDuckGoSearch, signal?: AbortSignal): Promise<WebSearchSource[]> {
  const response = await sendSourceRequest({
    label: LABEL,
    url: new URL(search.endpoint),
    method: 'POST',
    headers: { 'accept': 'text/html', 'content-type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ q: search.query }),
    timeoutMs: search.timeoutMs,
  }, signal)
  if (REFUSING_STATUSES.has(response.status)) {
    throw rateLimited(LABEL, isChallengePage(response.body) ? `HTTP ${response.status} bot challenge` : `HTTP ${response.status}`)
  }
  if (response.status !== 200) throw new WebError(`${LABEL} answered HTTP ${response.status}`, 'WEB_PROVIDER_ERROR')
  if (isChallengePage(response.body)) throw rateLimited(LABEL, 'bot challenge')
  return parseDuckDuckGoResults(response.body).slice(0, search.limit)
}

/**
 * Whether a page is DuckDuckGo's bot challenge.
 * @param html - the response body.
 * @returns true when the page carries a challenge marker.
 */
export function isChallengePage(html: string): boolean {
  return CHALLENGE_MARKERS.some(marker => html.includes(marker))
}

/**
 * Read the organic results of a DuckDuckGo HTML results page in page order. Ads, results without a
 * citeable http(s) URL, and repeated URLs are skipped.
 * @param html - the results page.
 * @returns the results with their titles and snippets.
 * @throws {@link WebError} `WEB_PROVIDER_ERROR` when the page is neither a results page nor a
 *   no-results page, which is how a markup change shows.
 */
export function parseDuckDuckGoResults(html: string): WebSearchSource[] {
  const tags = openingTags(html)
  const blockStarts = tags.filter(tag => tag.name === 'div' && classesOf(tag).includes('result'))
  const sources: WebSearchSource[] = []
  const seen = new Set<string>()
  for (const [index, block] of blockStarts.entries()) {
    if (classesOf(block).some(token => token.startsWith('result--ad'))) continue
    const blockEnd = blockStarts[index + 1]?.start ?? html.length
    const inside = tags.filter(tag => tag.start > block.start && tag.start < blockEnd)
    const source = readResult(html, inside)
    if (source === undefined || seen.has(source.url)) continue
    seen.add(source.url)
    sources.push(source)
  }
  // A page with neither result blocks, the results container, nor the no-results notice is not a results page.
  const resultsPage = tags.some(tag => tag.attributes.get('id') === 'links' || classesOf(tag).includes('no-results'))
  if (sources.length === 0 && blockStarts.length === 0 && !resultsPage) {
    throw new WebError(`${LABEL} returned a page without recognizable results`, 'WEB_PROVIDER_ERROR')
  }
  return sources
}

/**
 * Resolve a result link to the page it cites. DuckDuckGo may wrap the target in its `/l/` redirect,
 * carrying it in the `uddg` parameter, and links ads through `/y.js`.
 * @param href - the result link's `href`, entity-decoded.
 * @returns the cited http(s) URL, or undefined for an ad or an unusable link.
 */
export function resolveResultUrl(href: string): string | undefined {
  const absolute = href.startsWith('//') ? `https:${href}` : href
  if (!URL.canParse(absolute, 'https://duckduckgo.com/')) return undefined
  const url = new URL(absolute, 'https://duckduckgo.com/')
  if (url.hostname === 'duckduckgo.com' || url.hostname.endsWith('.duckduckgo.com')) {
    const target = url.pathname === '/l/' ? url.searchParams.get('uddg') : null
    return target !== null && isWebUrl(target) ? target : undefined
  }
  return isWebUrl(url.href) ? url.href : undefined
}

/** Read the title link and snippet of one result block. */
function readResult(html: string, tags: readonly OpeningTag[]): WebSearchSource | undefined {
  const link = tags.find(tag => tag.name === 'a' && classesOf(tag).includes('result__a'))
  const href = link?.attributes.get('href')
  if (link === undefined || href === undefined) return undefined
  const url = resolveResultUrl(href)
  if (url === undefined) return undefined
  const title = textOf(innerHtml(html, link) ?? '')
  const snippetTag = tags.find(tag => classesOf(tag).includes('result__snippet'))
  const snippet = snippetTag === undefined ? '' : textOf(innerHtml(html, snippetTag) ?? '')
  return {
    url,
    ...title.length > 0 ? { title } : {},
    ...snippet.length > 0 ? { snippet } : {},
  }
}

