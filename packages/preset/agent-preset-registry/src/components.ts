/** Component gates: preset definitions and rows that compose only while named components are enabled. */
import type { EntryOptions, EntryTree } from '@deepseek-ai/cordis-plugin-loader'
import type { PresetDefinition } from './definition.ts'

/**
 * Loader row id prefix of a component marker. A profile enables component `<id>` by mounting a
 * `@deepseek-ai/dsh-agent-preset-registry/component` row with id `component-<id>` and config `{ id: <id> }`.
 */
export const COMPONENT_ROW_PREFIX = 'component-'

/**
 * A `component:` gate on a preset definition or row: a component id that must be enabled, `!<id>` for one that
 * must not be, or a list whose every term must hold.
 */
export type ComponentGate = string | readonly string[]

/** What one definition composes under the current components. */
export interface GatedComposition {
  /** Whether the definition's own gate holds; an inactive definition is absent from the roster. */
  readonly active: boolean
  /** Child rows whose gates hold, with the `component` key removed. */
  readonly plugins: PresetDefinition['plugins']
}

/**
 * Evaluate a gate.
 * @param gate - the declared `component` value; absent holds.
 * @param enabled - enabled component ids.
 * @returns whether every term holds; a malformed term never holds.
 */
export function gateHolds(gate: unknown, enabled: ReadonlySet<string>): boolean {
  if (gate === undefined) return true
  const terms: unknown[] = Array.isArray(gate) ? gate : [gate]
  return terms.every(term => typeof term === 'string'
    && (term.startsWith('!') ? !enabled.has(term.slice(1)) : enabled.has(term)))
}

/**
 * Drop rows whose gate fails, recursing into groups, and strip the gate key the Loader does not accept.
 * @param rows - declared child rows.
 * @param enabled - enabled component ids.
 * @returns detached rows for the Loader.
 */
export function gateRows(rows: PresetDefinition['plugins'], enabled: ReadonlySet<string>): PresetDefinition['plugins'] {
  return rows.flatMap((row) => {
    const { component, ...rest } = row
    if (!gateHolds(component, enabled)) return []
    if (rest.group === true && Array.isArray(rest.config)) {
      return [{ ...rest, config: gateRows(rest.config as PresetDefinition['plugins'], enabled) }]
    }
    return [rest]
  })
}

/**
 * Read the enabled components from the composed Host tree: every enabled `component-<id>` row. The Loader updates
 * row options before it starts or stops the row, so a marker's own lifecycle observes the new set.
 * @param tree - the Host Loader.
 * @returns enabled component ids.
 */
export function enabledComponents(tree: EntryTree): Set<string> {
  const enabled = new Set<string>()
  for (const entry of tree.entries()) {
    const options: EntryOptions = entry.options
    if (!options.id.startsWith(COMPONENT_ROW_PREFIX) || entry.disabled) continue
    const id = (options.config as { id?: unknown } | undefined)?.id
    if (typeof id === 'string') enabled.add(id)
  }
  return enabled
}

/**
 * Compose one definition under the enabled components.
 * @param definition - the declared preset.
 * @param enabled - enabled component ids.
 * @returns whether it is active and its gated rows.
 */
export function gateDefinition(definition: PresetDefinition, enabled: ReadonlySet<string>): GatedComposition {
  return { active: gateHolds(definition.component, enabled), plugins: gateRows(definition.plugins, enabled) }
}
