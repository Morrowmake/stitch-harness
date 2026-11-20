/**
 * The product CLI store: when it reads statuses, how a download, its progress, its cancellation, and a removal cross
 * the wire, and which failure each refusal becomes.
 */
import { Context } from '@deepseek-ai/cordis'
import { RemoteError, TestRemote } from '@deepseek-ai/dsh-client-test-runtime'
import type { PluginInstallRequestId, ProductCliId, ProductCliStatus } from '@deepseek-ai/dsh-api-remotes/client'
import { expect, it, onTestFinished, vi } from 'vitest'
import { downloadPercent, ProductCliController } from '../src/client/product-cli-store.ts'

type Answer<T> = { readonly ok: true; readonly value: T } | { readonly ok: false; readonly error: RemoteError<never> }
const ok = <T>(value: T): Promise<Answer<T>> => Promise.resolve({ ok: true, value })
const refused = <T>(code: string, details: object = {}): Promise<Answer<T>> =>
  // The double's code map is keyed by literal codes; a spec-chosen string stands in.
  Promise.resolve({ ok: false, error: new RemoteError(code as never, 'refused', details as never) })
const flush = () => new Promise((resolve) => { setTimeout(resolve, 0) })

const MISSING: ProductCliStatus = {
  id: 'claude-code', bundle: '@deepseek-ai/dsh-subagent-claude-code', displayName: 'Claude Code', available: false,
  tooOld: [], minimumVersion: '2.0.0', download: { version: '2.1.328', sizeBytes: 191_000_000 }, downloaded: false,
  installCommand: 'npm install -g @anthropic-ai/claude-code',
}
const DOWNLOADED: ProductCliStatus = {
  ...MISSING, available: true, source: 'downloaded', path: '/stitch/product-cli/claude', version: '2.1.328', downloaded: true,
}
const CODEX: ProductCliStatus = {
  id: 'codex', bundle: '@deepseek-ai/dsh-subagent-codex', displayName: 'Codex', available: true, source: 'installed',
  path: '/usr/local/bin/codex', version: '0.3.263', tooOld: [], minimumVersion: '0.3.0', download: null, downloaded: false,
  installCommand: 'npm install -g @openai/codex',
}

function setup() {
  const ctx = new Context()
  onTestFinished(() => ctx.fiber.dispose())
  const manager = {
    listProductClis: vi.fn((): Promise<Answer<ProductCliStatus[]>> => ok([MISSING, CODEX])),
    downloadProductCli: vi.fn((_id: ProductCliId, _requestId: PluginInstallRequestId): Promise<Answer<ProductCliStatus>> => ok(DOWNLOADED)),
    cancelProductCliDownload: vi.fn((_requestId: PluginInstallRequestId): Promise<Answer<boolean>> => ok(true)),
    removeProductCli: vi.fn((_id: ProductCliId): Promise<Answer<ProductCliStatus>> => ok(MISSING)),
  }
  new TestRemote(ctx, { pluginManager: manager })
  const controller = new ProductCliController(ctx)
  onTestFinished(() => { controller.dispose() })
  return { controller, manager, state: () => controller.store.getSnapshot() }
}

/** Hold a call's answer until the test releases it. */
function held<T>() {
  const { promise, resolve } = Promise.withResolvers<Answer<T>>()
  return { promise, release: resolve }
}

it('reads statuses once a page asks, and again on Host changes only after that', async () => {
  const { controller, manager, state } = setup()
  controller.refresh()
  expect(manager.listProductClis).not.toHaveBeenCalled()
  controller.ensure()
  expect(state().status).toBe('loading')
  await vi.waitFor(() => { expect(state()).toEqual({ status: 'ready', clis: [MISSING, CODEX], tasks: {} }) })
  controller.ensure()
  expect(manager.listProductClis).toHaveBeenCalledOnce()
  controller.refresh()
  // A ready page keeps showing its statuses while the next read runs.
  expect(state().status).toBe('ready')
  await vi.waitFor(() => { expect(manager.listProductClis).toHaveBeenCalledTimes(2) })
})

it('keeps the last statuses on a failed read and drops a superseded answer', async () => {
  const { controller, manager, state } = setup()
  manager.listProductClis.mockImplementationOnce(() => refused('gateway/internal'))
  await controller.load()
  expect(state()).toEqual({ status: 'error', clis: [], tasks: {} })
  const first = held<ProductCliStatus[]>()
  manager.listProductClis.mockImplementationOnce(() => first.promise)
  const stale = controller.load()
  await controller.load()
  first.release({ ok: true, value: [] })
  await stale
  expect(state().clis).toEqual([MISSING, CODEX])
})

