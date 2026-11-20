/**
 * The local-server probe behind `llmAccounts.probeLocalProviders`: it reaches
 * only the fixed loopback listing URLs, reads each server's own listing
 * shape, and reports any refusal, foreign reply, oversized body, or timeout
 * as "not running".
 */
import { describe, expect, it, vi } from 'vitest'
import { LOCAL_SERVERS, probeLocalServers } from '../src/accounts/local-probe.ts'
import type { FetchFn } from '../src/accounts/usage/index.ts'

function json(body: unknown, init: ResponseInit = {}): Response {
  return new Response(JSON.stringify(body), { status: 200, headers: { 'content-type': 'application/json' }, ...init })
}

describe('probeLocalServers', () => {
  it('reads Ollama tags and LM Studio models from their default loopback ports only', async () => {
    const fetchFn = vi.fn<FetchFn>(async (input) => {
      const url = input
      if (url === 'http://localhost:11434/api/tags') {
        return json({ models: [{ name: 'llama3.2:latest' }, { name: 'qwen3:8b' }, { name: 'qwen3:8b' }, { model: 'no-name' }] })
      }
      if (url === 'http://localhost:1234/v1/models') return json({ object: 'list', data: [{ id: 'openai/gpt-oss-20b' }, { id: '' }] })
      throw new Error(`unexpected ${url}`)
    })
    const views = await probeLocalServers(fetchFn)
    expect(fetchFn.mock.calls.map(([url]) => new URL(url).hostname)).toEqual(['localhost', 'localhost'])
    expect(views).toEqual([
      { id: 'ollama', displayName: 'Ollama', baseURL: 'http://localhost:11434/v1', running: true, models: ['llama3.2:latest', 'qwen3:8b'] },
      { id: 'lmstudio', displayName: 'LM Studio', baseURL: 'http://localhost:1234/v1', running: true, models: ['openai/gpt-oss-20b'] },
    ])
  })

  it('reports refusals, error statuses, foreign and malformed replies as not running', async () => {
    const replies: Array<() => Promise<Response>> = [
      () => Promise.reject(new TypeError('fetch failed')),
      () => Promise.resolve(new Response('nope', { status: 500 })),
      () => Promise.resolve(json({ unexpected: true })),
      () => Promise.resolve(new Response('not json')),
      () => Promise.resolve(json(null)),
      () => Promise.resolve(new Response('x'.repeat(1024 * 1024 + 1))),
    ]
    for (const reply of replies) {
      const views = await probeLocalServers(() => reply())
      expect(views.map(view => [view.id, view.running, view.models])).toEqual([['ollama', false, []], ['lmstudio', false, []]])
    }
  })

  it('gives each server a short deadline and honours caller cancellation', async () => {
    const hang: FetchFn = (_input, init) => {
      const { promise, reject } = Promise.withResolvers<Response>()
      init?.signal?.addEventListener('abort', () => { reject(init.signal?.reason as Error) }, { once: true })
      return promise
    }
    const started = Date.now()
    const timedOut = await probeLocalServers(hang, undefined, 20)
    expect(timedOut.every(view => !view.running)).toBe(true)
    expect(Date.now() - started).toBeLessThan(1_000)

    const caller = new AbortController()
    const pending = probeLocalServers(hang, caller.signal, 60_000)
    caller.abort()
    expect((await pending).every(view => !view.running)).toBe(true)
  })

  it('lists Ollama before LM Studio', () => {
    expect(LOCAL_SERVERS.map(server => server.id)).toEqual(['ollama', 'lmstudio'])
  })
})
