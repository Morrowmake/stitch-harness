/**
 * The accounts of each route: stored credential records of scope
 * `llm-pi-ai` (legacy `llm-pi-ai/<route>` = `main`), plus the virtual `env`
 * account for a profile's `apiKeyEnv`, plus `ambient` when neither exists.
 * Metadata comes from the profile's `accounts` dict; orphan metadata (no
 * record) is ignored.
 *
 * @module dsh-llm-pi-ai/accounts/directory
 */

import type { Context } from '@deepseek-ai/cordis'
import type { CredentialRecordEntry } from '@deepseek-ai/dsh-credentials'
import type { ResolvedPiAiProviderProfile } from '../config.ts'
import { AMBIENT_ACCOUNT, ENV_ACCOUNT, MAIN_ACCOUNT, parseRecordKey, recordKeyFor } from './keys.ts'
import type { AccountDirectory, AccountRuntime } from './runtime.ts'
import { orderAccounts } from './scheduler.ts'
import type { AccountId, AccountKind } from './types.ts'

/** One stored record of a route. */
export interface StoredAccount {
  account: AccountId
  kind: CredentialRecordEntry['kind']
}

/** Profile facts the directory needs (a subset, so pure tests can build them). */
export type AccountProfileSource = Pick<ResolvedPiAiProviderProfile, 'apiKeyEnv' | 'defaultAccount' | 'accounts'>

/**
 * Pure: the ordered accounts of one route.
 * Default = `defaultAccount` when present, else `main`, else `env`, else oldest `createdAt`.
 * @param route - the provider route key.
 * @param profile - the route's profile facts, when the route is configured.
 * @param stored - the route's stored credential records.
 * @returns the route's accounts in scheduling order, exactly one marked default.
 */
export function buildAccounts(
  route: string,
  profile: AccountProfileSource | undefined,
  stored: readonly StoredAccount[],
): AccountRuntime[] {
  const entries: { id: AccountId; kind: AccountKind }[] = stored.map(({ account, kind }) => ({ id: account, kind: kind === 'grant' ? 'oauth' : 'api-key' }))
  if (profile?.apiKeyEnv !== undefined) entries.push({ id: ENV_ACCOUNT, kind: 'key-ref' })
  else if (stored.length === 0) entries.push({ id: AMBIENT_ACCOUNT, kind: 'ambient' })
  const accounts = entries.map(({ id, kind }): AccountRuntime => {
    const meta = profile?.accounts?.[id] ?? {}
    return {
      provider: route,
      id,
      kind,
      meta: { ...meta, pooled: meta.pooled ?? true, pinned: meta.pinned ?? false },
      ...kind === 'oauth' || kind === 'api-key' ? { recordKey: recordKeyFor(route, id) } : {},
      isDefault: false,
    }
  })
  const ids = new Set(accounts.map(account => account.id))
  const configured = profile?.defaultAccount
  let defaultId: AccountId | undefined = configured !== undefined && ids.has(configured)
    ? configured
    : ids.has(MAIN_ACCOUNT) ? MAIN_ACCOUNT : ids.has(ENV_ACCOUNT) ? ENV_ACCOUNT : undefined
  defaultId ??= orderAccounts(accounts)[0]?.id
  for (const account of accounts) account.isDefault = account.id === defaultId
  return orderAccounts(accounts)
}

/** Live directory over `ctx.credentials` records and the current profiles. */
export class PoolDirectory implements AccountDirectory {
  private records: Promise<Map<string, StoredAccount[]>> | undefined
  private readonly views = new Map<string, readonly AccountRuntime[]>()
  private viewsOf: ReadonlyMap<string, ResolvedPiAiProviderProfile> | undefined
  /** Bumped by {@link invalidate}, so a view built from records read before it is not cached. */
  private generation = 0

  constructor(
    private readonly ctx: Context,
    private readonly profiles: () => ReadonlyMap<string, ResolvedPiAiProviderProfile>,
  ) {}

  private loadRecords(): Promise<Map<string, StoredAccount[]>> {
    this.records ??= (async () => {
      const byRoute = new Map<string, StoredAccount[]>()
      for (const entry of await this.ctx.get('credentials')?.listRecords() ?? []) {
        const parsed = parseRecordKey(entry.key)
        if (parsed === undefined) continue
        const list = byRoute.get(parsed.route) ?? []
        list.push({ account: parsed.account, kind: entry.kind })
        byRoute.set(parsed.route, list)
      }
      return byRoute
    })().catch((error: unknown) => {
      this.records = undefined
      throw error
    })
    return this.records
  }

  /**
   * Every route that has at least one stored record.
   * @returns the route keys parsed from the stored credential records.
   */
  async storedRoutes(): Promise<readonly string[]> {
    return [...(await this.loadRecords()).keys()]
  }

  async forRoute(route: string): Promise<readonly AccountRuntime[]> {
    const profiles = this.profiles()
    if (this.viewsOf !== profiles) {
      this.views.clear()
      this.viewsOf = profiles
    }
    const cached = this.views.get(route)
    if (cached !== undefined) return cached
    const generation = this.generation
    const records = await this.loadRecords()
    const built = buildAccounts(route, profiles.get(route), records.get(route) ?? [])
    if (this.viewsOf === profiles && this.generation === generation) this.views.set(route, built)
    return built
  }

  invalidate(): void {
    this.records = undefined
    this.generation += 1
    this.views.clear()
  }
}
