/**
 * Selector order for one provider's catalog: current models first, newest
 * first, and an `older` flag for entries a model picker collapses under
 * "Older models". pi-ai's catalog carries no release dates, so this is a
 * small heuristic over each entry's display name and id:
 *
 * - **Aliases** — a name with "(latest)" or an id ending in `-latest` — are
 *   older: they repeat a model listed under its own name.
 * - **Dated snapshots** — an id with a `-YYYYMMDD` or `-YYYY-MM-DD` segment,
 *   or a name with "(YYYY-MM-DD)" — are older: they pin one revision.
 * - **Superseded versions** are older. The name's first version token
 *   (`4.5`, `5`, `4o`, `V4`, `o3`) splits it into a family prefix ("Claude
 *   Opus", "GPT", "o") and a variant ("mini", "Codex Spark"). An entry is
 *   superseded when the same family and variant has a higher version
 *   (Claude Opus 4.5–5 under Opus 5.5; GPT-5.4 under GPT-5.5), or when its
 *   major version trails the family's newest major by two or more (GPT-4
 *   Turbo once GPT-6 exists).
 *
 * Within the current and older groups, versioned entries come newest first;
 * equal versions keep lighter tiers (mini, nano, lite, haiku, small, spark)
 * after the full model, and unversioned entries follow. Ties keep catalog order.
 *
 * @module dsh-llm-pi-ai/model-order
 */

/** Name markers of an alias that follows whatever the provider currently points it at. */
const ALIAS_NAME = /\(latest\)/i
const ALIAS_ID = /[-_.]latest$/i
/** A date segment inside a model id: `-20251001` or `-2024-05-13`. */
const SNAPSHOT_ID = /(?:^|[-_.@])(?:\d{8}|\d{4}-\d{2}-\d{2})(?=$|[-_.])/
/** A date in a display name: `(2024-05-13)`. */
const SNAPSHOT_NAME = /\(\d{4}-\d{2}-\d{2}\)/
/** One version token of a name: `4.5`, `5`, `4o`, `V4.1`, `o3`. */
const VERSION_TOKEN = /^([vo]?)(\d+(?:\.\d+)*)[a-z]?$/
/** Lighter tiers that sort after the full model of the same version. */
const LIGHT_TIER = /\b(?:mini|nano|lite|haiku|small|tiny|spark)\b/i

/** One catalog entry as the ordering reads it. */
export interface OrderableModel {
  readonly id: string
  readonly name: string
}

/** One ordered entry and whether a picker collapses it under "Older models". */
export interface OrderedModel<T extends OrderableModel> {
  readonly model: T
  readonly older: boolean
}

interface Parsed {
  /** Family prefix, e.g. `claude opus`, `gpt`, `o`. */
  prefix: string
  /** Family plus variant, e.g. `gpt|codex spark`. */
  line: string
  version: readonly number[]
}

/** Split a display name at its first version token; `undefined` when it carries none. */
function parseName(name: string): Parsed | undefined {
  const tokens = name.replace(/\([^)]*\)/g, ' ').toLowerCase().split(/[\s\-_/:]+/).filter(token => token.length > 0)
  for (const [index, token] of tokens.entries()) {
    const match = VERSION_TOKEN.exec(token)
    if (match === null) continue
    const prefix = [...tokens.slice(0, index), ...match[1] === '' ? [] : [match[1]]].join(' ')
    if (prefix.length === 0) return undefined
    return {
      prefix,
      line: `${prefix}|${tokens.slice(index + 1).join(' ')}`,
      version: (match[2] ?? '').split('.').map(Number),
    }
  }
  return undefined
}

/** Negative when `a` is the lower version. */
function compareVersions(a: readonly number[], b: readonly number[]): number {
  for (let index = 0; index < Math.max(a.length, b.length); index += 1) {
    const difference = (a[index] ?? 0) - (b[index] ?? 0)
    if (difference !== 0) return difference
  }
  return 0
}

/**
 * Order one provider's models for a selector and flag the older ones.
 * @param models - the provider's models in catalog order.
 * @returns every model once: current entries first, then older ones, each newest first.
 */
export function orderModels<T extends OrderableModel>(models: readonly T[]): OrderedModel<T>[] {
  const parsed = models.map(model => parseName(model.name))
  const newestInLine = new Map<string, readonly number[]>()
  const newestMajor = new Map<string, number>()
  for (const entry of parsed) {
    if (entry === undefined) continue
    const best = newestInLine.get(entry.line)
    if (best === undefined || compareVersions(entry.version, best) > 0) newestInLine.set(entry.line, entry.version)
    newestMajor.set(entry.prefix, Math.max(newestMajor.get(entry.prefix) ?? 0, entry.version[0] ?? 0))
  }
  const ranked = models.map((model, index) => {
    const entry = parsed[index]
    const superseded = entry !== undefined && (
      compareVersions(entry.version, newestInLine.get(entry.line) ?? entry.version) < 0
      || (entry.version[0] ?? 0) <= (newestMajor.get(entry.prefix) ?? 0) - 2
    )
    const older = ALIAS_NAME.test(model.name) || ALIAS_ID.test(model.id)
      || SNAPSHOT_NAME.test(model.name) || SNAPSHOT_ID.test(model.id)
      || superseded
    return { model, older, version: entry?.version, light: LIGHT_TIER.test(model.name), index }
  })
  ranked.sort((a, b) => {
    if (a.older !== b.older) return a.older ? 1 : -1
    if ((a.version === undefined) !== (b.version === undefined)) return a.version === undefined ? 1 : -1
    const byVersion = a.version === undefined || b.version === undefined ? 0 : compareVersions(b.version, a.version)
    if (byVersion !== 0) return byVersion
    if (a.light !== b.light) return a.light ? 1 : -1
    return a.index - b.index
  })
  return ranked.map(({ model, older }) => ({ model, older }))
}