it('downloads only when asked, folds its own progress, and reads again once the copy is in place', async () => {
  const { controller, manager, state } = setup()
  await controller.load()
  const answer = held<ProductCliStatus>()
  manager.downloadProductCli.mockImplementationOnce(() => answer.promise)
  const done = controller.download('claude-code')
  const requestId = manager.downloadProductCli.mock.calls[0]![1]
  expect(manager.downloadProductCli.mock.calls[0]![0]).toBe('claude-code')
  expect(typeof requestId).toBe('string')
  expect(state().tasks['claude-code']).toEqual({ kind: 'download', requestId, phase: 'downloading', receivedBytes: 0, totalBytes: 0, cancelling: false })
  // A second click while it runs starts nothing.
  void controller.download('claude-code')
  expect(manager.downloadProductCli).toHaveBeenCalledOnce()
  controller.progress({ requestId: 'other' as PluginInstallRequestId, id: 'claude-code', phase: 'downloading', receivedBytes: 5, totalBytes: 10 })
  controller.progress({ requestId, id: 'codex', phase: 'downloading', receivedBytes: 5, totalBytes: 10 })
  expect(state().tasks['claude-code']).toMatchObject({ receivedBytes: 0 })
  expect(state().tasks.codex).toBeUndefined()
  controller.progress({ requestId, id: 'claude-code', phase: 'downloading', receivedBytes: 95_500_000, totalBytes: 191_000_000 })
  const task = state().tasks['claude-code']
  expect(task?.kind === 'download' ? downloadPercent(task) : undefined).toBe(50)
  controller.progress({ requestId, id: 'claude-code', phase: 'verifying', receivedBytes: 191_000_000, totalBytes: 191_000_000 })
  expect(state().tasks['claude-code']).toMatchObject({ phase: 'verifying' })
  manager.listProductClis.mockImplementationOnce(() => ok([DOWNLOADED, CODEX]))
  answer.release({ ok: true, value: DOWNLOADED })
  await done
  expect(state()).toEqual({ status: 'ready', clis: [DOWNLOADED, CODEX], tasks: {} })
  expect(manager.listProductClis).toHaveBeenCalledTimes(2)
})

it('reports a size-less download without a percent and caps an overrun', () => {
  const base = { kind: 'download' as const, requestId: 'r' as PluginInstallRequestId, phase: 'downloading' as const, cancelling: false }
  expect(downloadPercent({ ...base, receivedBytes: 10, totalBytes: 0 })).toBeUndefined()
  expect(downloadPercent({ ...base, receivedBytes: 20, totalBytes: 10 })).toBe(100)
})

it.each([
  ['plugin-manager/product-cli-download-failed', { reason: 'network' }, 'network'],
  ['plugin-manager/product-cli-download-failed', { reason: 'integrity' }, 'integrity'],
  ['plugin-manager/product-cli-download-failed', { reason: 'unsupported-platform' }, 'unsupported-platform'],
  ['plugin-manager/product-cli-download-failed', { reason: 'filesystem' }, 'filesystem'],
  ['plugin-manager/product-cli-download-failed', { reason: 'busy' }, 'busy'],
  ['plugin-manager/product-cli-download-cancelled', {}, 'cancelled'],
  ['gateway/internal', {}, 'other'],
])('turns a %s refusal into the %o failure, and a retry downloads again', async (code, details, failure) => {
  const { controller, manager, state } = setup()
  await controller.load()
  manager.downloadProductCli.mockImplementationOnce(() => refused(code, details))
  await controller.download('claude-code')
  expect(state().tasks['claude-code']).toEqual({ kind: 'failed', action: 'download', failure })
  await controller.download('claude-code')
  expect(manager.downloadProductCli).toHaveBeenCalledTimes(2)
  expect(state().tasks['claude-code']).toBeUndefined()
})

it('asks the Host to cancel the running download once, and waits for the download to say how it ended', async () => {
  const { controller, manager, state } = setup()
  await controller.load()
  const answer = held<ProductCliStatus>()
  manager.downloadProductCli.mockImplementationOnce(() => answer.promise)
  const done = controller.download('claude-code')
  const requestId = manager.downloadProductCli.mock.calls[0]![1]
  await controller.cancel('codex')
  const cancelled = controller.cancel('claude-code')
  expect(state().tasks['claude-code']).toMatchObject({ cancelling: true })
  await controller.cancel('claude-code')
  await cancelled
  expect(manager.cancelProductCliDownload.mock.calls).toEqual([[requestId]])
  expect(state().tasks['claude-code']).toMatchObject({ kind: 'download', cancelling: true })
  answer.release({ ok: false, error: new RemoteError('plugin-manager/product-cli-download-cancelled' as never, 'cancelled', {} as never) })
  await done
  expect(state().tasks['claude-code']).toEqual({ kind: 'failed', action: 'download', failure: 'cancelled' })
})

