/** The Stitch plugin index is the default source: listed without a request, fetched only when read. */
import { Context, Service } from '@deepseek-ai/cordis'
import { afterEach, expect, it, onTestFinished, vi } from 'vitest'
import PluginMarket from '../src/index.ts'
import { DEFAULT_PLUGIN_INDEX, DEFAULT_PLUGIN_INDEXES } from '../src/index-url.ts'
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

it('configures the Stitch index, then the DeepSeek Harness indexes, by default without requesting them', async () => {
  const fetch = vi.fn(() => Promise.resolve(new Response(JSON.stringify(PUBLISHED))))
  vi.stubGlobal('fetch', fetch)

  const market = await mount()

  expect(DEFAULT_PLUGIN_INDEX).toBe('https://raw.githubusercontent.com/Morrowmake/stitch-plugins/main/index.json')
  expect(DEFAULT_PLUGIN_INDEXES).toEqual([
    DEFAULT_PLUGIN_INDEX,
    'https://awesome-dsh-plugin.com/index.json',
    'https://cdn.dsh.so/market/index.json',
  ])
  expect(market.listIndexes()).toEqual(DEFAULT_PLUGIN_INDEXES.map(url => ({ url })))
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
    ...DEFAULT_PLUGIN_INDEXES.slice(1).map(url => ({ url })),
  ])
})
