/**
 * Each source against a loopback stand-in: the request it sends, how it reads statuses and pages,
 * and the transport rules every source shares (deadline, cancellation, redirects, body cap).
 */

import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import { searchDuckDuckGo } from '../src/duckduckgo.ts'
import { searchMarginalia } from '../src/marginalia.ts'
import { isSearxngBaseUrl, searchSearxng } from '../src/searxng.ts'
import { BROWSER_USER_AGENT, MAX_RESPONSE_BYTES, sendSourceRequest } from '../src/transport.ts'
import { fixture, reply, startSourceServer, type SourceServer } from './server.ts'

let server: SourceServer
let target: SourceServer

beforeAll(async () => {
  server = await startSourceServer((_request, response) => { reply(response, 500, '') })
  target = await startSourceServer((_request, response) => { reply(response, 200, 'redirect target') })
})

afterAll(async () => {
  await Promise.all([server.close(), target.close()])
})

beforeEach(() => {
  server.received.length = 0
  target.received.length = 0
})

const ddg = (limit = 10, timeoutMs = 5_000) => ({ query: 'cordis plugin framework', limit, endpoint: `${server.origin}/html/`, timeoutMs })
const marginalia = (limit = 10, apiKey = 'public') => ({
  query: 'cordis plugin framework', limit, endpoint: `${server.origin}/marginalia/`, apiKey, timeoutMs: 5_000,
})
const searxng = (baseUrl = `${server.origin}/searx/`) => ({ query: 'cordis & co', limit: 10, baseUrl, timeoutMs: 5_000 })

describe('DuckDuckGo source', () => {
  it('POSTs the query as a form with a browser User-Agent and no cookie or referrer', async () => {
    server.handle((_request, response) => { reply(response, 200, fixture('duckduckgo-results.html')) })

    const sources = await searchDuckDuckGo(ddg(2))

    expect(sources.map(source => source.url)).toEqual([
      'https://github.com/cordiverse/cordis',
      'https://floatboat.ai/blog/cordis-plugin-framework',
    ])
    const [request] = server.received
    expect(request?.method).toBe('POST')
    expect(request?.url.pathname).toBe('/html/')
    expect(request?.url.search).toBe('')
    expect(request?.body).toBe('q=cordis+plugin+framework')
    expect(request?.headers['content-type']).toBe('application/x-www-form-urlencoded')
    expect(request?.headers['user-agent']).toBe(BROWSER_USER_AGENT)
    expect(request?.headers.cookie).toBeUndefined()
    expect(request?.headers.referer).toBeUndefined()
  })

  it.each([
    [202, fixture('duckduckgo-challenge.html'), 'DuckDuckGo is rate-limiting searches (HTTP 202 bot challenge)'],
    [403, 'Forbidden', 'DuckDuckGo is rate-limiting searches (HTTP 403)'],
    [429, '', 'DuckDuckGo is rate-limiting searches (HTTP 429)'],
    [200, fixture('duckduckgo-challenge.html'), 'DuckDuckGo is rate-limiting searches (bot challenge)'],
  ])('reports HTTP %i with a refusal as rate limiting', async (status, body, message) => {
    server.handle((_request, response) => { reply(response, status, body) })
    await expect(searchDuckDuckGo(ddg())).rejects.toMatchObject({ code: 'WEB_SEARCH_RATE_LIMITED', message })
  })

  it('reports another status as a provider error', async () => {
    server.handle((_request, response) => { reply(response, 500, 'oops') })
    await expect(searchDuckDuckGo(ddg())).rejects.toMatchObject({ code: 'WEB_PROVIDER_ERROR', message: 'DuckDuckGo answered HTTP 500' })
  })
})

