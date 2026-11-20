import { Context } from '@deepseek-ai/cordis'
import { createScope, type Scope, type ScopeKey } from '@deepseek-ai/dsh-scope'
import SystemPrompt, { renderPrompt } from '@deepseek-ai/dsh-system-prompt'
import ToolRuntime, { type ToolDefinition, type ToolShortPrompt } from '@deepseek-ai/dsh-tools'
import * as NativeToolExecutor from '@deepseek-ai/dsh-tool-executor-native'
import { describe, expect, it } from 'vitest'
import * as Persona from '@deepseek-ai/dsh-persona'

const OPENING = 'Agent for {{model}}.'

function tool(name: string, description: string, shortPrompt?: ToolShortPrompt): ToolDefinition {
  return {
    name,
    description,
    parameters: { type: 'object', properties: {} },
    output: { schema: { type: 'string' }, render: () => [] },
    execute: () => Promise.resolve(''),
    ...shortPrompt === undefined ? {} : { shortPrompt },
  }
}

const SEARCH_RULE = { text: 'Use glob and grep instead of find and grep in bash.', when: ['glob', 'grep', 'bash'] }
const TOOLS = {
  bash: tool('bash', 'Run bash.', {
    summary: 'Run shell commands', rules: [{ text: 'Use bash for file operations.', unless: ['glob', 'grep'] }], order: 1000,
  }),
  read: tool('read', 'Read files.', { summary: 'Read a text file', rules: ['Read before you edit.'], order: 1100 }),
  edit: tool('edit', 'Edit files.', { summary: 'Edit a file', rules: ['Read before you edit.'], order: 1300 }),
  glob: tool('glob', 'Glob.', { summary: 'Find files', rules: [SEARCH_RULE], order: 1400 }),
  grep: tool('grep', 'Grep.', { summary: 'Search contents', rules: [SEARCH_RULE], order: 1500 }),
  job_list: tool('job_list', 'List jobs.', { summary: 'Manage jobs', order: 1600, replaces: ['tool:jobs'] }),
  job_kill: tool('job_kill', 'Kill jobs.', { summary: 'Manage jobs', order: 1601, replaces: ['tool:jobs'] }),
  legacy: tool('legacy', 'Do the legacy thing. Second sentence.\nMore.'),
}

/** A context with the prompt and tool registries, an agent scope, and long guidance sections. */
async function harness(): Promise<{ ctx: Context; key: ScopeKey; scope: Scope }> {
  const ctx = new Context()
  await ctx.plugin(SystemPrompt, {})
  await ctx.plugin(ToolRuntime)
  await ctx.plugin(NativeToolExecutor)
  ctx.systemPrompt.variable('model', () => 'model-a')
  const key: ScopeKey = { agent: 'short' }
  let scope!: Scope
  await ctx.plugin(Object.assign((inner: Context) => { scope = createScope(inner, key) }, { inject: ['tools', 'systemPrompt'] }))
  for (const [name, order] of [['tool:bash', 1000], ['tool:read', 1100], ['tool:jobs', 1600], ['tool:legacy', 1700], ['plan:policy', 500]] as const) {
    ctx.systemPrompt.section({ name, order, text: `${name} guidance.` })
  }
  return { ctx, key, scope }
}

async function prompt(ctx: Context, key: ScopeKey): Promise<string> {
  return renderPrompt(await ctx.systemPrompt.assemble({ scope: key }))
}

describe('the generated short prompt', () => {
  it('lists mounted tools and their rules, replacing only their long guidance', async () => {
    const { ctx, key, scope } = await harness()
    try {
      for (const name of ['legacy', 'job_kill', 'edit', 'job_list', 'read', 'bash'] as const) scope.ctx.tools.register(TOOLS[name])
      await scope.ctx.plugin(Persona, { prefix: OPENING, shortPrompt: true, rules: ['Be concise.'], omitSections: ['harness:identity'] })
      expect(await prompt(ctx, key)).toBe([
        'Agent for model-a.',
        [
          '<tools>',
          '- bash: Run shell commands',
          '- read: Read a text file',
          '- edit: Edit a file',
          '- job_list / job_kill: Manage jobs',
          '- legacy: Do the legacy thing',
          '',
          'Additional tools may be available.',
          '</tools>',
          '',
          '<rules>',
          '- Use bash for file operations.',
          '- Read before you edit.',
          '- Be concise.',
          '</rules>',
        ].join('\n'),
        'plan:policy guidance.',
        'tool:legacy guidance.',
      ].join('\n\n'))
    } finally {
      await ctx.fiber.dispose()
    }
  })

  it('follows the mounted set: search tools swap the shell rule, removed tools leave no trace', async () => {
    const { ctx, key, scope } = await harness()
    try {
      scope.ctx.tools.register(TOOLS.bash)
      const disposeGlob = scope.ctx.tools.register(TOOLS.glob)
      const disposeGrep = scope.ctx.tools.register(TOOLS.grep)
      await scope.ctx.plugin(Persona, { prefix: OPENING, shortPrompt: true })
      const withSearch = await prompt(ctx, key)
      expect(withSearch).toContain('- glob: Find files\n- grep: Search contents')
      expect(withSearch).toContain('<rules>\n- Use glob and grep instead of find and grep in bash.\n</rules>')
      expect(withSearch).not.toContain('Use bash for file operations.')
      disposeGlob()
      disposeGrep()
      const without = await prompt(ctx, key)
      expect(without).toContain('<rules>\n- Use bash for file operations.\n</rules>')
      expect(without).not.toMatch(/glob|grep/)
      // Another scope keeps the long guidance and no generated list.
      const other: ScopeKey = { agent: 'other' }
      createScope(ctx, other)
      const unchanged = await prompt(ctx, other)
      expect(unchanged).toContain('tool:bash guidance.')
      expect(unchanged).not.toContain('<tools>')
    } finally {
      await ctx.fiber.dispose()
    }
  })

  it('leaves the prompt byte-identical without the short-prompt switch', async () => {
    const plain = await harness()
    const declared = await harness()
    try {
      plain.scope.ctx.tools.register(tool('bash', TOOLS.bash.description))
      plain.scope.ctx.tools.register(tool('read', TOOLS.read.description))
      declared.scope.ctx.tools.register(TOOLS.bash)
      declared.scope.ctx.tools.register(TOOLS.read)
      await plain.scope.ctx.plugin(Persona, { prefix: OPENING })
      await declared.scope.ctx.plugin(Persona, { prefix: OPENING })
      const expected = await prompt(plain.ctx, plain.key)
      expect(expected).toContain('tool:bash guidance.')
      expect(await prompt(declared.ctx, declared.key)).toBe(expected)
    } finally {
      await plain.ctx.fiber.dispose()
      await declared.ctx.fiber.dispose()
    }
  })
})
