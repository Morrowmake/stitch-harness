/**
 * Local inference servers the first-run provider picker offers before any
 * hosted provider: Ollama and LM Studio on their default loopback ports.
 *
 * The probe runs only when a caller asks (the picker is open), reaches only
 * fixed `localhost` URLs, and gives each server a short deadline, so a
 * machine without them answers "not running" within that deadline and
 * nothing leaves the machine.
 *
 * @module dsh-llm-pi-ai/accounts/local-probe
 */

import type { FetchFn } from './usage/index.ts'
import type { LocalProviderProbeView } from './types.ts'

/** Per-server deadline: loopback answers in milliseconds, a closed port refuses at once. */
export const LOCAL_PROBE_TIMEOUT_MS = 1_500

/** Largest listing accepted from a local server. */
const MAX_LISTING_BYTES = 1024 * 1024

/** One local server the picker knows: where to list its models and the OpenAI-compatible endpoint a route uses. */
interface LocalServer {
  readonly id: LocalProviderProbeView['id']
  readonly displayName: string
  /** Native listing endpoint. */
  readonly listURL: string
  /** OpenAI-compatible endpoint stored as the route's `baseURL`. */
  readonly baseURL: string
  /** Model ids from the listing body; `undefined` when the body is not this server's listing. */
  readonly read: (body: unknown) => string[] | undefined
}

/** Ids of a `{ <field>: [{ <key>: string }] }` listing. */
function idsOf(body: unknown, field: string, key: string): string[] | undefined {
  if (typeof body !== 'object' || body === null) return undefined
  const rows: unknown = (body as Record<string, unknown>)[field]
  if (!Array.isArray(rows)) return undefined
  const ids: string[] = []
  for (const row of rows as unknown[]) {
    const id = typeof row === 'object' && row !== null ? (row as Record<string, unknown>)[key] : undefined
    if (typeof id === 'string' && id.length > 0 && !ids.includes(id)) ids.push(id)
  }
  return ids
}

/** The servers probed, in the order the picker lists them. */
export const LOCAL_SERVERS: readonly LocalServer[] = [
  {
    id: 'ollama',
    displayName: 'Ollama',
    listURL: 'http://localhost:11434/api/tags',
    baseURL: 'http://localhost:11434/v1',
    read: body => idsOf(body, 'models', 'name'),
  },
  {
    id: 'lmstudio',
    displayName: 'LM Studio',
    listURL: 'http://localhost:1234/v1/models',
    baseURL: 'http://localhost:1234/v1',
    read: body => idsOf(body, 'data', 'id'),
  },
]

/**
 * Ask one local server for its models.
 * @param server - the server to probe.
 * @param fetchFn - the fetch implementation.
 * @param signal - caller cancellation.
 * @param timeoutMs - the server's deadline.
 * @returns the server's view; `running: false` for any refusal, timeout, or foreign reply.
 */
async function probeOne(
  server: LocalServer, fetchFn: FetchFn, signal: AbortSignal | undefined, timeoutMs: number,
): Promise<LocalProviderProbeView> {
  const absent: LocalProviderProbeView = {
    id: server.id, displayName: server.displayName, baseURL: server.baseURL, running: false, models: [],
  }
  const deadline = AbortSignal.timeout(timeoutMs)
  try {
    const response = await fetchFn(server.listURL, {
      headers: { accept: 'application/json' },
      signal: signal === undefined ? deadline : AbortSignal.any([signal, deadline]),
    })
    if (!response.ok) return absent
    const text = await response.text()
    if (text.length > MAX_LISTING_BYTES) return absent
    const models = server.read(JSON.parse(text) as unknown)
    if (models === undefined) return absent
    return { ...absent, running: true, models }
  } catch {
    // Refused, timed out, cancelled, or not JSON: the picker shows the server as not running.
    return absent
  }
}

/**
 * Probe every known local server concurrently.
 * @param fetchFn - the fetch implementation.
 * @param signal - caller cancellation.
 * @param timeoutMs - per-server deadline.
 * @returns one view per server, in {@link LOCAL_SERVERS} order.
 */
export function probeLocalServers(
  fetchFn: FetchFn, signal?: AbortSignal, timeoutMs = LOCAL_PROBE_TIMEOUT_MS,
): Promise<LocalProviderProbeView[]> {
  return Promise.all(LOCAL_SERVERS.map(server => probeOne(server, fetchFn, signal, timeoutMs)))
}