describe('Marginalia source', () => {
  it('sends the query, the bounded count, and the API key', async () => {
    server.handle((_request, response) => { reply(response, 200, fixture('marginalia.json'), 'application/json') })

    const sources = await searchMarginalia(marginalia(2, 'my-key'))

    expect(sources.map(source => source.url)).toEqual([
      'https://cordis.example.org/docs/plugins.html',
      'https://blog.example.net/2019/plugin-frameworks',
    ])
    const [request] = server.received
    expect(request?.method).toBe('GET')
    expect(request?.url.pathname).toBe('/marginalia/search')
    expect(Object.fromEntries(request!.url.searchParams)).toEqual({ query: 'cordis plugin framework', count: '2' })
    expect(request?.headers['api-key']).toBe('my-key')
    expect(request?.headers['user-agent']).toBe(BROWSER_USER_AGENT)
  })

  it('caps count at the API maximum', async () => {
    server.handle((_request, response) => { reply(response, 200, '{"results":[]}', 'application/json') })
    await searchMarginalia(marginalia(500))
    expect(server.received[0]?.url.searchParams.get('count')).toBe('100')
  })

  it.each([
    [429, 'Daily Limit Exceeded', 'Marginalia is rate-limiting searches (HTTP 429: Daily Limit Exceeded)'],
    [503, '<html>busy</html>', 'Marginalia is rate-limiting searches (HTTP 503)'],
  ])('reports HTTP %i as rate limiting', async (status, body, message) => {
    server.handle((_request, response) => { reply(response, status, body, 'text/plain') })
    await expect(searchMarginalia(marginalia())).rejects.toMatchObject({ code: 'WEB_SEARCH_RATE_LIMITED', message })
  })

  it('reports a rejected key with the setting that restores the shared key', async () => {
    server.handle((_request, response) => { reply(response, 401, '') })
    await expect(searchMarginalia(marginalia())).rejects.toMatchObject({
      code: 'WEB_PROVIDER_ERROR',
      message: 'Marginalia rejected the configured API key (HTTP 401); the user can restore the shared "public" key in web-search-keyless.marginaliaApiKey',
    })
  })

  it('reports another status with a short text body, omitting a long one', async () => {
    server.handle((_request, response) => { reply(response, 500, 'Internal failure', 'text/plain') })
    await expect(searchMarginalia(marginalia())).rejects.toMatchObject({ code: 'WEB_PROVIDER_ERROR', message: 'Marginalia answered HTTP 500: Internal failure' })
    server.handle((_request, response) => { reply(response, 502, 'x'.repeat(201), 'text/plain') })
    await expect(searchMarginalia(marginalia())).rejects.toMatchObject({ message: 'Marginalia answered HTTP 502' })
  })
})

describe('SearXNG source', () => {
  it('accepts only an http(s) base URL without credentials', () => {
    expect(isSearxngBaseUrl('https://searx.example/')).toBe(true)
    expect(isSearxngBaseUrl('http://127.0.0.1:8888')).toBe(true)
    expect(isSearxngBaseUrl('https://user:pass@searx.example/')).toBe(false)
    expect(isSearxngBaseUrl('ftp://searx.example/')).toBe(false)
    expect(isSearxngBaseUrl('searx.example')).toBe(false)
  })

  it('searches below the instance path in the JSON format', async () => {
    server.handle((_request, response) => { reply(response, 200, fixture('searxng.json'), 'application/json') })

    const sources = await searchSearxng(searxng(`${server.origin}/searx//?stale=1#frag`))

    expect(sources).toHaveLength(2)
    const [request] = server.received
    expect(request?.url.pathname).toBe('/searx/search')
    expect(Object.fromEntries(request!.url.searchParams)).toEqual({ q: 'cordis & co', format: 'json' })
  })

  it('explains HTTP 403 as the JSON format being disabled', async () => {
    server.handle((_request, response) => { reply(response, 403, 'Forbidden') })
    await expect(searchSearxng(searxng())).rejects.toMatchObject({
      code: 'WEB_PROVIDER_MISCONFIGURED',
      message: `SearXNG at ${server.origin} refused the JSON format (HTTP 403). The instance must list json under`
        + ' search.formats in its settings.yml; guide the user to enable it or to configure another instance.',
    })
  })

  it('reports HTTP 429 as rate limiting and another status as a provider error', async () => {
    server.handle((_request, response) => { reply(response, 429, '') })
    await expect(searchSearxng(searxng())).rejects.toMatchObject({ code: 'WEB_SEARCH_RATE_LIMITED', message: 'SearXNG is rate-limiting searches (HTTP 429)' })
    server.handle((_request, response) => { reply(response, 502, '') })
    await expect(searchSearxng(searxng())).rejects.toMatchObject({ code: 'WEB_PROVIDER_ERROR', message: 'SearXNG answered HTTP 502' })
  })
})

