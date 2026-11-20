/**
 * The one display label of an account, shared by every surface that names
 * one: the Settings account list, pinned model-picker badges, and the error
 * text the router builds when accounts are unavailable. A raw account id is
 * never a label.
 *
 * @module dsh-llm-pi-ai/accounts/label
 */

import type { AccountRuntime } from './runtime.ts'
import { jwtClaims } from './usage/http.ts'

/** Display identity a signed-in account's access token discloses. */
export interface AccountIdentity {
  email?: string
  plan?: string
}

/**
 * The account's display label: its alias, else its sign-in email, else a
 * kind-based name (`Environment key`, `Ambient credentials`, `Account N`).
 * @param account - the account to label.
 * @param index - the account's position in its route's directory order (0-based); numbers `Account N`.
 * @param email - the signed-in email, when the account's token discloses one.
 * @returns the label; never the account id.
 */
export function accountDisplayLabel(account: Pick<AccountRuntime, 'kind' | 'meta'>, index: number, email?: string): string {
  if (account.meta.alias !== undefined) return account.meta.alias
  if (email !== undefined) return email
  if (account.kind === 'key-ref') return 'Environment key'
  if (account.kind === 'ambient') return 'Ambient credentials'
  return `Account ${String(index + 1)}`
}

/**
 * Display identity from an access token's claims; derived per read, never stored.
 * @param access - the OAuth access token.
 * @returns the email and plan the token discloses, or `undefined` when it discloses neither.
 */
export function identityFromAccessToken(access: unknown): AccountIdentity | undefined {
  const claims = typeof access === 'string' ? jwtClaims(access) : undefined
  if (claims === undefined) return undefined
  const profile = claims['https://api.openai.com/profile']
  const auth = claims['https://api.openai.com/auth']
  const email = typeof claims.email === 'string' ? claims.email
    : typeof profile === 'object' && profile !== null && 'email' in profile && typeof profile.email === 'string' ? profile.email
      : undefined
  const plan = typeof auth === 'object' && auth !== null && 'chatgpt_plan_type' in auth && typeof auth.chatgpt_plan_type === 'string'
    ? auth.chatgpt_plan_type
    : undefined
  if (email === undefined && plan === undefined) return undefined
  return { ...email === undefined ? {} : { email }, ...plan === undefined ? {} : { plan } }
}
