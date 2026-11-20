/** The bundle package names the dsh installation selects, offers, or retires. */

/** Installation-owned defaults used when a shipped profile is first opened. */
export interface ProfileTemplate {
  /** Ordered bundle layer list. */
  bundles: readonly string[]
}

/**
 * The shipped profile templates auto-initialized on first use, by name. The `web` template (also Desktop's profile)
 * is dsh-base + dsh-web-app + the Standard component set, spelled out from `COMPONENT_PRESETS` (./components.ts)
 * literally, because the product gates read these lists statically.
 */
export const PROFILE_TEMPLATES: Record<string, ProfileTemplate> = {
  acp: {
    bundles: ['@deepseek-ai/dsh-base', '@deepseek-ai/dsh-acp-app'],
  },
  web: {
    bundles: [
      '@deepseek-ai/dsh-base',
      '@deepseek-ai/dsh-web-app',
      '@deepseek-ai/dsh-component-files',
      '@deepseek-ai/dsh-component-terminal',
      '@deepseek-ai/dsh-component-browser',
      '@deepseek-ai/dsh-component-search-tools',
      '@deepseek-ai/dsh-component-web',
      '@deepseek-ai/dsh-component-jobs',
      '@deepseek-ai/dsh-component-planning',
      '@deepseek-ai/dsh-component-goals',
      '@deepseek-ai/dsh-component-schedules',
      '@deepseek-ai/dsh-component-subagents',
      '@deepseek-ai/dsh-component-agent-teams',
      '@deepseek-ai/dsh-component-workflows',
      '@deepseek-ai/dsh-component-office',
      '@deepseek-ai/dsh-component-workspace-tracking',
      '@deepseek-ai/dsh-component-mcp',
      '@deepseek-ai/dsh-component-context-helpers',
      '@deepseek-ai/dsh-component-presets',
    ],
  },
  headless: {
    bundles: ['@deepseek-ai/dsh-base', '@deepseek-ai/dsh-headless'],
  },
  sdk: {
    bundles: ['@deepseek-ai/dsh-base', '@deepseek-ai/dsh-sdk-app'],
  },
  'sdk-minimal': {
    bundles: ['@deepseek-ai/dsh-sdk-minimal'],
  },
}

/**
 * Installation-owned bundle tuples that an earlier release wrote into a shipped profile; app-boot replaces an exact
 * match with the {@link PROFILE_TEMPLATES} entry of the same name and leaves every other list untouched.
 */
export const INSTALLATION_OWNED_PROFILE_TUPLES: Readonly<Record<string, readonly string[]>> = {
  headless: ['@deepseek-ai/dsh-base', '@deepseek-ai/dsh-web-app', '@deepseek-ai/dsh-headless'],
}

/** Bundles an earlier release shipped and the installation no longer carries; app-boot removes them from profiles. */
export const RETIRED_BUNDLES: ReadonlySet<string> = new Set([
  // The Web composition mounts Schedule itself
  // ([upgrade guide](../../../../docs/upgrade-guide/v0.2.0-rc.2/schedule-bundle-retired/guide.md)).
  '@deepseek-ai/dsh-experimental-schedule-bundle',
  '@deepseek-ai/dsh-experimental-agent-team-profile',
  // The Web composition mounts the plugin market (the Discover tab) itself
  // ([upgrade guide](../../../../docs/upgrade-guide/v0.2.2-rc.5/plugin-market-bundle-retired/guide.md)).
  '@deepseek-ai/dsh-experimental-plugin-market-bundle',
])

/** The bundle list a `stitch plugin` init uses for a name with no shipped template. */
export const DEFAULT_PROFILE_BUNDLES: readonly string[] = ['@deepseek-ai/dsh-base']

/**
 * The bundles the dsh installation ships for a person to switch on: each a
 * runtime dependency of the installation that declares `dsh.bundle.patch`,
 * an `icon`, and `./locale/*.json` display metadata, selected by no shipped
 * template, and offered switched off by the plugin manager when listed
 * ([rationale](../../../../.agents/notes/implemented/process/2026-09-15-shipped-optional-bundles.md),
 * [admission](../../../../.agents/notes/implemented/architecture/2026-09-21-experimental-capabilities-as-optional-bundles.md)).
 */
export const OPTIONAL_BUNDLES: readonly string[] = [
  '@deepseek-ai/dsh-cua-bundle',
  '@deepseek-ai/dsh-cua-mcp',
  '@deepseek-ai/dsh-timeline',
  '@deepseek-ai/dsh-experimental-session-search',
  '@deepseek-ai/dsh-experimental-ralph-bundle',
  '@deepseek-ai/dsh-experimental-terminal-bundle',
  '@deepseek-ai/dsh-experimental-session-titles-bundle',
  '@deepseek-ai/dsh-experimental-voice-input-bundle',
  '@deepseek-ai/dsh-experimental-cot-translation-bundle',
  '@deepseek-ai/dsh-experimental-auto-review',
  '@deepseek-ai/dsh-experimental-tool-worktree',
  '@deepseek-ai/dsh-experimental-forge-bundle',
  '@deepseek-ai/dsh-subagent-claude-code',
  '@deepseek-ai/dsh-subagent-codex',
]
