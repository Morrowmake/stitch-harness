/** The plugin entry: Config defaults and validation, registration into `ctx.web`, and disposal. */

import { afterEach, describe, expect, it, vi } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import WebRuntime from '@deepseek-ai/dsh-web'
import * as keylessPlugin from '@deepseek-ai/dsh-web-search-keyless'
import { liveConfig } from '../../../settings/settings/tests/live-config.ts'
import { BROWSER_USER_AGENT } from '../src/transport.ts'
import { fixture } from './server.ts'

afterEach(() => {
  vi.unstubAllGlobals()
  vi.restoreAllMocks()
})

/**
 * Answer every request from a route table keyed by origin and path.
 * @param routes - responses by `origin + pathname`.
 * @returns the stubbed `fetch`.
 */
function stubNetwork(routes: Record<string, () => Response>) {
  const fetchMock = vi.fn((input: URL | string, _init?: RequestInit) => {
    const url = new URL(String(input))
    const route = routes[`${url.origin}${url.pathname}`]
    return Promise.resolve(route === undefined ? new Response('', { status: 404 }) : route())
  })
  vi.stubGlobal('fetch', fetchMock)
  return fetchMock
}

const DDG = 'https://html.duckduckgo.com/html/'
const MARGINALIA = 'https://api2.marginalia-search.com/search'

async function boot(config: Record<string, unknown>) {
  const ctx = new Context()
  await ctx.plugin(WebRuntime, {})
  const fiber = await ctx.plugin(keylessPlugin, config)
  return { ctx, fiber }
}

