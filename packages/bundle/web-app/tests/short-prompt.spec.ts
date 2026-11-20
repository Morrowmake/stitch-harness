/** The short-prompt component swaps only the default preset's persona and the replaced tool guidance. */

import { fileURLToPath } from 'node:url'
import { Context } from '@deepseek-ai/cordis'
import type { EntryOptions } from '@deepseek-ai/cordis-plugin-loader'
import { loadOverlayPatches } from '@deepseek-ai/dsh-app-boot'
import { gateRows } from '@deepseek-ai/dsh-agent-preset-registry/src/components.ts'
import * as Persona from '@deepseek-ai/dsh-persona'
import { createScope, type Scope, type ScopeKey } from '@deepseek-ai/dsh-scope'
import SystemPrompt, { PERSONA_PREFIX_SECTION, renderPrompt } from '@deepseek-ai/dsh-system-prompt'
import * as NativeToolExecutor from '@deepseek-ai/dsh-tool-executor-native'
import ToolRuntime from '@deepseek-ai/dsh-tools'
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

  it('leaves other components\' prompt contributions in place while dropping replaced tool guidance', async () => {
    const short = standardRows(['short-prompt', 'planning']).find(row => row.id === 'persona-short')
    const ctx = new Context()
    try {
      await ctx.plugin(SystemPrompt, { personaPrefix: 'Deployment.' })
      await ctx.plugin(ToolRuntime)
      await ctx.plugin(NativeToolExecutor)
      ctx.systemPrompt.variable('model', () => 'test-model')
      const key: ScopeKey = { agent: 'short-prompt' }
      let scope!: Scope
      await ctx.plugin(Object.assign((inner: Context) => { scope = createScope(inner, key) }, { inject: ['tools', 'systemPrompt'] }))
      // Contributions of tools and of other components, registered in the agent scope as their plugins do.
      await scope.ctx.plugin({
        inject: ['systemPrompt', 'tools'],
        apply(child: Context) {
          for (const [name, text] of [['tool:bash', 'Bash guidance.'], ['tool:read', 'Read guidance.'], ['tool:edit', 'Edit guidance.'],
            ['plan:policy', 'Plan policy.'], ['team:policy', 'Team policy.'], ['tool:lsp', 'Lsp guidance.']] as const) {
            child.systemPrompt.section({ name, order: 1000, text })
          }
          for (const [name, shortPrompt] of [['bash', { summary: 'Run shell commands' }], ['read', { summary: 'Read a file' }],
            ['edit', { summary: 'Edit a file' }], ['lsp', undefined]] as const) {
            child.tools.register({
              name, description: `Use ${name}.`, parameters: { type: 'object', properties: {} },
              output: { schema: { type: 'string' }, render: () => [] }, execute: () => Promise.resolve(''),
              ...shortPrompt === undefined ? {} : { shortPrompt },
            })
          }
        },
      })
      await scope.ctx.plugin(Persona, short?.config as Persona.Config)
      const assembly = await ctx.systemPrompt.assemble({ scope: key })
      const names = assembly.sections.map(section => section.name)
      // A tool without a short contribution keeps its guidance and is listed by its description's first sentence.
      expect(names).toEqual(expect.arrayContaining(['plan:policy', 'team:policy', 'tool:lsp']))
      expect(names.filter(name => ['tool:bash', 'tool:read', 'tool:edit', 'harness:identity'].includes(name))).toEqual([])
      expect(assembly.sections.find(section => section.name === PERSONA_PREFIX_SECTION)?.text)
        .toMatch(/^You are a coding agent running inside Stitch/)
      const rendered = renderPrompt(assembly)
      expect(rendered).toMatch(/^You are a coding agent running inside Stitch, .* The model is test-model\.\n\n<tools>\n/)
      expect(rendered).toContain('- lsp: Use lsp\n')
      expect(rendered).toContain('- Be concise, and show file paths clearly.\n</rules>')
      expect(rendered).toContain('Plan policy.')
      // Another scope keeps every section.
      const other: ScopeKey = { agent: 'other' }
      createScope(ctx, other)
      expect((await ctx.systemPrompt.assemble({ scope: other })).sections.map(section => section.name)).not.toContain('plan:policy')
    } finally {
      await ctx.fiber.dispose()
    }
  })
})
