/**
 * Usage-endpoint registry: which routes have a usage source for signed-in
 * accounts, and how one lookup gets a valid token — through the account's own
 * pi-ai collection (`Models.getAuth`), so pi-ai's locked refresh is reused
 * and no second token manager exists.
 *
 * @module dsh-llm-pi-ai/accounts/usage
 */

import type { Models } from '@earendil-works/pi-ai'
import type { AccountKind } from '../types.ts'
import { fetchClaudeUsage } from './claude.ts'
import { fetchCodexUsage } from './codex.ts'
import { fetchGrokUsage } from './grok.ts'
import { UsageCredentialError } from './http.ts'
import type { FetchedUsage, FetchFn, UsageAuth } from './http.ts'

export { UsageCache, USAGE_FAILURE_TTL_MS, USAGE_TTL_MS } from './cache.ts'
export type { UsageCacheOptions, UsageLoader } from './cache.ts'
export { isExhaustedWindow, mergeWindows } from './headers.ts'
export type { HeaderUsage } from './headers.ts'
export { UsageCredentialError, UsageFetchError } from './http.ts'
export type { FetchedUsage, FetchFn } from './http.ts'

type UsageFetcher = (auth: UsageAuth, fetchFn: FetchFn, signal?: AbortSignal) => Promise<FetchedUsage>

const FETCHERS: Readonly<Record<string, UsageFetcher>> = {
  'openai-codex': fetchCodexUsage,
  'anthropic': fetchClaudeUsage,
  'xai': fetchGrokUsage,
}

/**
 * The usage endpoint fetcher for one account, when it has one: only signed-in
 * (OAuth) accounts of a route with a known endpoint.
 * @param route - the pi-ai provider id.
 * @param kind - the account's kind.
 * @returns the fetcher, or undefined (header-derived usage only).
 */
export function usageFetcherFor(route: string, kind: AccountKind): UsageFetcher | undefined {
  return kind === 'oauth' ? FETCHERS[route] : undefined
}

/**
 * The bearer token of a resolved pi-ai auth: the api key slot, else an
 * `authorization: Bearer` header.
 * @param models - the account-scoped collection.
 * @param route - the provider id.
 * @param signal - caller cancellation.
 * @returns the token.
 * @throws {UsageCredentialError} when the account resolves no token.
 */
export async function accountToken(models: Models, route: string, signal?: AbortSignal): Promise<string> {
  const resolved = await models.getAuth(route, signal === undefined ? undefined : { signal })
  const auth = resolved?.auth
  const header = Object.entries(auth?.headers ?? {}).find(([name]) => name.toLowerCase() === 'authorization')?.[1]
  const token = auth?.apiKey ?? (typeof header === 'string' ? /^Bearer\s+(.+)$/i.exec(header)?.[1] : undefined)
  if (token === undefined || token.length === 0) throw new UsageCredentialError(`usage: account of "${route}" resolves no access token`)
  return token
}