describe('web-search-keyless plugin', () => {
  it('declares the plugin entry shape', () => {
    expect(keylessPlugin.name).toBe('web-search-keyless')
    expect(keylessPlugin.inject).toEqual(['web'])
    expect(Object.keys(keylessPlugin).sort()).toEqual(['Config', 'apply', 'inject', 'name'])
  })

  it('fills defaults: the public Marginalia key, a 10 s timeout, and 10 results', () => {
    const resolved = keylessPlugin.Config({})
    expect(resolved).toMatchObject({ marginaliaApiKey: 'public', sources: [], timeout: 10_000, maxResults: 10 })
    expect(resolved.searxngUrl.get()).toBeUndefined()
    expect(() => keylessPlugin.Config({ sources: ['bing' as never] })).toThrow()
    expect(() => keylessPlugin.Config({ timeout: 0 })).toThrow()
    expect(() => keylessPlugin.Config({ maxResults: 101 })).toThrow()
  })

  it('is the only search provider, so ctx.web selects it without configuration', async () => {
    const fetchMock = stubNetwork({ [DDG]: () => new Response(fixture('duckduckgo-results.html'), { status: 200 }) })
    const { ctx, fiber } = await boot({})

    const result = await ctx.web.search({ query: 'cordis', maxResults: 2 })

    expect(result.sources.map(source => source.url)).toEqual([
      'https://github.com/cordiverse/cordis',
      'https://floatboat.ai/blog/cordis-plugin-framework',
    ])
    const init = fetchMock.mock.calls[0]?.[1]
    expect(init).toMatchObject({ method: 'POST', redirect: 'error', credentials: 'omit' })
    expect(init?.headers).toMatchObject({ 'user-agent': BROWSER_USER_AGENT })
    expect(await ctx.web.searchReady(undefined)).toBe(true)
    await fiber.dispose()
  })

  it('lists the provider with its picker description', async () => {
    const { ctx, fiber } = await boot({})
    const [listed] = ctx.web.listProviders().search
    expect(listed).toMatchObject({ id: 'keyless' })
    expect(Object.keys(listed!.description!).sort()).toEqual(['de', 'en', 'es', 'fr', 'ja', 'pt', 'ru', 'zh'])
    await fiber.dispose()
  })

  it('falls back to Marginalia with the configured key and logs the DuckDuckGo failure', async () => {
    const fetchMock = stubNetwork({
      [DDG]: () => new Response(fixture('duckduckgo-challenge.html'), { status: 202 }),
      [MARGINALIA]: () => new Response(fixture('marginalia.json'), { status: 200 }),
    })
    const { ctx, fiber } = await boot({ marginaliaApiKey: 'paid-key', maxResults: 1 })
    const debug = vi.spyOn(ctx.logger, 'debug')

    const result = await ctx.web.search({ query: 'cordis', maxResults: 5 })

    expect(result.sources).toEqual([expect.objectContaining({ url: 'https://cordis.example.org/docs/plugins.html' })])
    const [url, init] = fetchMock.mock.calls[1] as [URL, RequestInit]
    expect(url.searchParams.get('count')).toBe('1')
    expect(init.headers).toMatchObject({ 'api-key': 'paid-key' })
    expect(debug).toHaveBeenCalledWith(
      'web-search-keyless: duckduckgo failed (WEB_SEARCH_RATE_LIMITED): DuckDuckGo is rate-limiting searches (HTTP 202 bot challenge)',
    )
    await fiber.dispose()
  })

  it('searches only the configured SearXNG instance, and ignores an empty URL', async () => {
    const fetchMock = stubNetwork({
      'https://searx.example/search': () => new Response(fixture('searxng.json'), { status: 200 }),
      [DDG]: () => new Response(fixture('duckduckgo-results.html'), { status: 200 }),
    })
    const searx = await boot({ searxngUrl: 'https://searx.example/' })
    expect((await searx.ctx.web.search({ query: 'q' })).sources).toHaveLength(2)
    expect(fetchMock).toHaveBeenCalledTimes(1)
    await searx.fiber.dispose()

    const empty = await boot({ searxngUrl: '' })
    await empty.ctx.web.search({ query: 'q' })
    expect(String(fetchMock.mock.calls[1]?.[0])).toBe(DDG)
    await empty.fiber.dispose()
  })

  it('sends the next search to a saved SearXNG URL without re-registering the provider', async () => {
    const fetchMock = stubNetwork({
      'https://searx.saved.example/search': () => new Response(fixture('searxng.json'), { status: 200 }),
      [DDG]: () => new Response(fixture('duckduckgo-results.html'), { status: 200 }),
    })
    const ctx = new Context()
    await ctx.plugin(WebRuntime, {})
    const live = await liveConfig(ctx, keylessPlugin, {})
    const changed = vi.fn()
    ctx.on('web/providers-changed', changed)

    await ctx.web.search({ query: 'q' })
    await live.update({ searxngUrl: 'https://searx.saved.example/' })
    await ctx.web.search({ query: 'q' })

    expect(fetchMock.mock.calls.map(([input]) => String(input).split('?')[0])).toEqual([DDG, 'https://searx.saved.example/search'])
    expect(changed).not.toHaveBeenCalled()
    await ctx.fiber.dispose()
  })

  it('follows a configured source order', async () => {
    const fetchMock = stubNetwork({ [MARGINALIA]: () => new Response(fixture('marginalia.json'), { status: 200 }) })
    const { ctx, fiber } = await boot({ sources: ['marginalia', 'duckduckgo'] })
    await ctx.web.search({ query: 'q' })
    expect(fetchMock).toHaveBeenCalledTimes(1)
    expect(String(fetchMock.mock.calls[0]?.[0])).toMatch(/^https:\/\/api2\.marginalia-search\.com\/search\?/u)
    await fiber.dispose()
  })

  it('removes the provider when its fiber is disposed (HMR-safe)', async () => {
    const { ctx, fiber } = await boot({})
    expect(ctx.web.listProviders().search.map(entry => entry.id)).toEqual(['keyless'])
    await fiber.dispose()
    expect(ctx.web.listProviders().search).toEqual([])
    await expect(ctx.web.search({ query: 'q' })).rejects.toMatchObject({ code: 'WEB_PROVIDER_UNAVAILABLE' })
  })
})
