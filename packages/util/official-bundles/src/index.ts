/**
 * Installation-owned bundle lists and the plugin manager's protected and presented packages, kept apart from the code that applies them.
 * @module @deepseek-ai/dsh-official-bundles
 */

export {
  DEFAULT_PROFILE_BUNDLES, INSTALLATION_OWNED_PROFILE_TUPLES, OPTIONAL_BUNDLES, PROFILE_TEMPLATES,
  RETIRED_BUNDLES, type ProfileTemplate,
} from './bundles.ts'
export {
  BUNDLE_SECTIONS, EXPERIMENTAL_BUNDLES, HIDDEN_BUNDLES, PLUGIN_SECTIONS, PROTECTED_PLUGINS, type PluginSection,
} from './plugin-manager.ts'
export {
  closeBundleChanges, COMPONENT_BUNDLES, COMPONENT_HOST_BUNDLES, COMPONENT_PRESETS, COMPONENTS, matchComponentPreset,
  type ComponentDefinition, type ComponentId, type ComponentPresetMatch, type ComponentPresetName,
} from './components.ts'
