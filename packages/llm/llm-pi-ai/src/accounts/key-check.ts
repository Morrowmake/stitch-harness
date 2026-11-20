/**
 * The quick authenticated check an API key gets before it is stored and when
 * "Retry now" re-tests it: one model-listing request (OpenRouter, whose
 * listing is public, answers its key endpoint instead) with the discovery
 * header rules and a short deadline. Only a 401/403 (or Gemini's 400
 * `API_KEY_INVALID`) counts as a rejection; anything that keeps the check
 * from running leaves the key unverified rather than refused.
 *
 * @module dsh-llm-pi-ai/accounts/key-check
 */

import { listingRequest, readBounded } from '../discovery.ts'
import type { ApiKeyCheck } from './types.ts'
import type { FetchFn } from './usage/http.ts'

/** How long one key check may take, connection and body together. */
export const KEY_CHECK_DEADLINE_MS = 10_000

/** Where a route's requests go: the endpoint base, its protocol, and deployment headers. */
export interface KeyCheckEndpoint {
  baseURL: string
  api: string
  headers?: Readonly<Record<string, string>>
}

/** A key check's outcome: the wire answer, or a rejection with the HTTP status that refused the key. */
export type KeyCheckOutcome = ApiKeyCheck | { status: 'rejected'; httpStatus: number }

/** OpenRouter's model listing is public, so its key endpoint is the authenticated one. */
function openRouterKeyUrl(baseURL: string): string | undefined {
  let host: string
  try {
    host = new URL(baseURL).hostname
  } catch {
    return undefined
  }
  if (host !== 'openrouter.ai' && !host.endsWith('.openrouter.ai')) return undefined
  const base = baseURL.replace(/\/+$/, '')
  return `${base.endsWith('/v1') ? base.slice(0, -3) : base}/v1/key`
}

/**
 * Ask the provider whether it accepts one API key.
 * @param endpoint - where the route sends requests; `undefined` when unknown.
 * @param key - the normalized key.
 * @param fetchFn - the fetch to use (proxy-aware global in production).
 * @returns `verified`, `rejected` with the refusing status, or `unverified` with why the check could not run.
 */
export async function checkApiKey(endpoint: KeyCheckEndpoint | undefined, key: string, fetchFn: FetchFn): Promise<KeyCheckOutcome> {
  if (endpoint === undefined) return { status: 'unverified', reason: 'unsupported' }
  // OpenRouter takes a bearer key whatever protocol the route speaks.
  const openRouter = openRouterKeyUrl(endpoint.baseURL)
  const listing = listingRequest(endpoint.baseURL, openRouter === undefined ? endpoint.api : 'openai-completions', key, endpoint.headers)
  if (listing === undefined) return { status: 'unverified', reason: 'unsupported' }
  const url = openRouter ?? listing.url
  const signal = AbortSignal.timeout(KEY_CHECK_DEADLINE_MS)
  let response: Response
  try {
    response = await fetchFn(url, { method: 'GET', headers: listing.headers, signal })
  } catch {
    return { status: 'unverified', reason: 'unreachable' }
  }
  if (response.status === 401 || response.status === 403) {
    await response.body?.cancel()
    return { status: 'rejected', httpStatus: response.status }
  }
  let text: string
  try {
    text = await readBounded(response, url)
  } catch {
    return { status: 'unverified', reason: signal.aborted ? 'unreachable' : 'unexpected' }
  }
  if (response.status === 400 && endpoint.api === 'google-generative-ai' && text.includes('API_KEY_INVALID')) {
    return { status: 'rejected', httpStatus: 400 }
  }
  if (response.status >= 500) return { status: 'unverified', reason: 'unreachable' }
  if (!response.ok) return { status: 'unverified', reason: 'unexpected' }
  try {
    JSON.parse(text)
  } catch {
    return { status: 'unverified', reason: 'unexpected' }
  }
  return { status: 'verified' }
}
