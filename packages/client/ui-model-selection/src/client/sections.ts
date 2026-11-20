/**
 * Presentation sections of one provider's catalog, shared by both entries.
 * The Host lists each provider's models current-first, newest-first and
 * flags superseded entries, aliases, and dated snapshots `older`. Pinned
 * per-account entries (`~acct:<accountId>:<model>`) carry the account's
 * display label as their badge; they form one section per account after the
 * provider's pooled models instead of repeating the list unlabelled. Every
 * part keeps catalog order.
 */
import type { ModelCatalogModel, ModelProviderGroup } from '@deepseek-ai/dsh-api-session-controller/types'

/** Prefix of pinned per-account model ids; the account id runs to the next colon. */
const PINNED_PREFIX = '~acct:'

/** One account whose pinned entries share a section. */
export interface ModelSectionAccount {
  readonly id: string
  /** Display label from the entries' badge; never the raw account id. */
  readonly label: string
}

/** One provider's pooled models, or one pinned account's models. */
export interface ModelSection {
  /** Absent for the provider's pooled models. */
  readonly account?: ModelSectionAccount
  /** Models shown without expanding, in catalog order. */
  readonly current: readonly ModelCatalogModel[]
  /** Models collapsed under "Older models", in catalog order. */
  readonly older: readonly ModelCatalogModel[]
}

/**
 * The pinned account a model id binds to.
 * @param modelId - provider-owned model id from the catalog.
 * @returns the account id, or undefined for an ordinary model.
 */
function pinnedAccountOf(modelId: string): string | undefined {
  if (!modelId.startsWith(PINNED_PREFIX)) return undefined
  const at = modelId.indexOf(':', PINNED_PREFIX.length)
  return at <= PINNED_PREFIX.length ? undefined : modelId.slice(PINNED_PREFIX.length, at)
}

/**
 * Split one provider's catalog into its pooled section followed by one section
 * per pinned account, in first-occurrence order.
 * @param group - one loaded provider group.
 * @param resolveText - resolves an entry's badge text for the active locale.
 * @param fallbackLabel - label of a pinned account whose entries carry no
 * badge, from its 1-based position among the provider's pinned accounts.
 * @returns the pooled section (omitted when empty) and the account sections.
 */
export function sectionsOf(
  group: ModelProviderGroup,
  resolveText: (text: NonNullable<ModelCatalogModel['badge']>['text']) => string,
  fallbackLabel: (ordinal: number) => string,
): ModelSection[] {
  const pooled = { current: [] as ModelCatalogModel[], older: [] as ModelCatalogModel[] }
  const accounts = new Map<string, { account: ModelSectionAccount; current: ModelCatalogModel[]; older: ModelCatalogModel[] }>()
  for (const model of group.models) {
    const accountId = pinnedAccountOf(model.id)
    let section = pooled
    if (accountId !== undefined) {
      let entry = accounts.get(accountId)
      if (entry === undefined) {
        const label = model.badge === undefined ? fallbackLabel(accounts.size + 1) : resolveText(model.badge.text)
        entry = { account: { id: accountId, label }, current: [], older: [] }
        accounts.set(accountId, entry)
      }
      section = entry
    }
    ;(model.older === true ? section.older : section.current).push(model)
  }
  return [
    ...pooled.current.length + pooled.older.length === 0 ? [] : [pooled],
    ...accounts.values(),
  ]
}
