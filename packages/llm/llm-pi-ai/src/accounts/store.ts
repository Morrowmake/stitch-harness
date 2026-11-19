/**
 * Account-scoped pi-ai `CredentialStore`s over the harness credential records.
 *
 * pi-ai addresses credentials by provider id only, so one store serves one
 * account: `read('openai-codex')` on account `k3j9x0a1bc` reads
 * `llm-pi-ai/openai-codex--k3j9x0a1bc`. pi-ai runs OAuth refresh *inside*
 * `modify()`, under that record's lock, so two accounts refresh in parallel
 * and one account never refreshes twice.
 *
 * @module dsh-llm-pi-ai/accounts/store
 */

import type { Credential, CredentialInfo, CredentialStore } from '@earendil-works/pi-ai'
import type { Context } from '@deepseek-ai/cordis'
import type { CredentialKey, CredentialProvider, CredentialRecord } from '@deepseek-ai/dsh-credentials'
import { LlmError } from '@deepseek-ai/dsh-llm'
import { isAccountRoute, MAIN_ACCOUNT, parseRecordKey, recordKeyFor } from './keys.ts'
import type { AccountId } from './types.ts'

/**
 * Grant payload members pi-ai does not know but the account must keep across
 * every refresh (pi-ai's refresh returns a fresh object).
 */
export const STICKY_FIELDS = ['deviceId'] as const

/** Sticky members to merge into whatever the next write stores. */
export interface StickyExt {
  /** Per-account OpenAI ChatGPT sign-in device id. */
  deviceId?: string
}

/**
 * The JSON image of one grant payload: plain objects lose their
 * explicitly-undefined members and array entries JSON cannot hold become
 * null. pi-ai credentials carry optional members as explicit `undefined`
 * (a github.com Copilot grant holds `enterpriseUrl: undefined`), which the
 * credential store's strict validator refuses. Unknown members (OpenAI's
 * `clientId`, sticky extras) are never stripped.
 */
function jsonImage(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(entry => entry === undefined ? null : jsonImage(entry))
  if (typeof value === 'object' && value !== null && Object.getPrototypeOf(value) === Object.prototype) {
    const image: Record<string, unknown> = {}
    for (const [key, member] of Object.entries(value)) {
      if (member !== undefined) image[key] = jsonImage(member)
    }
    return image
  }
  return value
}

/**
 * Stored record → pi-ai credential. A grant payload is pi-ai's own credential, stored verbatim.
 * @param record - the stored credential record, if any.
 * @returns the pi-ai credential, or undefined when nothing is stored.
 */
export function toPiCredential(record: CredentialRecord | undefined): Credential | undefined {
  if (record === undefined) return undefined
  if (record.kind === 'api-key') {
    return {
      type: 'api_key',
      ...record.key === undefined ? {} : { key: record.key },
      ...record.env === undefined ? {} : { env: { ...record.env } },
    }
  }
  return record.payload as Credential
}

/**
 * pi-ai credential → record to commit.
 * @param credential - the pi-ai credential.
 * @returns an `api-key` record, or a `grant` record holding the credential's JSON image.
 */
export function toRecord(credential: Credential): CredentialRecord {
  if (credential.type === 'api_key') {
    return {
      kind: 'api-key',
      ...credential.key === undefined ? {} : { key: credential.key },
      ...credential.env === undefined ? {} : { env: { ...credential.env } },
    }
  }
  return { kind: 'grant', payload: jsonImage(credential) }
}

/** The sticky members of a stored grant. */
function stickyFrom(record: CredentialRecord | undefined): StickyExt {
  if (record?.kind !== 'grant' || typeof record.payload !== 'object' || record.payload === null) return {}
  const payload = record.payload as Record<string, unknown>
  const sticky: Record<string, string> = {}
  for (const field of STICKY_FIELDS) {
    const value = payload[field]
    if (typeof value === 'string') sticky[field] = value
  }
  return sticky
}

/**
 * The credential service, or the failure that names what is missing. Reads
 * answer "nothing stored" without a service; writes refuse, because a login
 * whose grant silently evaporated would report success and then fail every
 * request.
 * @throws {LlmError} code `NO_CREDENTIAL_STORE` when none is mounted.
 */
function writableStore(ctx: Context): CredentialProvider {
  const credentials = ctx.get('credentials')
  if (credentials === undefined) {
    throw new LlmError(
      'llm-pi-ai: this composition mounts no credentials service, so there is nowhere to store the'
      + ' credential a sign-in produces; mount one (dsh-credentials-local) to sign in',
      'NO_CREDENTIAL_STORE',
    )
  }
  return credentials
}

/** The record key for one provider id within one account, or undefined when none can exist. */
function keyOf(providerId: string, account: AccountId): CredentialKey | undefined {
  return isAccountRoute(providerId) ? recordKeyFor(providerId, account) : undefined
}

/**
 * A pi-ai `CredentialStore` over the records of one account.
 *
 * A provider id outside the record grammar (or containing `--`) can never
 * have stored a record, so reads answer "nothing stored" and a delete has
 * nothing to remove; only `modify` refuses it.
 * @param ctx - the plugin context carrying the optional `ctx.credentials`.
 * @param account - the stored account id (`main` = the legacy record).
 * @param ext - sticky members to merge into every write (sign-in device id).
 * @returns the credential store pi-ai reads, lists, modifies, and deletes the account's records through.
 */
export function accountCredentialStore(ctx: Context, account: AccountId = MAIN_ACCOUNT, ext?: StickyExt): CredentialStore {
  return {
    async read(providerId) {
      const credentials = ctx.get('credentials')
      const key = keyOf(providerId, account)
      if (credentials === undefined || key === undefined) return undefined
      return toPiCredential(await credentials.readRecord(key))
    },
    async list(): Promise<readonly CredentialInfo[]> {
      const stored = await ctx.get('credentials')?.listRecords() ?? []
      const mine: CredentialInfo[] = []
      for (const entry of stored) {
        const parsed = parseRecordKey(entry.key)
        if (parsed?.account !== account) continue
        mine.push({ providerId: parsed.route, type: entry.kind === 'api-key' ? 'api_key' : 'oauth' })
      }
      return mine
    },
    async modify(providerId, mutate) {
      const key = keyOf(providerId, account)
      if (key === undefined) {
        throw new LlmError(
          `llm-pi-ai: provider id "${providerId}" cannot address a stored credential record (a record id is a`
          + ' lowercase hyphenated identifier without "--"); authenticate this route through apiKeyEnv instead of a'
          + ' stored credential',
          'UNSTORABLE_PROVIDER_ID',
        )
      }
      const stored = await writableStore(ctx).modifyRecord(key, async (current) => {
        const next = await mutate(toPiCredential(current))
        if (next === undefined) return undefined
        if (next.type !== 'oauth') return toRecord(next)
        // pi-ai's refresh returns a fresh object: carry the account's sticky members forward.
        return toRecord({ ...next, ...stickyFrom(current), ...ext })
      })
      return toPiCredential(stored)
    },
    // `async` so a missing service reaches pi-ai as a rejection.
    async delete(providerId) {
      const key = keyOf(providerId, account)
      if (key === undefined) return
      await writableStore(ctx).deleteRecord(key)
    },
  }
}
