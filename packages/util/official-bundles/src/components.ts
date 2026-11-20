/**
 * Components: the official feature bundles a Web (and Desktop) profile composes over `dsh-base` + `dsh-web-app`.
 * Each component is one bundle package that switches a whole feature on (tools, panels, commands, skills, settings
 * UI); turning it off removes the feature from the composition. The Standard set reproduces the shipped default; Custom is
 * any other selection.
 * @module @deepseek-ai/dsh-official-bundles/components
 */

/** Stable component identity; also the `component:` gate value preset rows use. */
export type ComponentId =
  | 'files'
  | 'terminal'
  | 'browser'
  | 'search-tools'
  | 'web'
  | 'jobs'
  | 'planning'
  | 'goals'
  | 'schedules'
  | 'subagents'
  | 'agent-teams'
  | 'workflows'
  | 'office'
  | 'workspace-tracking'
  | 'mcp'
  | 'context-helpers'
  | 'presets'
  | 'short-prompt'

/** Named component sets offered by the picker. */
export type ComponentPresetName = 'standard'

/** One official component. */
export interface ComponentDefinition {
  /** Stable identity. */
  readonly id: ComponentId
  /** Bundle package (`packages/component/<id>`); toggled through the plugin manager. */
  readonly packageName: string
  /**
   * Components this one needs. The plugin manager enables them with this one and disables this one with them;
   * the bundle declares the same packages in `dsh.bundle.requires`.
   */
  readonly requires: readonly ComponentId[]
  /** Member of the Standard set (the shipped default composition). */
  readonly standard: boolean
}

const PACKAGE_PREFIX = '@deepseek-ai/dsh-component-'

function component(
  id: ComponentId, sets: { standard: boolean }, requires: readonly ComponentId[] = [],
): ComponentDefinition {
  return { id, packageName: `${PACKAGE_PREFIX}${id}`, requires, ...sets }
}

const STANDARD = { standard: true }
const OPTIONAL = { standard: false }

/**
 * Every official component in display and layer order. Display text, description and icon come from each package's
 * `locale/<lang>.json` `meta` and `icon` (read through `pluginManager.listBundles()`).
 */
export const COMPONENTS: readonly ComponentDefinition[] = [
  component('files', STANDARD),
  component('terminal', STANDARD),
  component('browser', STANDARD),
  component('search-tools', STANDARD),
  component('web', STANDARD),
  component('jobs', STANDARD),
  component('planning', STANDARD),
  component('goals', STANDARD),
  component('schedules', STANDARD),
  component('subagents', STANDARD),
  component('agent-teams', STANDARD, ['subagents']),
  component('workflows', STANDARD, ['subagents']),
  component('office', STANDARD),
  component('workspace-tracking', STANDARD),
  component('mcp', STANDARD),
  component('context-helpers', STANDARD),
  component('presets', STANDARD),
  // Replaces the long per-tool prompt guidance of the default preset with a short complete prompt.
  component('short-prompt', OPTIONAL),
]

/** Component bundle package names in layer order. */
export const COMPONENT_BUNDLES: readonly string[] = COMPONENTS.map(item => item.packageName)

/** Component package names per named set, in layer order. */
export const COMPONENT_PRESETS: Readonly<Record<ComponentPresetName, readonly string[]>> = {
  standard: COMPONENTS.filter(item => item.standard).map(item => item.packageName),
}

/** The bundles every component layers over, in order. */
export const COMPONENT_HOST_BUNDLES: readonly string[] = ['@deepseek-ai/dsh-base', '@deepseek-ai/dsh-web-app']

/** Which named set the profile's enabled components equal, or `custom`. */
export interface ComponentPresetMatch {
  /** `standard` when the enabled components equal that set exactly, otherwise `custom`. */
  readonly preset: ComponentPresetName | 'custom'
  /** Enabled component package names, in {@link COMPONENTS} order. */
  readonly enabled: readonly string[]
}

/**
 * Classify a profile bundle list.
 * @param bundles - the profile's selected bundles (any order; non-component names are ignored).
 * @returns the matching named set and the enabled components.
 */
export function matchComponentPreset(bundles: readonly string[]): ComponentPresetMatch {
  const selected = new Set(bundles)
  const enabled = COMPONENT_BUNDLES.filter(name => selected.has(name))
  const named = (['standard'] as const).find(name =>
    COMPONENT_PRESETS[name].length === enabled.length && COMPONENT_PRESETS[name].every(item => selected.has(item)))
  return { preset: named ?? 'custom', enabled }
}

/**
 * Close a bundle selection over prerequisites: an enabled bundle enables what it requires, and a disabled bundle
 * disables every enabled bundle that requires it (transitively). An explicit request to disable a prerequisite wins
 * over an explicit request to enable its dependent.
 * @param changes - requested enablement per bundle package name.
 * @param current - the profile's currently selected bundles.
 * @param requiresOf - the prerequisite package names a bundle declares (`dsh.bundle.requires`).
 * @returns every requested name plus each bundle whose selection the closure changes, mapped to its final state.
 */
export function closeBundleChanges(
  changes: Readonly<Record<string, boolean>>,
  current: readonly string[],
  requiresOf: (name: string) => readonly string[],
): Record<string, boolean> {
  const blocked = new Set(Object.keys(changes).filter(name => !changes[name]))
  const requested = Object.keys(changes).filter(name => changes[name])
  const candidates = [...new Set([...current, ...requested])]
  // Prerequisites the closure may add are blocked too when they need a blocked bundle.
  const universe = new Set(candidates)
  for (const name of universe) for (const need of requiresOf(name)) universe.add(need)
  for (let grew = true; grew;) {
    grew = false
    for (const name of universe) {
      if (blocked.has(name) || !requiresOf(name).some(need => blocked.has(need))) continue
      blocked.add(name)
      grew = true
    }
  }
  const state = new Set(candidates.filter(name => !blocked.has(name)))
  const pending = [...state]
  for (let name = pending.pop(); name !== undefined; name = pending.pop()) {
    for (const need of requiresOf(name)) {
      if (state.has(need)) continue
      state.add(need)
      pending.push(need)
    }
  }
  const result: Record<string, boolean> = {}
  for (const name of new Set([...Object.keys(changes), ...candidates, ...state])) {
    const enabled = state.has(name)
    if (Object.hasOwn(changes, name) || enabled !== current.includes(name)) result[name] = enabled
  }
  return result
}
