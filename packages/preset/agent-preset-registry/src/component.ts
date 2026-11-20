/**
 * Component marker row: mounted as `component-<id>` by a component bundle, it marks the component enabled for the
 * preset registry's `component:` gates and re-composes the presets when it starts or stops.
 * @module @deepseek-ai/dsh-agent-preset-registry/component
 */
import type { Context } from '@deepseek-ai/cordis'
import z from '@deepseek-ai/schemastery'
import type {} from './index.ts'

/** Cordis plugin name. */
export const name = 'agent-preset-component'

/** The registry whose gates this marker opens. */
export const inject = ['agentPresets']

/** Marker configuration. */
export interface Config {
  /** Component id named by `component:` gates. */
  id: string
}

/** Runtime schema for the marker row. */
export const Config: z<Config> = z.object({
  id: z.string().required(),
})

/**
 * Re-compose gated presets when this marker starts and again when it stops.
 * @param ctx - the marker row's context.
 */
export function apply(ctx: Context): void {
  ctx.effect(() => {
    ctx.agentPresets.refreshComponents()
    return () => { ctx.agentPresets.refreshComponents() }
  }, 'agent-preset.component')
}
