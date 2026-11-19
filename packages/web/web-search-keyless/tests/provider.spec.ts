/** The source chain: which sources a search tries, in which order, and how failures combine. */

import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import { WebError } from '@deepseek-ai/dsh-web'
import { KEYLESS_PROVIDER_ID, KeylessSearchProvider, searchOrder } from '../src/provider.ts'
import type { KeylessSearchOptions } from '../src/provider.ts'
import { fixture, reply, startSourceServer, type Handler, type SourceServer } from './server.ts'

let server: SourceServer
const routes = new Map<string, Handler>()

beforeAll(async () => {
  server = await startSourceServer((request, response) => {
    const route = routes.get(request.url.pathname)
    if (route === undefined) reply(response, 404, '')
    else route(request, response)
  })
})

afterAll(async () => { await server.close() })

beforeEach(() => {
  server.received.length = 0
  routes.clear()
  routes.set('/html/', (_request, response) => { reply(response, 200, fixture('duckduckgo-results.html')) })
  routes.set('/marginalia/search', (_request, response) => { reply(response, 200, fixture('marginalia.json'), 'application/json') })
  routes.set('/searx/search', (_request, response) => { reply(response, 200, fixture('searxng.json'), 'application/json') })
})

function provider(overrides: Partial<KeylessSearchOptions> = {}): KeylessSearchProvider {
  return new KeylessSearchProvider(() => ({
    marginaliaApiKey: 'public',
    timeoutMs: 5_000,
    maxResults: 10,
    duckduckgoUrl: `${server.origin}/html/`,
    marginaliaUrl: `${server.origin}/marginalia`,
    ...overrides,
  }))
}

const paths = () => server.received.map(request => request.url.pathname)

describe('search order', () => {
  const base = { marginaliaApiKey: 'public', timeoutMs: 1, maxResults: 1 }

  it('defaults to DuckDuckGo then Marginalia', () => {
    expect(searchOrder(base)).toEqual(['duckduckgo', 'marginalia'])
  })

  it('uses SearXNG alone when its URL is usable', () => {
    expect(searchOrder({ ...base, searxngUrl: 'https://searx.example/' })).toEqual(['searxng'])
    expect(searchOrder({ ...base, searxngUrl: 'not a url' })).toEqual(['duckduckgo', 'marginalia'])
  })

  it('follows a configured order, dropping unusable sources and repeats', () => {
    expect(searchOrder({ ...base, sources: ['marginalia', 'duckduckgo', 'marginalia'] })).toEqual(['marginalia', 'duckduckgo'])
    expect(searchOrder({ ...base, sources: ['searxng', 'duckduckgo'] })).toEqual(['duckduckgo'])
    expect(searchOrder({ ...base, sources: ['searxng', 'marginalia'], searxngUrl: 'https://searx.example/' })).toEqual(['searxng', 'marginalia'])
    expect(searchOrder({ ...base, sources: [] })).toEqual(['duckduckgo', 'marginalia'])
  })

  it('drops Marginalia without a key, and is unavailable with no usable source', () => {
    expect(searchOrder({ ...base, marginaliaApiKey: '' })).toEqual(['duckduckgo'])
    expect(provider({ sources: ['marginalia'], marginaliaApiKey: '' }).available()).toBe(false)
    expect(provider().available()).toBe(true)
  })
})

