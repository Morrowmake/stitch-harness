/**
 * The single HTTP exchange every keyless source makes: one request through the process-wide
 * dispatcher (so the installed outbound proxy policy applies), no cookies or credentials beyond what
 * the source sends explicitly, redirects refused, one per-source deadline over request and body, and
 * a byte cap on the body. Failures become `WebError`s the source chain can route on.
 * @module @deepseek-ai/dsh-web-search-keyless/transport
 */

import { WebError } from '@deepseek-ai/dsh-web'
import { deadline, timeoutOf } from '@deepseek-ai/dsh-timeout'

/**
 * Sent as `User-Agent` to every source: a common desktop browser string, so requests carry no
 * product or installation identifier and the HTML endpoint serves its ordinary markup.
 */
export const BROWSER_USER_AGENT = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:128.0) Gecko/20100101 Firefox/128.0'

/** Largest response body read from a source; search pages and JSON answers are far smaller. */
export const MAX_RESPONSE_BYTES = 2_000_000

/** Code of a source that refused the search because of rate limiting or a bot challenge. */
export const RATE_LIMITED_CODE = 'WEB_SEARCH_RATE_LIMITED'

/** Code of a source that did not answer within the per-source timeout. */
export const TIMEOUT_CODE = 'WEB_SEARCH_TIMEOUT'

/** One request to a source. */
export interface SourceRequest {
  /** Source name used in failure messages. */
  readonly label: string
  /** Absolute request URL. */
  readonly url: URL
  /** HTTP method. */
  readonly method: 'GET' | 'POST'
  /** Request headers in addition to `User-Agent`. */
  readonly headers: Readonly<Record<string, string>>
  /** Form-encoded request body, for a POST. */
  readonly body?: URLSearchParams
  /** Per-source deadline in milliseconds. */
  readonly timeoutMs: number
}

/** A fully read source response. */
export interface SourceResponse {
  readonly status: number
  /** Response body decoded as UTF-8. */
  readonly body: string
}

/**
 * Send one request and read its whole body under one deadline.
 * @param request - the request.
 * @param signal - caller cancellation.
 * @returns the status and decoded body, whatever the status.
 * @throws {@link WebError} `WEB_ABORTED` on caller cancellation, {@link TIMEOUT_CODE} when the
 *   deadline elapses, and `WEB_PROVIDER_ERROR` for a transport failure, redirect, or oversized body.
 */
export async function sendSourceRequest(request: SourceRequest, signal?: AbortSignal): Promise<SourceResponse> {
  if (signal?.aborted === true) throw searchAborted(signal.reason)
  using limit = deadline(signal, request.timeoutMs, TIMEOUT_CODE)
  try {
    const response = await fetch(request.url, {
      method: request.method,
      // A redirect would forward the query, and Marginalia's key, to a target the user never configured.
      redirect: 'error',
      credentials: 'omit',
      headers: { ...request.headers, 'user-agent': BROWSER_USER_AGENT },
      ...request.body === undefined ? {} : { body: request.body },
      signal: limit.signal,
    })
    return { status: response.status, body: await readCapped(request.label, response) }
  } catch (error: unknown) {
    if (error instanceof WebError) throw error
    const timeout = timeoutOf(limit.signal, TIMEOUT_CODE)
    if (timeout !== undefined) {
      throw new WebError(`${request.label} did not answer within ${request.timeoutMs} ms`, TIMEOUT_CODE, { cause: timeout })
    }
    // Not the timeout, so the abort came from the caller.
    if (limit.signal.aborted) throw searchAborted(error)
    throw new WebError(`${request.label} request failed: ${failureDetail(error)}`, 'WEB_PROVIDER_ERROR', { cause: error })
  }
}

/**
 * The failure a caller cancellation produces.
 * @param cause - the abort reason or the error the interrupted request threw.
 * @returns the stable cancellation error.
 */
export function searchAborted(cause: unknown): WebError {
  return new WebError('web search aborted', 'WEB_ABORTED', { cause })
}

/**
 * The failure of a source that refused the search because it rate-limits or challenges the caller.
 * @param label - source name.
 * @param detail - what the source answered.
 * @returns the rate-limit error.
 */
export function rateLimited(label: string, detail: string): WebError {
  return new WebError(`${label} is rate-limiting searches (${detail})`, RATE_LIMITED_CODE)
}

/**
 * Whether a result URL can be cited: an absolute http(s) URL.
 * @param value - the candidate URL.
 * @returns true for an absolute http or https URL.
 */
export function isWebUrl(value: string): boolean {
  if (!URL.canParse(value)) return false
  const { protocol } = new URL(value)
  return protocol === 'http:' || protocol === 'https:'
}

/** Read a response body up to {@link MAX_RESPONSE_BYTES}, failing past it. */
async function readCapped(label: string, response: Response): Promise<string> {
  /* v8 ignore next -- fetch always exposes a body stream for a completed response; the guard is defensive. */
  if (response.body === null) return ''
  const reader = response.body.getReader()
  const decoder = new TextDecoder()
  let total = 0
  let text = ''
  for (;;) {
    const { done, value } = await reader.read()
    if (done) break
    total += value.byteLength
    if (total > MAX_RESPONSE_BYTES) {
      await reader.cancel()
      throw new WebError(`${label} returned more than ${MAX_RESPONSE_BYTES} bytes`, 'WEB_PROVIDER_ERROR')
    }
    text += decoder.decode(value, { stream: true })
  }
  return text + decoder.decode()
}

/**
 * The innermost message of a transport rejection. Undici wraps the system error in `TypeError: fetch
 * failed`; a connection attempted on several addresses nests one error per address, with an empty
 * message, in an `AggregateError`.
 */
function failureDetail(error: unknown): string {
  let current = error
  for (let hop = 0; hop < 4 && current instanceof Error && current.cause !== undefined; hop++) current = current.cause
  if (current instanceof AggregateError) return (current.errors as Error[]).map(attempt => attempt.message).join('; ')
  // fetch rejects with an Error (a TypeError or DOMException) whose cause chain holds Errors.
  return (current as Error).message
}
