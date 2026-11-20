/**
 * Real Loader composition: the tool registry, the web seam, this provider, and `dsh-tool-web` boot
 * from a `cordis.yml` with no search provider configured, and the model-facing `web_search` tool runs
 * through the registry. Only the network is stubbed.
 */

import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { Context } from '@deepseek-ai/cordis'
import type { ModuleLoaderV2 } from '@deepseek-ai/cordis-plugin-loader'
import type { Agent } from '@deepseek-ai/dsh-agent'
import { boot } from '@deepseek-ai/dsh-app-boot'
import { brandString } from '@deepseek-ai/dsh-brand'
import type { ToolCallId } from '@deepseek-ai/dsh-llm/types'
import { createScope } from '@deepseek-ai/dsh-scope'
import type { SessionId } from '@deepseek-ai/dsh-session'
import SystemPrompt from '@deepseek-ai/dsh-system-prompt'
import * as NativeToolExecutor from '@deepseek-ai/dsh-tool-executor-native'
import { executeToolFixture } from '@deepseek-ai/dsh-tool-testkit'
import * as ToolWeb from '@deepseek-ai/dsh-tool-web'
import ToolRuntime from '@deepseek-ai/dsh-tools'
import WebRuntime from '@deepseek-ai/dsh-web'
import * as keylessPlugin from '@deepseek-ai/dsh-web-search-keyless'
import { fixture } from './server.ts'

const cleanups: Array<() => Promise<void>> = []

afterEach(async () => {
  for (const cleanup of cleanups.splice(0).reverse()) await cleanup()
  vi.unstubAllGlobals()
})

const MODULES = new Map<string, unknown>([
  ['@deepseek-ai/dsh-system-prompt', SystemPrompt],
  ['@deepseek-ai/dsh-tools', ToolRuntime],
  ['@deepseek-ai/dsh-tool-executor-native', NativeToolExecutor],
  ['@deepseek-ai/dsh-web', WebRuntime],
  ['@deepseek-ai/dsh-web-search-keyless', keylessPlugin],
  ['@deepseek-ai/dsh-tool-web', ToolWeb],
])

const agent = { id: brandString<SessionId>('web-search-keyless-composition'), session: { requestContext: () => undefined } } as Agent
const signal = new AbortController().signal

/**
 * Boot the composition from a `cordis.yml`.
 * @returns the root context.
 */
async function bootComposition(): Promise<Context> {
  const root = await mkdtemp(join(tmpdir(), 'dsh-web-search-keyless-composition-'))
  cleanups.push(async () => { await rm(root, { recursive: true, force: true }) })
  const previousHome = process.env.STITCH_HOME
  process.env.STITCH_HOME = root
  cleanups.push(() => {
    if (previousHome === undefined) Reflect.deleteProperty(process.env, 'STITCH_HOME')
    else process.env.STITCH_HOME = previousHome
    return Promise.resolve()
  })
  const configPath = join(root, 'cordis.yml')
  await writeFile(configPath, JSON.stringify([
    { id: 'system-prompt', name: '@deepseek-ai/dsh-system-prompt' },
    { id: 'tools', name: '@deepseek-ai/dsh-tools' },
    { id: 'tool-executor-native', name: '@deepseek-ai/dsh-tool-executor-native' },
    { id: 'web', name: '@deepseek-ai/dsh-web' },
    { id: 'web-search-keyless', name: '@deepseek-ai/dsh-web-search-keyless' },
    { id: 'tool-web', name: '@deepseek-ai/dsh-tool-web', config: { fetch: false } },
  ]))
  const ctx = await boot('web-search-keyless-composition', configPath, [], (host) => {
    const modules: ModuleLoaderV2 = {
      version: 'v2', loadCache: new Map(),
      async import(specifier) {
        if (!MODULES.has(specifier)) throw new Error(`Unexpected fixture module ${specifier}`)
        return MODULES.get(specifier)
      },
      register(): never { throw new Error('Unexpected module hook registration') },
      getOrCreateModuleJob(): never { throw new Error('Unexpected module job creation') },
      resolveSync(): never { throw new Error('Unexpected synchronous module resolution') },
      load(): never { throw new Error('Unexpected module load') },
    }
    host.loader.internal = modules
  })
  cleanups.push(async () => { await ctx.fiber.dispose() })
  await ctx.plugin(Object.assign((inner: Context) => { createScope(inner, agent) }, { inject: ['tools'] }))
  return ctx
}

describe('web-search-keyless in a real composition', () => {
  it('answers web_search from Marginalia when DuckDuckGo challenges the search', async () => {
    const fetchMock = vi.fn((input: URL | string) => {
      const url = new URL(String(input))
      return Promise.resolve(url.hostname === 'html.duckduckgo.com'
        ? new Response(fixture('duckduckgo-challenge.html'), { status: 202 })
        : new Response(fixture('marginalia.json'), { status: 200 }))
    })
    vi.stubGlobal('fetch', fetchMock)
    const ctx = await bootComposition()

    const toolSet = await ctx.tools.resolve({ agent, modelSelection: { provider: 'test', model: 'test' }, signal })
    try {
      const out = await executeToolFixture(ctx, {
        agent, toolSet, signal, callId: brandString<ToolCallId>('call-1'), name: 'web_search', arguments: { queries: ['cordis plugin framework'] },
      })
      expect(out.isError).toBe(false)
      const text = out.content.map(block => block.type === 'text' ? block.text : '').join('')
      expect(text).toContain('[Writing Cordis plugins](https://cordis.example.org/docs/plugins.html)')
    } finally {
      toolSet.dispose()
    }
    expect(fetchMock.mock.calls.map(([input]) => new URL(String(input)).hostname))
      .toEqual(['html.duckduckgo.com', 'api2.marginalia-search.com'])
  })
})
