/**
 * Response capture for one attempt. pi-ai flattens HTTP failures to text, so
 * the attempt hands pi-ai a wrapping `fetch` (on the APIs that accept one)
 * that records status, whitelisted rate-limit headers and, for non-2xx only,
 * a bounded body read that is parsed immediately and never stored. APIs that
 * reject a custom `fetch` fall back to pi-ai's `onResponse` (status + headers).
 *
 * @module dsh-llm-pi-ai/accounts/capture
 */

import type { Api, ProviderResponse } from '@earendil-works/pi-ai'
import type { Observation } from './runtime.ts'
import { isWhitelistedHeader, rateLimitDiagnostics, refusalReset, retryAfterInstant, windowsFromHeaders } from './ratelimit.ts'

/** APIs whose pi-ai implementation accepts a custom `fetch`; Google adapters throw on one. */
export const FETCHABLE_APIS: ReadonlySet<Api> = new Set<Api>([
  'anthropic-messages',
  'openai-completions',
  'openai-responses',
  'azure-openai-responses',
  'openai-codex-responses',
  'mistral-conversations',
])

/** Largest non-2xx body prefix read for reset hints. */
export const MAX_ERROR_BODY_BYTES = 64 * 1024

/** Where observations of one attempt go. */
export interface ObservationSink {
  observe(observation: Observation): void
  /** A refusal whose reset nothing parsed: rate-limit headers + body head, no auth headers. */
  diagnose?(detail: string): void
}

/** Copy only the rate-limit whitelist. */
function whitelisted(source: Headers | Readonly<Record<string, string>>): Headers {
  const kept = new Headers()
  const entries = source instanceof Headers ? [...source.entries()] : Object.entries(source)
  for (const [name, value] of entries) if (isWhitelistedHeader(name)) kept.set(name, value)
  return kept
}

/** Read at most {@link MAX_ERROR_BODY_BYTES} of a response body as text. */
async function boundedText(response: Response): Promise<string> {
  const reader = response.body?.getReader()
  if (reader === undefined) return ''
  const chunks: Uint8Array[] = []
  let size = 0
  try {
    while (size < MAX_ERROR_BODY_BYTES) {
      const { done, value } = await reader.read()
      if (done) break
      chunks.push(value)
      size += value.byteLength
    }
  } finally {
    void reader.cancel().catch(() => {})
  }
  const joined = new Uint8Array(Math.min(size, MAX_ERROR_BODY_BYTES))
  let offset = 0
  for (const chunk of chunks) {
    const part = chunk.subarray(0, joined.byteLength - offset)
    joined.set(part, offset)
    offset += part.byteLength
    if (offset >= joined.byteLength) break
  }
  return new TextDecoder().decode(joined)
}

/**
 * Build one observation; the body (non-2xx only) is parsed here and dropped.
 * @param route - the provider route the attempt used.
 * @param status - the HTTP status of the response.
 * @param headers - the whitelisted rate-limit headers of the response.
 * @param body - the bounded body text of a non-2xx response; undefined for 2xx or when unread.
 * @param now - the observation instant in epoch milliseconds.
 * @param sink - receives a diagnostic for a 429/402 refusal whose reset nothing parsed.
 * @returns the observation with status, reset hints, and usage windows.
 */
export function observationOf(
  route: string,
  status: number,
  headers: Headers,
  body: string | undefined,
  now: number,
  sink?: ObservationSink,
): Observation {
  const ok = status >= 200 && status < 300
  const retryAfterAt = retryAfterInstant(headers, now)
  const resetAt = ok ? undefined : refusalReset(route, headers, body ?? '', now)
  if (!ok && (status === 429 || status === 402) && resetAt === undefined) sink?.diagnose?.(rateLimitDiagnostics(headers, body ?? ''))
  return {
    at: now,
    status,
    ok,
    ...retryAfterAt === undefined ? {} : { retryAfterAt },
    ...resetAt === undefined ? {} : { resetAt },
    windows: windowsFromHeaders(headers, now),
  }
}

/** Report one response to `sink`, reading a bounded clone of a non-2xx body. */
async function observeResponse(route: string, sink: ObservationSink, response: Response, now: () => number): Promise<void> {
  const headers = whitelisted(response.headers)
  const body = response.ok ? undefined : await boundedText(response.clone())
  sink.observe(observationOf(route, response.status, headers, body, now(), sink))
}

/**
 * A `fetch` delegating to the global one (proxy-aware dispatcher) that
 * reports every response to `sink`. 2xx bodies are never read.
 * @param route - the provider route the attempt uses.
 * @param sink - receives one observation per response.
 * @param inner - the `fetch` that performs the request; defaults to the global one.
 * @param now - clock for observation instants, in epoch milliseconds.
 * @returns a `fetch` that answers the inner response unchanged.
 */
export function capturingFetch(
  route: string,
  sink: ObservationSink,
  inner: typeof fetch = globalThis.fetch,
  now: () => number = Date.now,
): typeof fetch {
  return async (input, init) => {
    const response = await inner(input, init)
    try {
      await observeResponse(route, sink, response, now)
    } catch (_captureFailure) {
      // Capture is best-effort; the request's own outcome must not depend on it.
    }
    return response
  }
}

/**
 * pi-ai `onResponse` fallback for APIs without a fetch hook: status + headers only.
 * @param route - the provider route the attempt uses.
 * @param sink - receives one observation per response.
 * @param now - clock for observation instants, in epoch milliseconds.
 * @returns an `onResponse` callback that reports each response to `sink`.
 */
export function responseObserver(route: string, sink: ObservationSink, now: () => number = Date.now): (response: ProviderResponse) => void {
  return (response) => { sink.observe(observationOf(route, response.status, whitelisted(response.headers), undefined, now(), sink)) }
}
