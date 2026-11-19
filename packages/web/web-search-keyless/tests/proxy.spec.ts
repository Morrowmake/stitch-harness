/** Searches go through the process-wide dispatcher, so an installed outbound proxy carries them. */

import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { installProxyFromEnvironment } from '@deepseek-ai/dsh-http-proxy'
import { KeylessSearchProvider } from '../src/provider.ts'
import { fixture, reply, startSourceServer, type SourceServer } from './server.ts'

let proxy: SourceServer
let disposeProxy: (() => Promise<void>) | undefined

beforeEach(async () => {
  proxy = await startSourceServer((request, response) => {
    if (request.url.hostname === 'ddg.test') reply(response, 429, '')
    else reply(response, 200, fixture('marginalia.json'), 'application/json')
  })
})

afterEach(async () => {
  await disposeProxy?.()
  disposeProxy = undefined
  await proxy.close()
})

describe('searching through a proxy', () => {
  it('tunnels every source request through the installed proxy', async () => {
    const env = { get: (name: string) => (name === 'HTTP_PROXY' ? { value: proxy.origin } : undefined) }
    disposeProxy = await installProxyFromEnvironment(env, () => undefined)
    // These hosts never resolve; only the proxy can answer them.
    const keyless = new KeylessSearchProvider(() => ({
      marginaliaApiKey: 'public',
      timeoutMs: 5_000,
      maxResults: 10,
      duckduckgoUrl: 'http://ddg.test/html/',
      marginaliaUrl: 'http://marginalia.test',
    }))

    const result = await keyless.search({ query: 'q' })

    expect(result.sources[0]).toMatchObject({ url: 'https://cordis.example.org/docs/plugins.html' })
    expect(proxy.received.map(request => request.url.href)).toEqual([
      'http://ddg.test/html/',
      'http://marginalia.test/search?query=q&count=10',
    ])
  })
})
