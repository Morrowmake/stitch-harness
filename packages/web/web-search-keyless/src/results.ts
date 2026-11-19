/**
 * Reading the JSON answers of the API sources into citeable sources.
 * @module @deepseek-ai/dsh-web-search-keyless/results
 */

import { WebError } from '@deepseek-ai/dsh-web'
import type { WebSearchSource } from '@deepseek-ai/dsh-web'
import { isWebUrl } from './transport.ts'

/** Names of the result-entry fields a source reads beside `url` and `title`. */
export interface ResultFields {
  /** Field holding the short excerpt. */
  readonly snippet: string
  /** Field holding the publication time, when the source reports one. */
  readonly publishedAt?: string
}

/**
 * Map a JSON answer whose `results[]` entries carry `url`, `title`, and the named fields. Entries
 * without an http(s) URL and repeated URLs are skipped; blank fields are omitted.
 * @param label - source name used in failure messages.
 * @param body - the response body.
 * @param fields - the source's excerpt and publication-time field names.
 * @returns the sources in answer order.
 * @throws {@link WebError} `WEB_PROVIDER_ERROR` when the body is not a JSON object with a `results` array.
 */
export function readJsonResults(label: string, body: string, fields: ResultFields): WebSearchSource[] {
  let payload: unknown
  try { payload = JSON.parse(body) }
  catch (error: unknown) { throw new WebError(`${label} returned a body that is not JSON`, 'WEB_PROVIDER_ERROR', { cause: error }) }
  if (!isRecord(payload) || !Array.isArray(payload.results)) {
    throw new WebError(`${label} returned JSON without a results list`, 'WEB_PROVIDER_ERROR')
  }
  const sources: WebSearchSource[] = []
  const seen = new Set<string>()
  for (const item of payload.results as unknown[]) {
    if (!isRecord(item)) continue
    const url = nonEmptyString(item.url)
    if (url === undefined || !isWebUrl(url) || seen.has(url)) continue
    seen.add(url)
    const title = nonEmptyString(item.title)
    const snippet = nonEmptyString(item[fields.snippet])
    const publishedAt = fields.publishedAt === undefined ? undefined : nonEmptyString(item[fields.publishedAt])
    sources.push({
      url,
      ...title === undefined ? {} : { title },
      ...snippet === undefined ? {} : { snippet },
      ...publishedAt === undefined ? {} : { publishedAt },
    })
  }
  return sources
}

/** The package's one object guard for untrusted JSON. */
function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

/** A trimmed non-blank string field, or undefined. */
function nonEmptyString(value: unknown): string | undefined {
  if (typeof value !== 'string') return undefined
  const trimmed = value.trim()
  return trimmed.length > 0 ? trimmed : undefined
}
