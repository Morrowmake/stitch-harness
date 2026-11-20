/**
 * Stored accounts in a real composition: the account metadata a sign-in or an
 * added API key writes goes through the plugin's settings schema into the
 * route's model list, which every picker (`session/modelCatalog`) reads
 * through `ctx.llm.listModels`. A metadata entry naming no `models` allowlist
 * must serve the whole catalog; only an explicit `[]` serves nothing.
 */

import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { getBuiltinModels } from '@earendil-works/pi-ai/providers/all'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import LlmRuntime from '@deepseek-ai/dsh-llm'
import { LocalCredentialProvider } from '@deepseek-ai/dsh-credentials-local'
import type { SettingsPathOp } from '@deepseek-ai/dsh-settings'
import { liveConfig } from '../../../settings/settings/tests/live-config.ts'
import * as LlmPiAi from '@deepseek-ai/dsh-llm-pi-ai'
import { recordKeyFor } from '../src/accounts/keys.ts'
import { orderModels } from '../src/model-order.ts'

const cleanups: Array<() => Promise<void>> = []

afterEach(async () => {
  vi.unstubAllGlobals()
  while (cleanups.length > 0) await cleanups.pop()!()
})

type Document = Record<string, unknown>

/** Apply settings path ops to a plain document (what `ctx.settings.mutate` does). */
function applyOp(doc: Document, op: SettingsPathOp): void {
  const parent = op.path.slice(0, -1).reduce<Document>((node, key) => {
    node[key] ??= {}
    return node[key] as Document
  }, doc)
  const leaf = op.path.at(-1) as string
  if (op.op === 'set') parent[leaf] = op.value
  else Reflect.deleteProperty(parent, leaf)
}

/**
 * Boot the plugin behind the Loader with a settings writer that feeds every
 * mutation back as the plugin's configuration, as profile reconciliation does.
 */
async function boot(initial: Document): Promise<Context> {
  const dir = await mkdtemp(join(tmpdir(), 'dsh-pi-account-models-'))
  cleanups.push(() => rm(dir, { recursive: true, force: true }))
  const ctx = new Context()
  cleanups.push(() => ctx.fiber.dispose())
  await ctx.plugin(LlmRuntime)
  await ctx.plugin(LocalCredentialProvider, { path: join(dir, '.credentials.yaml'), watch: false })
  let document = structuredClone(initial)
  // Filled once the plugin is mounted; mutations only arrive after that.
  const live: { replace?: (next: Document) => Promise<void> } = {}
  ctx.provide('settings', {
    configure: () => () => {},
    mutate: async (_ns: string, ops: readonly SettingsPathOp[]) => {
      const next = structuredClone(document)
      for (const op of ops) applyOp(next, op)
      document = next
      await live.replace?.(structuredClone(next))
    },
  } as never)
  live.replace = (await liveConfig(ctx, LlmPiAi, structuredClone(document))).replace
  return ctx
}

/** The provider's catalog in picker order (current first, newest first). */
const catalogIds = (provider: string): string[] => orderModels(getBuiltinModels(provider as never)).map(({ model }) => model.id)
const listedIds = async (ctx: Context, provider: string): Promise<string[]> =>
  (await ctx.llm.listModels(provider)).map(model => model.id)

describe('stored account metadata through the settings schema', () => {
  it('serves the catalog for a signed-in subscription whose metadata names no allowlist', async () => {
    // The profile a first-run Claude Pro/Max sign-in leaves behind, verbatim.
    const ctx = await boot({
      providers: { anthropic: { accounts: { c2e41f33af: { createdAt: 1795177628486 } }, defaultAccount: 'c2e41f33af' } },
    })
    await ctx.credentials.modifyRecord(recordKeyFor('anthropic', 'c2e41f33af'), () => Promise.resolve({
      kind: 'grant',
      payload: { type: 'oauth', access: 'at', refresh: 'rt', expires: Date.now() + 3_600_000 },
    }))

    expect(await listedIds(ctx, 'anthropic')).toEqual(catalogIds('anthropic'))
    expect(catalogIds('anthropic').length).toBeGreaterThan(0)
  })

  it('serves the catalog for a ChatGPT sign-in on the openai route', async () => {
    const ctx = await boot({
      providers: { openai: { accounts: { a1b2c3d4e5: { createdAt: 1 } }, defaultAccount: 'a1b2c3d4e5' } },
    })
    await ctx.credentials.modifyRecord(recordKeyFor('openai', 'a1b2c3d4e5'), () => Promise.resolve({
      kind: 'grant',
      payload: { type: 'oauth', access: 'at', refresh: 'rt', expires: Date.now() + 3_600_000 },
    }))

    expect(await listedIds(ctx, 'openai')).toEqual(catalogIds('openai'))
  })

  it('serves the catalog after an API key is added through llmAccounts', async () => {
    const ctx = await boot({})
    // The key check lists Anthropic's models; this one accepts the key without leaving the process.
    const checked: string[] = []
    vi.stubGlobal('fetch', (url: string) => {
      checked.push(url)
      return Promise.resolve(new Response('{"data":[]}', { status: 200 }))
    })

    // The first-run "API access" path: the Remote checks and stores the key and writes the account metadata.
    const added = await ctx.llmAccounts.addApiKeyAccount('anthropic', { key: 'sk-ant-api03-test' })

    expect(added.check).toEqual({ status: 'verified' })
    expect(checked).toEqual(['https://api.anthropic.com/v1/models?limit=1000'])
    expect(added.account.isDefault).toBe(true)
    expect(ctx.llm.listProviders().map(provider => provider.id)).toContain('anthropic')
    expect(await listedIds(ctx, 'anthropic')).toEqual(catalogIds('anthropic'))
  })

  it('keeps an explicit allowlist, and an empty one serving nothing', async () => {
    const ctx = await boot({
      providers: {
        anthropic: {
          accounts: { c2e41f33af: { models: ['claude-haiku-4-5'] }, d4e5f6a7b8: { models: [] } },
          defaultAccount: 'c2e41f33af',
        },
      },
    })
    for (const account of ['c2e41f33af', 'd4e5f6a7b8']) {
      await ctx.credentials.modifyRecord(recordKeyFor('anthropic', account), () => Promise.resolve({ kind: 'api-key', key: `k-${account}` }))
    }

    expect(await listedIds(ctx, 'anthropic')).toEqual(['claude-haiku-4-5'])
  })
})
