/**
 * Pure component-selection rules for the component picker: the Minimal and
 * Standard sets, prerequisite auto-ticks, and the bundle changes a selection
 * applies. The component list itself comes from the Host through
 * {@link ComponentOperations}.
 */

/** One component as the picker shows it. */
export interface ComponentEntry {
  /** Stable component id. */
  readonly id: string
  /** Bundle package the component toggles. */
  readonly bundle: string
  /** Localized title and description (already resolved for the active locale). */
  readonly title: string
  readonly description: string
  /** Image data URL, when the bundle ships an icon. */
  readonly icon?: string
  /** Component ids that must be on for this one to work. */
  readonly requires: readonly string[]
  /** Member of the Minimal set. */
  readonly minimal: boolean
  /** Member of the Standard set (today's default composition). */
  readonly standard: boolean
  /** Whether the bundle is selected in the profile right now. */
  readonly enabled: boolean
}

/** The named sets the picker offers. */
export type ComponentPreset = 'minimal' | 'standard' | 'custom'

/**
 * Close a selection over prerequisites: every ticked component's requirements are ticked too.
 * @param components - the component list.
 * @param selection - ticked component ids.
 * @returns the closed selection.
 */
function withRequirements(components: readonly ComponentEntry[], selection: ReadonlySet<string>): Set<string> {
  const byId = new Map(components.map(component => [component.id, component]))
  const closed = new Set<string>()
  const visit = (id: string): void => {
    if (closed.has(id) || !byId.has(id)) return
    closed.add(id)
    for (const required of byId.get(id)?.requires ?? []) visit(required)
  }
  for (const id of selection) visit(id)
  return closed
}

/**
 * The ticks of a named set.
 * @param components - the component list.
 * @param preset - `minimal` or `standard`.
 * @returns ticked component ids.
 */
export function presetSelection(components: readonly ComponentEntry[], preset: Exclude<ComponentPreset, 'custom'>): Set<string> {
  return withRequirements(components, new Set(components.filter(component => component[preset]).map(component => component.id)))
}

/**
 * The ticks the profile holds now.
 * @param components - the component list.
 * @returns ticked component ids.
 */
export function currentSelection(components: readonly ComponentEntry[]): Set<string> {
  return new Set(components.filter(component => component.enabled).map(component => component.id))
}

/**
 * Tick or untick one component. Ticking also ticks what it requires;
 * unticking also unticks every component that requires it, directly or not.
 * @param components - the component list.
 * @param selection - ticked component ids.
 * @param id - the component the user toggled.
 * @param on - its requested state.
 * @returns the next selection.
 */
export function toggleComponent(
  components: readonly ComponentEntry[], selection: ReadonlySet<string>, id: string, on: boolean,
): Set<string> {
  if (on) return withRequirements(components, new Set([...selection, id]))
  const next = new Set(selection)
  const drop = (target: string): void => {
    if (!next.delete(target)) return
    for (const component of components) if (component.requires.includes(target)) drop(component.id)
  }
  drop(id)
  return next
}

/**
 * Name a selection: Minimal or Standard when it equals that set exactly, else Custom.
 * @param components - the component list.
 * @param selection - ticked component ids.
 * @returns the matching set name.
 */
export function selectionPreset(components: readonly ComponentEntry[], selection: ReadonlySet<string>): ComponentPreset {
  const same = (other: ReadonlySet<string>): boolean => other.size === selection.size && [...other].every(id => selection.has(id))
  if (same(presetSelection(components, 'standard'))) return 'standard'
  if (same(presetSelection(components, 'minimal'))) return 'minimal'
  return 'custom'
}

/**
 * The bundle switches that turn the profile's current state into a selection.
 * @param components - the component list.
 * @param selection - ticked component ids.
 * @returns bundle name → requested state, only for bundles that change.
 */
export function bundleChanges(components: readonly ComponentEntry[], selection: ReadonlySet<string>): Record<string, boolean> {
  const changes: Record<string, boolean> = {}
  for (const component of components) {
    const on = selection.has(component.id)
    if (on !== component.enabled) changes[component.bundle] = on
  }
  return changes
}