it('lets a download that outran its cancellation be cancelled again', async () => {
  const { controller, manager, state } = setup()
  await controller.load()
  manager.downloadProductCli.mockImplementationOnce(() => held<ProductCliStatus>().promise)
  void controller.download('claude-code')
  manager.cancelProductCliDownload.mockImplementationOnce(() => ok(false))
  await controller.cancel('claude-code')
  expect(state().tasks['claude-code']).toMatchObject({ kind: 'download', cancelling: false })
  manager.cancelProductCliDownload.mockImplementationOnce(() => refused('gateway/internal'))
  await controller.cancel('claude-code')
  expect(state().tasks['claude-code']).toMatchObject({ kind: 'download', cancelling: false })
  expect(manager.cancelProductCliDownload).toHaveBeenCalledTimes(2)
})

it('leaves a download that finished before its cancellation was refused, and the next one, as they are', async () => {
  const { controller, manager, state } = setup()
  await controller.load()
  const cancel = held<boolean>()
  manager.cancelProductCliDownload.mockImplementationOnce(() => cancel.promise)
  manager.listProductClis.mockImplementationOnce(() => ok([DOWNLOADED, CODEX]))
  const done = controller.download('claude-code')
  const cancelling = controller.cancel('claude-code')
  await done
  expect(state().tasks).toEqual({})
  manager.downloadProductCli.mockImplementationOnce(() => held<ProductCliStatus>().promise)
  void controller.download('claude-code')
  const next = state().tasks['claude-code']
  cancel.release({ ok: true, value: false })
  await cancelling
  expect(state().tasks['claude-code']).toBe(next)
})

it('removes the downloaded copy, reads again, and reports a failed removal', async () => {
  const { controller, manager, state } = setup()
  manager.listProductClis.mockImplementationOnce(() => ok([DOWNLOADED]))
  await controller.load()
  const answer = held<ProductCliStatus>()
  manager.removeProductCli.mockImplementationOnce(() => answer.promise)
  const done = controller.remove('claude-code')
  expect(state().tasks['claude-code']).toEqual({ kind: 'remove' })
  void controller.remove('claude-code')
  void controller.download('claude-code')
  expect(manager.removeProductCli).toHaveBeenCalledOnce()
  expect(manager.downloadProductCli).not.toHaveBeenCalled()
  answer.release({ ok: true, value: MISSING })
  await done
  expect(state()).toEqual({ status: 'ready', clis: [MISSING, CODEX], tasks: {} })
  manager.removeProductCli.mockImplementationOnce(() => refused('plugin-manager/product-cli-remove-failed'))
  await controller.remove('claude-code')
  expect(state().tasks['claude-code']).toEqual({ kind: 'failed', action: 'remove', failure: 'other' })
})

it('adds a status the last read lacked once its action settles', async () => {
  const { controller, manager, state } = setup()
  manager.listProductClis.mockImplementationOnce(() => ok([CODEX])).mockImplementationOnce(() => refused('gateway/internal'))
  await controller.load()
  await controller.download('claude-code')
  expect(state().clis).toEqual([CODEX, DOWNLOADED])
})

it('stops publishing after disposal', async () => {
  const { controller, manager, state } = setup()
  await controller.load()
  const download = held<ProductCliStatus>()
  const removal = held<ProductCliStatus>()
  const read = held<ProductCliStatus[]>()
  const cancel = held<boolean>()
  manager.downloadProductCli.mockImplementationOnce(() => download.promise)
  manager.removeProductCli.mockImplementationOnce(() => removal.promise)
  manager.listProductClis.mockImplementationOnce(() => read.promise)
  manager.cancelProductCliDownload.mockImplementationOnce(() => cancel.promise)
  const downloading = controller.download('claude-code')
  const cancelling = controller.cancel('claude-code')
  const removing = controller.remove('codex')
  const reading = controller.load()
  const before = state()
  controller.dispose()
  controller.progress({ requestId: manager.downloadProductCli.mock.calls[0]![1], id: 'claude-code', phase: 'verifying', receivedBytes: 1, totalBytes: 1 })
  download.release({ ok: true, value: DOWNLOADED })
  removal.release({ ok: true, value: CODEX })
  read.release({ ok: true, value: [] })
  cancel.release({ ok: true, value: false })
  await Promise.all([downloading, cancelling, removing, reading])
  await flush()
  expect(state()).toBe(before)
})
