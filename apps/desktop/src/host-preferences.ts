/** Shared language and theme preferences read from the owned Desktop Host over its standard Web RPC. */

import { randomUUID } from 'node:crypto'

/** Preferences applied before the workspace window becomes visible. */
export interface DesktopHostPreferences {
  readonly localePreference: string | null
  /** Effective Host theme preference; absent or invalid optional theme settings use system appearance. */
  readonly themePreference: 'light' | 'dark' | 'system'
}

/** Read-only preference access bound to one running Desktop Host. */
export interface DesktopHostPreferenceReader {
  /** @returns the live language and theme preferences; every read observes current configuration. */
  read(): Promise<DesktopHostPreferences>
}

function record(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function localePreference(namespaces: unknown[]): string | null {
  const locale: unknown = namespaces.find((item: unknown) => record(item) && item.ns === 'locale')
  if (!record(locale) || !record(locale.value)
    || (locale.value.preference !== undefined && typeof locale.value.preference !== 'string')) {
    throw new Error('desktop preferences: invalid locale preference')
  }
  return locale.value.preference ?? null
}

function themePreference(namespaces: unknown[]): DesktopHostPreferences['themePreference'] {
  const theme = namespaces.find(item => record(item) && item.ns === 'ui-theme')
  if (theme === undefined) return 'system'
  const preference = record(theme) && record(theme.value) ? theme.value.preference : undefined
  if (preference === 'light' || preference === 'dark' || preference === 'system') return preference
  console.warn('desktop appearance: invalid Host theme preference; using system appearance')
  return 'system'
}

/**
 * Connect the native HTTP client to the Desktop Host; every request sends `cookie` explicitly and uses no cookie jar.
 * @param hostUrl - URL of the running Desktop Host; only its origin is used.
 * @param cookie - Desktop-private authentication header for this owned Host.
 * @param send - HTTP client for Host requests.
 * @returns preference reads over one `settings/describe` request each.
 */
export function connectDesktopHostPreferences(
  hostUrl: string,
  cookie: string,
  send: (input: string, init?: RequestInit) => Promise<Response> = fetch,
): DesktopHostPreferenceReader {
  const origin = new URL(hostUrl).origin
  return {
    async read() {
      const rpcId = randomUUID()
      const method = 'settings/describe'
      const response = await send(new URL(`/api/${method}`, origin).href, {
        method: 'POST', redirect: 'error',
        headers: { 'content-type': 'application/json', cookie },
        body: JSON.stringify({ type: 'client-request', rpcId, method, payload: { args: {} } }),
      })
      if (!response.ok) throw new Error('desktop preferences: Web request failed')
      const envelope: unknown = await response.json()
      if (!record(envelope) || envelope.type !== 'server-response' || envelope.rpcId !== rpcId
        || !record(envelope.result) || envelope.result.ok !== true) {
        throw new Error('desktop preferences: Web RPC failed')
      }
      const settings = envelope.result.value
      if (!record(settings) || !Array.isArray(settings.namespaces)) throw new Error('desktop preferences: missing settings namespaces')
      return { localePreference: localePreference(settings.namespaces), themePreference: themePreference(settings.namespaces) }
    },
  }
}
