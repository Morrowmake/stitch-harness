import { expect, it, vi } from 'vitest'
import type { DesktopUpdateBridge, DesktopUpdateCheckResult } from '../src/types.ts'
import { DesktopUpdateSource } from '../src/client/desktop-update-source.ts'

function fixture(preference: Promise<boolean> = Promise.resolve(false)) {
  let listener: ((enabled: boolean) => void) | undefined
  const unsubscribe = vi.fn()
  const bridge = {
    getPreference: vi.fn(() => preference),
    setPreference: vi.fn(async (enabled: boolean) => enabled),
    subscribe: vi.fn((next: (enabled: boolean) => void) => { listener = next; return unsubscribe }),
    check: vi.fn(async (): Promise<DesktopUpdateCheckResult> => ({ kind: 'current', version: '1.0.0' })),
  } satisfies DesktopUpdateBridge
  const source = new DesktopUpdateSource(bridge)
  return { bridge, source, unsubscribe, emit: (enabled: boolean) => { listener?.(enabled) } }
}

it('reads the persisted preference and follows changes from other windows', async () => {
  const { source, emit } = fixture(Promise.resolve(true))
  expect(source.store.getSnapshot().enabled).toBeUndefined()
  await vi.waitFor(() => { expect(source.store.getSnapshot().enabled).toBe(true) })
  emit(false)
  expect(source.store.getSnapshot().enabled).toBe(false)
})

it('keeps a pushed change when the initial read answers late', async () => {
  const initial = Promise.withResolvers<boolean>()
  const { source, emit } = fixture(initial.promise)
  emit(true)
  initial.resolve(false)
  await initial.promise
  await Promise.resolve()
  expect(source.store.getSnapshot().enabled).toBe(true)
})

it('saves an explicit choice once at a time and reports save failures', async () => {
  const { bridge, source } = fixture()
  const save = Promise.withResolvers<boolean>()
  bridge.setPreference.mockReturnValueOnce(save.promise)
  const first = source.setEnabled(true)
  expect(source.store.getSnapshot().saving).toBe(true)
  await source.setEnabled(false)
  expect(bridge.setPreference).toHaveBeenCalledOnce()
  save.resolve(true)
  await first
  expect(source.store.getSnapshot()).toMatchObject({ enabled: true, saving: false, saveFailed: false })
  bridge.setPreference.mockRejectedValueOnce(new Error('disk full'))
  await source.setEnabled(false)
  expect(source.store.getSnapshot()).toMatchObject({ enabled: true, saving: false, saveFailed: true })
})

it.each<[string, DesktopUpdateCheckResult]>([
  ['an available release', { kind: 'available', version: '1.1.0', name: 'Stitch 1.1.0' }],
  ['the current version', { kind: 'current', version: '1.0.0' }],
  ['a failure', { kind: 'failed' }],
])('reports %s from Check now', async (_label, result) => {
  const { bridge, source } = fixture()
  const reply = Promise.withResolvers<DesktopUpdateCheckResult>()
  bridge.check.mockReturnValueOnce(reply.promise)
  const checking = source.check()
  expect(source.store.getSnapshot().check).toEqual({ phase: 'checking' })
  await source.check()
  expect(bridge.check).toHaveBeenCalledOnce()
  reply.resolve(result)
  await checking
  expect(source.store.getSnapshot().check).toEqual({ phase: 'done', result })
})

it('reports a rejected check as failed and ignores late answers after disposal', async () => {
  const { bridge, source, unsubscribe } = fixture()
  bridge.check.mockRejectedValueOnce(new Error('IPC closed'))
  await source.check()
  expect(source.store.getSnapshot().check).toEqual({ phase: 'done', result: { kind: 'failed' } })
  const reply = Promise.withResolvers<DesktopUpdateCheckResult>()
  bridge.check.mockReturnValueOnce(reply.promise)
  const pending = source.check()
  source.dispose()
  expect(unsubscribe).toHaveBeenCalledOnce()
  reply.resolve({ kind: 'current', version: '1.0.0' })
  await pending
  expect(source.store.getSnapshot().check).toEqual({ phase: 'checking' })
})
