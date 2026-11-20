/** The package names the plugin manager protects, hides, orders, or marks experimental. */

/**
 * Plugin packages the plugin manager refuses to disable or remove, because management itself needs them; a bundle that
 * contains one is read-only as well. Removing a name drops only this `management-required` refusal; the manager's own
 * entry, installation-carried bundles, and unaddressable rows stay protected by their own rules.
 */
export const PROTECTED_PLUGINS: ReadonlySet<string> = new Set([
  '@deepseek-ai/dsh-plugin-manager', '@deepseek-ai/cordis-plugin-loader',
  '@deepseek-ai/cordis-plugin-include', '@deepseek-ai/dsh-api-gateway',
  '@deepseek-ai/dsh-host-webserver', '@deepseek-ai/dsh-client-modules',
  '@deepseek-ai/dsh-client-ui-plugin-manager',
  '@deepseek-ai/dsh-host-plugin-inventory', '@deepseek-ai/dsh-typert-registry',
  '@deepseek-ai/dsh-api-remotes', '@deepseek-ai/dsh-api-remote-access',
  '@deepseek-ai/cordis-plugin-timer', '@deepseek-ai/dsh-client-connection',
  '@deepseek-ai/dsh-host-frontend-static', '@deepseek-ai/dsh-tools',
  '@deepseek-ai/dsh-hmr',
])

/**
 * Built-in profile bundles, the standalone worktree tool, and the Computer Use MCP profile
 * bundle, which have no plugin manager page.
 * Their Host availability and activation stay intact.
 */
export const HIDDEN_BUNDLES: ReadonlySet<string> = new Set([
  '@deepseek-ai/dsh-base',
  '@deepseek-ai/dsh-web-app',
  '@deepseek-ai/dsh-headless',
  '@deepseek-ai/dsh-sdk-app',
  '@deepseek-ai/dsh-acp-app',
  '@deepseek-ai/dsh-sdk-minimal',
  '@deepseek-ai/dsh-experimental-tool-worktree',
  '@deepseek-ai/dsh-cua-mcp',
])

/**
 * The purpose groups the plugin manager's Installed list shows official plugins under, in display order. `advanced`
 * holds plumbing a typical user never changes; the list shows it only on request.
 */
export const PLUGIN_SECTIONS = ['chat', 'files', 'web', 'agents', 'integrations', 'interface', 'advanced'] as const

/** One purpose group of {@link PLUGIN_SECTIONS}. */
export type PluginSection = typeof PLUGIN_SECTIONS[number]

/**
 * The purpose group of each official bundle the plugin manager lists. A listed official bundle missing here falls in
 * `advanced`; profile-installed plugins have a group of their own.
 */
export const BUNDLE_SECTIONS: Readonly<Record<string, PluginSection>> = {
  '@deepseek-ai/dsh-component-terminal': 'chat',
  '@deepseek-ai/dsh-component-planning': 'chat',
  '@deepseek-ai/dsh-component-goals': 'chat',
  '@deepseek-ai/dsh-experimental-voice-input-bundle': 'chat',
  '@deepseek-ai/dsh-experimental-terminal-bundle': 'chat',
  '@deepseek-ai/dsh-experimental-session-search': 'chat',
  '@deepseek-ai/dsh-component-files': 'files',
  '@deepseek-ai/dsh-component-office': 'files',
  '@deepseek-ai/dsh-component-web': 'web',
  '@deepseek-ai/dsh-component-browser': 'web',
  '@deepseek-ai/dsh-component-subagents': 'agents',
  '@deepseek-ai/dsh-component-agent-teams': 'agents',
  '@deepseek-ai/dsh-component-workflows': 'agents',
  '@deepseek-ai/dsh-component-schedules': 'agents',
  '@deepseek-ai/dsh-subagent-claude-code': 'agents',
  '@deepseek-ai/dsh-subagent-codex': 'agents',
  '@deepseek-ai/dsh-cua-bundle': 'agents',
  '@deepseek-ai/dsh-experimental-ralph-bundle': 'agents',
  '@deepseek-ai/dsh-experimental-auto-review': 'agents',
  '@deepseek-ai/dsh-component-mcp': 'integrations',
  '@deepseek-ai/dsh-experimental-forge-bundle': 'integrations',
  '@deepseek-ai/dsh-timeline': 'interface',
  '@deepseek-ai/dsh-experimental-cot-translation-bundle': 'interface',
  '@deepseek-ai/dsh-experimental-session-titles-bundle': 'interface',
  '@deepseek-ai/dsh-component-search-tools': 'advanced',
  '@deepseek-ai/dsh-component-jobs': 'advanced',
  '@deepseek-ai/dsh-component-workspace-tracking': 'advanced',
  '@deepseek-ai/dsh-component-context-helpers': 'advanced',
  '@deepseek-ai/dsh-component-presets': 'advanced',
  '@deepseek-ai/dsh-component-short-prompt': 'advanced',
  '@deepseek-ai/dsh-component-plugin-market-tool': 'advanced',
}

/** Official bundles the plugin manager marks with the Experimental badge. */
export const EXPERIMENTAL_BUNDLES: ReadonlySet<string> = new Set([
  '@deepseek-ai/dsh-cua-bundle',
  '@deepseek-ai/dsh-cua-mcp',
  '@deepseek-ai/dsh-timeline',
  '@deepseek-ai/dsh-experimental-terminal-bundle',
  '@deepseek-ai/dsh-experimental-voice-input-bundle',
  '@deepseek-ai/dsh-experimental-auto-review',
  '@deepseek-ai/dsh-experimental-forge-bundle',
  '@deepseek-ai/dsh-experimental-tool-worktree',
  '@deepseek-ai/dsh-experimental-cot-translation-bundle',
  '@deepseek-ai/dsh-experimental-session-search',
  '@deepseek-ai/dsh-experimental-session-titles-bundle',
  '@deepseek-ai/dsh-experimental-ralph-bundle',
])
