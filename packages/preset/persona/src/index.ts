/**
 * A per-agent persona as a composable row.
 *
 * `dsh-system-prompt` owns the global persona as its own config, and registers
 * that section unconditionally — so this row is **scope-only**. Mounted inside
 * an agent preset it shadows the deployment persona for that one session,
 * exactly like the per-child persona `dsh-subagent` installs; mounted globally
 * it collides with the registry's own registration and fails loud.
 *
 * That constraint is the reason the row exists. An agent preset cannot mount
 * the prompt registry itself, so without a row of its own a preset could
 * change an agent's tools but never its identity.
 * @module @deepseek-ai/dsh-persona
 */

import type { Context } from '@deepseek-ai/cordis'
import z from '@deepseek-ai/schemastery'
import type { AssembleContext } from '@deepseek-ai/dsh-system-prompt'
import { PERSONA_PREFIX_SECTION, PERSONA_SUFFIX_SECTION } from '@deepseek-ai/dsh-system-prompt'
import type { ToolDefinition } from '@deepseek-ai/dsh-tools'
import { renderShortPrompt, replacedSections } from './short-prompt.ts'

export { PERSONA_PREFIX_SECTION, PERSONA_SUFFIX_SECTION }

/** Name of the generated short tool list and rules section. */
export const SHORT_PROMPT_SECTION = 'persona:short-prompt'

/** Cordis plugin name. */
export const name = 'persona'

/** The prompt registry this row contributes to. */
export const inject = ['systemPrompt']

/** Plugin config: the persona text this composition contributes. */
export interface Config {
  /**
   * Persona prose rendered as the `deployment:persona-prefix` section. A template:
   * complete `{{…}}` groups interpolate strictly against registered prompt
   * variables. Empty text drops the section at render, matching the registry.
   */
  prefix: string
  /**
   * Persona suffix template rendered after first-party guidance. Omitted or empty
   * text shadows the deployment suffix away; interpolation is strict.
   */
  suffix?: string
  /** Make the prefix the complete system prompt, suppressing the suffix and every other section. */
  complete?: boolean
  /** Suppress dynamic runtime-context snapshots for this persona's agent scope. */
  includeRuntimeContext?: boolean
  /**
   * Names of other prompt sections to leave out of this persona's agent scope, such as the `tool:<name>` guidance of
   * tools whose schema descriptions suffice. Sections not named here are untouched.
   */
  omitSections?: string[]
  /**
   * Follow the prefix with a generated short prompt: a `<tools>` list and `<rules>` list built from the short-prompt
   * contributions of the tools mounted in this persona's agent scope, and leave out the long guidance sections those
   * contributions replace. Other prompt sections are untouched.
   */
  shortPrompt?: boolean
  /** The persona's own rules, closing the generated `<rules>` list. Used only with {@link Config.shortPrompt}. */
  rules?: string[]
}

/** Runtime schema for the persona row. */
export const Config: z<Config> = z.object({
  prefix: z.string().required(),
  suffix: z.string().default(''),
  complete: z.boolean().default(false),
  includeRuntimeContext: z.boolean().default(true),
  omitSections: z.array(z.string()).default([]),
  shortPrompt: z.boolean().default(false),
  rules: z.array(z.string()).default([]),
})

/**
 * Register the persona prefix and suffix sections for the mounting context's scope.
 * @param ctx - an agent scope context; an unscoped context collides with the
 * prompt registry's own persona registration and rejects.
 * @param config - the prefix, suffix, and complete-prompt policy.
 */
export function apply(ctx: Context, config: Config): void {
  ctx.effect(() => ctx.systemPrompt.section({
    name: PERSONA_PREFIX_SECTION,
    order: ctx.systemPrompt.getSectionOrder('DEPLOYMENT_PERSONA_PREFIX'),
    text: config.prefix,
    ...(config.complete ? { complete: true } : {}),
  }), 'persona.section()')
  ctx.effect(() => ctx.systemPrompt.section({
    name: PERSONA_SUFFIX_SECTION,
    order: ctx.systemPrompt.getSectionOrder('DEPLOYMENT_PERSONA_SUFFIX'),
    text: config.suffix ?? '',
  }), 'persona.suffix()')
  if (!(config.includeRuntimeContext ?? true)) ctx.systemPrompt.suppressRuntimeContext()
  const omitted = new Set(config.omitSections)
  const shortPrompt = config.shortPrompt ?? false
  // The tools mounted in the assembling scope, as the model sees them for that step.
  const definitions = (context: AssembleContext): readonly ToolDefinition[] =>
    ctx.get('tools')?.definitions(context.scope, context.toolSet) ?? []
  if (shortPrompt) {
    const rules = config.rules ?? []
    ctx.effect(() => ctx.systemPrompt.section({
      name: SHORT_PROMPT_SECTION,
      order: ctx.systemPrompt.getSectionOrder('PERSONA_SHORT_PROMPT'),
      // Tool summaries are literal text.
      interpolate: false,
      text: context => renderShortPrompt(definitions(context), rules),
    }), 'persona.shortPrompt()')
  }
  if (omitted.size === 0 && !shortPrompt) return
  // Scope-filtered: only this persona's agent scope assembles without the omitted sections.
  ctx.on('system-prompt/assemble', async (_assembly, context, next) => {
    const assembly = await next()
    const replaced = shortPrompt ? replacedSections(definitions(context)) : undefined
    const sections = assembly.sections.filter(section => !omitted.has(section.name) && replaced?.has(section.name) !== true)
    return { ...assembly, sections }
  })
}