describe('keyless search', () => {
  it('registers under a stable id with a description', () => {
    const keyless = provider()
    expect(keyless.id).toBe(KEYLESS_PROVIDER_ID)
    expect(keyless.description).toMatchObject({ en: expect.stringContaining('no account or key') as string })
  })

  it('answers from DuckDuckGo without contacting Marginalia', async () => {
    const result = await provider().search({ query: 'q' })
    expect(result.truncated).toBe(false)
    expect(result.sources[0]).toMatchObject({ url: 'https://github.com/cordiverse/cordis' })
    expect(paths()).toEqual(['/html/'])
  })

  it('accepts an empty DuckDuckGo answer without falling back', async () => {
    routes.set('/html/', (_request, response) => { reply(response, 200, fixture('duckduckgo-no-results.html')) })
    await expect(provider().search({ query: 'q' })).resolves.toEqual({ sources: [], truncated: false })
    expect(paths()).toEqual(['/html/'])
  })

  it('falls back to Marginalia when DuckDuckGo challenges the search', async () => {
    routes.set('/html/', (_request, response) => { reply(response, 202, fixture('duckduckgo-challenge.html')) })
    const failures: string[] = []

    const result = await provider({ onSourceFailure: (source, error) => { failures.push(`${source}:${error.code}`) } }).search({ query: 'q' })

    expect(result.sources[0]).toMatchObject({ url: 'https://cordis.example.org/docs/plugins.html' })
    expect(paths()).toEqual(['/html/', '/marginalia/search'])
    expect(failures).toEqual(['duckduckgo:WEB_SEARCH_RATE_LIMITED'])
  })

  it('falls back on a DuckDuckGo timeout or markup it cannot read', async () => {
    routes.set('/html/', () => { /* never answers */ })
    const answered = await provider({ timeoutMs: 50 }).search({ query: 'q' })
    expect(answered.sources[0]).toMatchObject({ url: 'https://cordis.example.org/docs/plugins.html' })
    expect(paths()).toEqual(['/html/', '/marginalia/search'])

    server.received.length = 0
    routes.set('/html/', (_request, response) => { reply(response, 200, '<html><body>changed</body></html>') })
    await provider().search({ query: 'q' })
    expect(paths()).toEqual(['/html/', '/marginalia/search'])
  })

  it('searches only SearXNG when it is configured', async () => {
    const result = await provider({ searxngUrl: `${server.origin}/searx` }).search({ query: 'q' })
    expect(result.sources).toHaveLength(2)
    expect(paths()).toEqual(['/searx/search'])
  })

  it('passes the only source\'s failure through unchanged', async () => {
    routes.set('/searx/search', (_request, response) => { reply(response, 403, '') })
    await expect(provider({ searxngUrl: `${server.origin}/searx` }).search({ query: 'q' }))
      .rejects.toMatchObject({ code: 'WEB_PROVIDER_MISCONFIGURED' })
  })

  it('combines the failures of every source, as rate limiting when every source rate-limits', async () => {
    routes.set('/html/', (_request, response) => { reply(response, 429, '') })
    routes.set('/marginalia/search', (_request, response) => { reply(response, 429, 'Daily Limit Exceeded', 'text/plain') })

    const failure = provider().search({ query: 'q' })

    await expect(failure).rejects.toMatchObject({
      code: 'WEB_SEARCH_RATE_LIMITED',
      message: 'Web search failed on every source: DuckDuckGo is rate-limiting searches (HTTP 429); '
        + 'Marginalia is rate-limiting searches (HTTP 429: Daily Limit Exceeded). Public sources limit request rates;'
        + ' retry later, or guide the user to configure a SearXNG instance in web-search-keyless.searxngUrl.',
    })
    const cause = await failure.catch((error: unknown) => (error as WebError).cause)
    expect(cause).toBeInstanceOf(AggregateError)
  })

  it('combines mixed failures as a provider error', async () => {
    routes.set('/html/', (_request, response) => { reply(response, 429, '') })
    routes.set('/marginalia/search', (_request, response) => { reply(response, 500, '') })
    await expect(provider().search({ query: 'q' })).rejects.toMatchObject({ code: 'WEB_PROVIDER_ERROR' })
  })

  it('fails as unavailable when no source can run', async () => {
    await expect(provider({ sources: ['marginalia'], marginaliaApiKey: '' }).search({ query: 'q' }))
      .rejects.toMatchObject({ code: 'WEB_PROVIDER_UNAVAILABLE' })
  })

  it('stops the chain on caller cancellation', async () => {
    const controller = new AbortController()
    routes.set('/html/', () => { controller.abort(new Error('stop')) })
    const onSourceFailure = vi.fn()

    await expect(provider({ onSourceFailure }).search({ query: 'q' }, controller.signal)).rejects.toMatchObject({ code: 'WEB_ABORTED' })

    expect(paths()).toEqual(['/html/'])
    expect(onSourceFailure).not.toHaveBeenCalled()
  })

  it('rethrows a failure that is not a web error', async () => {
    await expect(provider({ duckduckgoUrl: 'not a url' }).search({ query: 'q' })).rejects.toBeInstanceOf(TypeError)
  })

  it('bounds results by the smaller of the request and configured limits', async () => {
    expect((await provider({ maxResults: 3 }).search({ query: 'q', maxResults: 8 })).sources).toHaveLength(3)
    expect((await provider({ maxResults: 10 }).search({ query: 'q', maxResults: 2 })).sources).toHaveLength(2)
    expect((await provider({ maxResults: 10 }).search({ query: 'q', maxResults: 0 })).sources).toHaveLength(1)

    server.received.length = 0
    await provider({ sources: ['marginalia'], maxResults: 4 }).search({ query: 'q' })
    expect(server.received[0]?.url.searchParams.get('count')).toBe('4')
  })
})
