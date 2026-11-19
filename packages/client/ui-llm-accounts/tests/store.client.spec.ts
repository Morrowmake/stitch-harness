/**
 * The watcher holds one `llmAccounts.watch` stream per observer while held, keeps the last snapshot after release, and
 * the operations call the `llmAccounts` Remote and translate refusals.
 */
import type { Context } from '@deepseek-ai/cordis'
import type { RemoteStreamOptions } from '@deepseek-ai/dsh-api-gateway/client'
import { RemoteMock, ok, openStream } from '@deepseek-ai/dsh-remote-mock'
import { RemoteError } from '@deepseek-ai/dsh-typert-protocol'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { createAccountsOperations, outcomeOf } from '../src/client/operations.ts'
import { AccountsWatcher } from '../src/client/store.ts'
import { account, provider, snapshot } from './fixtures.client.ts'

let mock: RemoteMock

afterEach(() => { mock.assertNoUnmatched() })

/** A context whose `$stream` runs one generation of `open` and wraps each item with `accept`. */
function contextFor(remote: unknown): Context {
  return {
    logger: { warn: vi.fn() },
    remote: Object.assign(remote as object, {
      $stream: (options: RemoteStreamOptions<unknown>) => {
        const abort = new AbortController()
        const source = options.open(abort.signal)
        return {
          async *[Symbol.asyncIterator]() {
            for await (const value of source) yield { value, accept: () => {} }
          },
          dispose: vi.fn(async () => { abort.abort() }),
        }
      },
    }),
  } as never
}

describe('AccountsWatcher', () => {
  it('opens one usage stream per observer while held and keeps the snapshot after release', async () => {
    mock = RemoteMock.create()
    const first = snapshot(provider([account('main', { isDefault: true })]))
    mock.stream('llmAccounts/watch', openStream([first]))
    const ctx = contextFor(mock.remote)
    const watcher = new AccountsWatcher(ctx, (opts, signal) => mock.remote.llmAccounts.watch(opts, signal))
    const page = watcher.view()
    const releaseA = watcher.acquire()
    const releaseB = watcher.acquire()
    await mock.streams.opened('llmAccounts/watch', 1)
    await vi.waitFor(() => { expect(page.getSnapshot().snapshot).toEqual(first) })
    const releaseSession = watcher.acquire('s1')
    await mock.streams.opened('llmAccounts/watch', 2)
    expect(mock.remote.llmAccounts.watch.mock.calls.map(([opts]) => opts)).toEqual([{ usage: true }, { usage: true, sessionId: 's1' }])
    releaseA()
    releaseA()
    expect(mock.log.streams().filter(stream => stream.state === 'cancelled')).toHaveLength(0)
    releaseB()
    releaseSession()
    await vi.waitFor(() => { expect(mock.log.streams().filter(stream => stream.state === 'cancelled')).toHaveLength(2) })
    expect(page.getSnapshot()).toEqual({ snapshot: first, linked: true })
    await watcher.dispose()
  })

  it('marks the observer unlinked when the stream fails', async () => {
    mock = RemoteMock.create()
    mock.stream('llmAccounts/watch', (_args, handle) => { handle.fail(new Error('gone')) })
    const ctx = contextFor(mock.remote)
    const watcher = new AccountsWatcher(ctx, (opts, signal) => mock.remote.llmAccounts.watch(opts, signal))
    watcher.acquire()
    await vi.waitFor(() => { expect(watcher.view().getSnapshot().linked).toBe(false) })
    await watcher.dispose()
  })
})

describe('operations', () => {
  it('call the llmAccounts Remote and translate refusals', async () => {
    mock = RemoteMock.create()
    const ops = createAccountsOperations(contextFor(mock.remote))
    mock.remote.llmAccounts.setDefaultAccount.mockResolvedValue(ok(undefined))
    mock.remote.llmAccounts.beginSignIn.mockResolvedValue({
      ok: false, error: new RemoteError('llm-accounts/attempt-busy', 'busy', { provider: 'openai' }),
    })
    mock.remote.llmAccounts.usage.mockResolvedValue(ok({ supported: true, source: 'endpoint', windows: [] }))
    expect(await ops.setDefaultAccount('openai-codex', 'main')).toEqual({ ok: true, value: undefined })
    expect(await ops.beginSignIn('openai', { method: 'oauth' })).toEqual({ ok: false, reason: 'busy', message: 'busy' })
    await ops.refreshUsage('openai-codex', 'main')
    expect(mock.remote.llmAccounts.setDefaultAccount).toHaveBeenCalledWith('openai-codex', 'main')
    expect(mock.remote.llmAccounts.usage.mock.calls[0]?.slice(0, 3)).toEqual(['openai-codex', 'main', { force: true }])
  })

  it('lists the route catalog without pinned per-account entries', async () => {
    mock = RemoteMock.create()
    const ops = createAccountsOperations(contextFor(mock.remote))
    mock.remote.session.modelCatalog.mockResolvedValue(ok({
      groups: [
        { id: 'openai-codex', name: 'ChatGPT', models: [{ id: 'gpt-5.1', name: 'GPT-5.1' }, { id: '~acct:k3j9x0a1bc:gpt-5.1', name: 'GPT-5.1' }] },
        { id: 'anthropic', name: 'Claude', models: [{ id: 'claude', name: 'Claude' }] },
      ],
    } as never))
    expect(await ops.catalogModels('openai-codex')).toEqual({ ok: true, value: [{ id: 'gpt-5.1', name: 'GPT-5.1' }] })
    expect(await ops.catalogModels('groq')).toEqual({ ok: true, value: [] })
  })

  it('maps invalid keys and other refusals', () => {
    expect(outcomeOf({ ok: false, error: { code: 'llm-accounts/invalid-key', message: 'bad' } })).toMatchObject({ reason: 'invalid-key' })
    expect(outcomeOf({ ok: false, error: { code: 'llm-accounts/settings-rejected', message: 'no' } })).toMatchObject({ reason: 'other', message: 'no' })
  })
})
