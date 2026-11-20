/** The short-prompt component swaps only the default preset's persona and core tool guidance. */

import { fileURLToPath } from 'node:url'
import { Context } from '@deepseek-ai/cordis'
import type { EntryOptions } from '@deepseek-ai/cordis-plugin-loader'
import { loadOverlayPatches } from '@deepseek-ai/dsh-app-boot'
import { gateRows } from '@deepseek-ai/dsh-agent-preset-registry/src/components.ts'
import * as Persona from '@deepseek-ai/dsh-persona'
import { createScope, type ScopeKey } from '@deepseek-ai/dsh-scope'
import SystemPrompt, { PERSONA_PREFIX_SECTION, renderPrompt } from '@deepseek-ai/dsh-system-prompt'
import { describe, expect, it } from 'vitest'

const presetFile = fileURLToPath(new URL('../presets/standard.patch.yml', import.meta.url))

/** The standard preset's child rows as the registry composes them for the enabled components. */
function standardRows(enabled: readonly string[]): EntryOptions[] {
  const [patch] = loadOverlayPatches('test', presetFile)
  const preset = patch?.insert?.find(row => row.id === 'preset-standard')
  if (preset === undefined) throw new Error('missing preset-standard')
  return gateRows((preset.config as { plugins: EntryOptions[] }).plugins, new Set(enabled)) as EntryOptions[]
}

describe('short-prompt component in the standard preset', () => {
  it('keeps the long persona without the component and swaps in the short one with it', () => {
    expect(standardRows(['planning']).map(row => row.id)).toContain('persona')
    expect(standardRows(['planning']).map(row => row.id)).not.toContain('persona-short')
    const rows = standardRows(['short-prompt', 'planning'])
    expect(rows.map(row => row.id)).toEqual(expect.arrayContaining(['persona-short', 'planning']))
    expect(rows.map(row => row.id)).not.toContain('persona')
  })

  it('leaves other components\' prompt contributions in place while dropping core tool guidance', async () => {
    const short = standardRows(['short-prompt', 'planning']).find(row => row.id === 'persona-short')
    const ctx = new Context()
    try {
      await ctx.plugin(SystemPrompt, { personaPrefix: 'Deployment.' })
      ctx.systemPrompt.variable('model', () => 'test-model')
      const key: ScopeKey = { agent: 'short-prompt' }
      const scope = createScope(ctx, key)
      // Contributions of the core tools and of other components, registered in the agent scope as their plugins do.
      await scope.ctx.plugin({
        inject: ['systemPrompt'],
        apply(child: Context) {
          for (const [name, text] of [['tool:bash', 'Bash guidance.'], ['tool:read', 'Read guidance.'], ['tool:edit', 'Edit guidance.'],
            ['plan:policy', 'Plan policy.'], ['team:policy', 'Team policy.'], ['tool:jobs', 'Jobs guidance.']] as const) {
            child.systemPrompt.section({ name, order: 1000, text })
          }
        },
      })
      await scope.ctx.plugin(Persona, short?.config as Persona.Config)
      const assembly = await ctx.systemPrompt.assemble({ scope: key })
      const names = assembly.sections.map(section => section.name)
      expect(names).toEqual(expect.arrayContaining(['plan:policy', 'team:policy', 'tool:jobs']))
      expect(names.filter(name => ['tool:bash', 'tool:read', 'tool:edit'].includes(name))).toEqual([])
      expect(assembly.sections.find(section => section.name === PERSONA_PREFIX_SECTION)?.text).toMatch(/^You are a coding agent/)
      expect(renderPrompt(assembly)).toContain('Plan policy.')
      // Another scope keeps every section.
      const other: ScopeKey = { agent: 'other' }
      createScope(ctx, other)
      expect((await ctx.systemPrompt.assemble({ scope: other })).sections.map(section => section.name)).not.toContain('plan:policy')
    } finally {
      await ctx.fiber.dispose()
    }
  })
})
