/**
 * Account ids and the credential-record keys they map to (design D1): the
 * legacy record `llm-pi-ai/<route>` is account `main`; every other stored
 * account lives at `llm-pi-ai/<route>--<accountId>`.
 *
 * @module dsh-llm-pi-ai/accounts/keys
 */

import { randomBytes } from 'node:crypto'
import { credentialKey, credentialKeyId, credentialKeyScope, isCredentialKeySegment } from '@deepseek-ai/dsh-credentials'
import type { CredentialKey } from '@deepseek-ai/dsh-credentials'
import type { AccountId } from './types.ts'

/** Record scope of every credential this adapter family stores. */
export const RECORD_SCOPE = 'llm-pi-ai'
/** The legacy single-record account. */
export const MAIN_ACCOUNT = 'main'
/** Virtual account backed by the profile's `apiKeyEnv` reference. */
export const ENV_ACCOUNT = 'env'
/** Virtual account backed by pi-ai's ambient discovery. */
export const AMBIENT_ACCOUNT = 'ambient'

const RANDOM_ID = /^[a-z0-9]{8,16}$/
const SEPARATOR = '--'

/**
 * Whether `id` is a well-formed account id (`main`, `env`, `ambient`, or 8-16 `[a-z0-9]`).
 * @param id - the candidate account id.
 * @returns true when the id matches the account id grammar.
 */
export function isAccountId(id: string): boolean {
  return id === MAIN_ACCOUNT || id === ENV_ACCOUNT || id === AMBIENT_ACCOUNT || RANDOM_ID.test(id)
}

/**
 * Whether the account is stored as a credential record (not `env`/`ambient`).
 * @param id - the account id.
 * @returns true for `main` and random account ids.
 */
export function isStoredAccountId(id: string): boolean {
  return id === MAIN_ACCOUNT || RANDOM_ID.test(id)
}

/**
 * A fresh random account id (10 hex chars).
 * @returns the new account id.
 */
export function newAccountId(): AccountId {
  return randomBytes(5).toString('hex')
}

/**
 * Whether a route key can hold accounts: a record segment without the `--` separator.
 * @param route - the provider route key.
 * @returns true when stored accounts can be keyed under the route.
 */
export function isAccountRoute(route: string): boolean {
  return isCredentialKeySegment(route) && !route.includes(SEPARATOR)
}

/**
 * The record address of one stored account.
 * @param route - the provider route key.
 * @param account - the stored account id; defaults to `main`, the legacy record.
 * @returns the credential key `llm-pi-ai/<route>` for `main`, else `llm-pi-ai/<route>--<account>`.
 * @throws Error for a route containing `--`, a virtual account, or ids outside the grammar.
 */
export function recordKeyFor(route: string, account: AccountId = MAIN_ACCOUNT): CredentialKey {
  if (route.includes(SEPARATOR)) throw new Error(`llm-pi-ai: route "${route}" contains the reserved "--" separator`)
  if (!isStoredAccountId(account)) throw new Error(`llm-pi-ai: account "${account}" has no credential record`)
  return credentialKey(RECORD_SCOPE, account === MAIN_ACCOUNT ? route : `${route}${SEPARATOR}${account}`)
}

/**
 * Split a record key of this scope into route and account; `undefined` for a
 * foreign scope. A suffix that is not a random account id leaves the whole id
 * as the (legacy) route.
 * @param key - the credential record key.
 * @returns the route and account the key addresses, or `undefined` for a foreign scope.
 */
export function parseRecordKey(key: CredentialKey): { route: string; account: AccountId } | undefined {
  if (credentialKeyScope(key) !== RECORD_SCOPE) return undefined
  const id = credentialKeyId(key)
  const at = id.lastIndexOf(SEPARATOR)
  if (at > 0) {
    const suffix = id.slice(at + SEPARATOR.length)
    if (RANDOM_ID.test(suffix)) return { route: id.slice(0, at), account: suffix }
  }
  return { route: id, account: MAIN_ACCOUNT }
}
