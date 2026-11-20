/** The Stitch plugin index is the default source: listed without a request, fetched only when read. */
import { Context, Service } from '@deepseek-ai/cordis'
import { afterEach, expect, it, onTestFinished, vi } from 'vitest'
import PluginMarket from '../src/index.ts'
import { DEFAULT_PLUGIN_INDEXES } from '../src/index-url.ts'
import { COMMUNITY_PLUGIN_INDEXES, DEFAULT_PLUGIN_INDEX, isStitchPluginIndex, knownCommunityIndex } from '../src/indexes.ts'
import { parseIndexBody } from '../src/parse.ts'

// Parse in-process; parse-worker.spec.ts runs the real Worker.
vi.mock('../src/parse-thread.ts', () => ({
  parseIndexInWorker: async (body: Uint8Array, url: string, signal: AbortSignal) => {
    signal.throwIfAborted()
    return await Promise.resolve(parseIndexBody(body, url))
  },
}))

/** The document the `Morrowmake/stitch-plugins` repository publishes, as its generator writes it. */
const PUBLISHED = { format: 1, title: 'Stitch plugins', description: 'Community plugin index for Stitch', plugins: [] }

afterEach(() => { vi.unstubAllGlobals() })

async function mount(): Promise<PluginMarket> {
  const ctx = new Context()
  onTestFinished(() => ctx.fiber.dispose())
  class Manager extends Service {
    constructor(inner: Context) { super(inner, 'pluginManager') }
    listBundles() { return Promise.resolve([]) }
    listVersionExemptions() { return { exemptions: {}, warnings: [] } }
  }
  await ctx.plugin(Manager)
  await ctx.plugin(PluginMarket, { detailCacheDir: '/nonexistent/plugin-market-detail-cache' })
  return ctx.get('pluginMarket')!
}

it('configures only the Stitch index by default, without requesting it', async () => {
  const fetch = vi.fn(() => Promise.resolve(new Response(JSON.stringify(PUBLISHED))))
  vi.stubGlobal('fetch', fetch)

  const market = await mount()

  expect(DEFAULT_PLUGIN_INDEX).toBe('https://raw.githubusercontent.com/Morrowmake/stitch-plugins/main/index.json')
  expect(DEFAULT_PLUGIN_INDEXES).toEqual([DEFAULT_PLUGIN_INDEX])
  expect(market.listIndexes()).toEqual([{ url: DEFAULT_PLUGIN_INDEX }])
  expect(fetch).not.toHaveBeenCalled()
})

it('reads the published empty index when Discover searches it', async () => {
  const fetch = vi.fn(() => Promise.resolve(new Response(JSON.stringify(PUBLISHED))))
  vi.stubGlobal('fetch', fetch)
  const market = await mount()

  const result = await market.search(DEFAULT_PLUGIN_INDEX, { sort: { kind: 'index' }, offset: 0, limit: 20 })

  expect(fetch).toHaveBeenCalledOnce()
  expect(result).toMatchObject({ url: DEFAULT_PLUGIN_INDEX, title: 'Stitch plugins', total: 0, entries: [], nextOffset: null })
  expect(market.listIndexes()).toEqual([
    { url: DEFAULT_PLUGIN_INDEX, title: 'Stitch plugins', description: 'Community plugin index for Stitch' },
  ])
})

it('offers the DeepSeek Harness community indexes by address without configuring them', () => {
  expect(COMMUNITY_PLUGIN_INDEXES.map(index => index.url)).toEqual([
    'https://awesome-dsh-plugin.com/index.json',
    'https://cdn.dsh.so/market/index.json',
  ])
  expect(COMMUNITY_PLUGIN_INDEXES.every(index => !DEFAULT_PLUGIN_INDEXES.includes(index.url))).toBe(true)
  expect(isStitchPluginIndex(DEFAULT_PLUGIN_INDEX)).toBe(true)
  expect(COMMUNITY_PLUGIN_INDEXES.some(index => isStitchPluginIndex(index.url))).toBe(false)
  expect(isStitchPluginIndex('https://example.com/index.json')).toBe(false)
  expect(knownCommunityIndex('https://cdn.dsh.so/market/index.json')).toMatchObject({ id: 'plugin-market-cdn', harness: 'deepseek-harness' })
  expect(knownCommunityIndex(DEFAULT_PLUGIN_INDEX)).toBeUndefined()
})