describe('shared transport', () => {
  const request = (path: string, timeoutMs = 5_000) => ({
    label: 'Stand-in', url: new URL(`${server.origin}${path}`), method: 'GET' as const, headers: {}, timeoutMs,
  })

  it('refuses a redirect without contacting its target', async () => {
    server.handle((_request, response) => {
      response.writeHead(302, { location: `${target.origin}/collect` })
      response.end()
    })
    await expect(sendSourceRequest(request('/moved'))).rejects.toMatchObject({ code: 'WEB_PROVIDER_ERROR', message: expect.stringMatching(/^Stand-in request failed: /u) as string })
    expect(target.received).toHaveLength(0)
  })

  it('times out a source that does not answer', async () => {
    server.handle(() => { /* never answers */ })
    await expect(sendSourceRequest(request('/slow', 50))).rejects.toMatchObject({ code: 'WEB_SEARCH_TIMEOUT', message: 'Stand-in did not answer within 50 ms' })
  })

  it('times out a body that stalls after the headers', async () => {
    server.handle((_request, response) => {
      response.writeHead(200, { 'content-type': 'text/html' })
      response.write('<html>')
    })
    await expect(sendSourceRequest(request('/stall', 50))).rejects.toMatchObject({ code: 'WEB_SEARCH_TIMEOUT' })
  })

  it('stops on caller cancellation, before or during the request', async () => {
    const before = new AbortController()
    before.abort(new Error('stop'))
    await expect(sendSourceRequest(request('/never'), before.signal)).rejects.toMatchObject({ code: 'WEB_ABORTED', message: 'web search aborted' })
    expect(server.received).toHaveLength(0)

    const during = new AbortController()
    server.handle(() => { during.abort(new Error('stop')) })
    await expect(sendSourceRequest(request('/hang'), during.signal)).rejects.toMatchObject({ code: 'WEB_ABORTED' })
  })

  it('fails a body larger than the cap', async () => {
    server.handle((_request, response) => {
      response.writeHead(200, { 'content-type': 'text/html' })
      response.end('x'.repeat(MAX_RESPONSE_BYTES + 1))
    })
    await expect(sendSourceRequest(request('/huge'))).rejects.toMatchObject({
      code: 'WEB_PROVIDER_ERROR', message: `Stand-in returned more than ${MAX_RESPONSE_BYTES} bytes`,
    })
  })

  it('reads a multibyte body split across chunks', async () => {
    server.handle((_request, response) => {
      const bytes = Buffer.from('héllo — 世界', 'utf8')
      response.writeHead(200, { 'content-type': 'text/plain' })
      response.write(bytes.subarray(0, 2))
      response.end(bytes.subarray(2))
    })
    await expect(sendSourceRequest(request('/utf8'))).resolves.toEqual({ status: 200, body: 'héllo — 世界' })
  })

  it('names the transport failure of an unreachable source', async () => {
    const closed = await startSourceServer(() => {})
    await closed.close()
    await expect(sendSourceRequest({ ...request('/'), url: new URL(`${closed.origin}/`) }))
      .rejects.toMatchObject({ code: 'WEB_PROVIDER_ERROR', message: expect.stringContaining('ECONNREFUSED') as string })
  })

  it('names every address a dual-stack connection attempted', async () => {
    const attempts = new AggregateError([
      Object.assign(new Error('connect ETIMEDOUT 192.0.2.1:443'), { code: 'ETIMEDOUT' }),
      Object.assign(new Error('connect EHOSTUNREACH 2001:db8::1:443'), { code: 'EHOSTUNREACH' }),
    ], '')
    vi.stubGlobal('fetch', vi.fn(() => Promise.reject(new TypeError('fetch failed', { cause: attempts }))))
    try {
      await expect(sendSourceRequest(request('/'))).rejects.toMatchObject({
        code: 'WEB_PROVIDER_ERROR',
        message: 'Stand-in request failed: connect ETIMEDOUT 192.0.2.1:443; connect EHOSTUNREACH 2001:db8::1:443',
      })
    } finally {
      vi.unstubAllGlobals()
    }
  })
})
