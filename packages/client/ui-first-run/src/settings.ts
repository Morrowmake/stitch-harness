/** The first-run settings section, shared by the Host half (its Config) and the browser half (its reads and writes). */

/** Settings namespace: the plugin's row id in the web-app composition. */
export const FIRST_RUN_SETTINGS_NAMESPACE = 'ui-first-run'

/** Field recording the first-run flow version the user finished or dismissed. */
export const FIRST_RUN_COMPLETED_FIELD = 'completedVersion'

/**
 * Bump only when the flow changes materially and every user should walk it
 * again. The stored value is compared for exact equality.
 */
export const FIRST_RUN_VERSION = '2026-11-20.1'
