/**
 * First-run setup plugin, node half: one live Config field remembers that the
 * flow was finished or dismissed, so the browser half shows it once per
 * profile on the web and in the desktop app alike.
 */
import type {} from '@deepseek-ai/dsh-settings'

import type { Context, Volatile } from '@deepseek-ai/cordis'

import z from '@deepseek-ai/schemastery'

/** Runtime preferences projected to the browser. */
export interface Config {
  /** First-run flow version the user finished or dismissed; unset until then. */
  completedVersion: Volatile<string | undefined>
}

/** Live first-run preference. */
export const Config = z.object({
  completedVersion: z.string().volatile(),
})

/**
 * Expose the field to the browser's configuration forms without a generated settings page.
 * @param ctx - Plugin context used for the optional settings presentation policy.
 */
export function apply(ctx: Context): void {
  ctx.inject(['settings'], (child) => { child.effect(() => child.settings.configure({ auto: false }, ctx.fiber)) })
}
