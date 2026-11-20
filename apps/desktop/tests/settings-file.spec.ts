import { mkdtemp, mkdir, readFile, writeFile, rm } from 'node:fs/promises'
import * as fs from 'node:fs/promises'
import * as atomic from '@deepseek-ai/dsh-atomic-write'
import { tmpdir } from 'node:os'
import { join, dirname } from 'node:path'
import { afterEach, expect, it, onTestFinished, vi } from 'vitest'
import { DesktopSettingsFile } from '../src/settings-file.ts'
import { DesktopUpdateSettings } from '../src/update-settings.ts'

vi.mock('node:fs/promises', async original => ({ ...await original<typeof import('node:fs/promises')>() }))
vi.mock('@deepseek-ai/dsh-atomic-write', async original => ({ ...await original<typeof import('@deepseek-ai/dsh-atomic-write')>() }))
afterEach(() => { vi.restoreAllMocks() })

async function fixture(raw?: string) {
  const root = await mkdtemp(join(tmpdir(), 'desktop-settings-file-'))
  onTestFinished(() => rm(root, { recursive: true, force: true }))
  const file = new DesktopSettingsFile(root)
  if (raw !== undefined) {
    await mkdir(dirname(file.path))
    await writeFile(file.path, raw)
  }
  return { root, file }
}

it('distinguishes missing files from absent fields without creating a file during reads', async () => {
  const { file } = await fixture()
  expect(await file.read()).toEqual({ kind: 'missing' })
  await expect(readFile(file.path)).rejects.toMatchObject({ code: 'ENOENT' })
  await file.saveUpdates({})
  expect(await file.read()).toMatchObject({ kind: 'ready', fields: {
    checkForUpdates: { kind: 'absent' },
  } })
})

it.each([
  ['{secret-value', 'json'], ['null', 'structure'], ['[]', 'structure'],
  ['{"updates":null}', 'structure'], ['{"updates":[]}', 'structure'], ['{"updates":true}', 'structure'],
])('classifies malformed documents and refuses to replace them: %s', async (raw, reason) => {
  const { file } = await fixture(raw)
  const result = await file.read()
  expect(result).toMatchObject({ kind: 'error', error: { problem: { kind: 'invalid', reason }, path: file.path } })
  expect(JSON.stringify(result)).not.toContain('secret-value')
  await expect(file.saveUpdates({ checkForUpdates: true })).rejects.toMatchObject({ problem: { kind: 'invalid', reason } })
  expect(await readFile(file.path, 'utf8')).toBe(raw)
})

it('repairs only the selected field and preserves unknown fields', async () => {
  const { root, file } = await fixture('{"other":[1],"updates":{"checkForUpdates":"yes","channel":"stable","future":{"x":2}}}')
  vi.spyOn(console, 'warn').mockImplementation(() => {})
  expect(await file.read()).toMatchObject({ kind: 'ready', fields: {
    checkForUpdates: { kind: 'invalid', error: { problem: { kind: 'invalid', reason: 'field', field: 'checkForUpdates' } } },
  } })
  expect(await new DesktopUpdateSettings(root).load()).toBe(true)
  await file.saveUpdates({ checkForUpdates: true })
  expect(JSON.parse(await readFile(file.path, 'utf8'))).toEqual({ other: [1], updates: {
    checkForUpdates: true, channel: 'stable', future: { x: 2 },
  } })
})

it('classifies unreadable files without repairing them', async () => {
  const { file } = await fixture()
  await mkdir(file.path, { recursive: true })
  expect(await file.read()).toMatchObject({ kind: 'error', error: { problem: { kind: 'read' } } })
  expect((await fs.stat(file.path)).isDirectory()).toBe(true)
})

it('reports preparation failure as unchanged and does not create a file', async () => {
  const { file } = await fixture()
  vi.spyOn(fs, 'mkdir').mockRejectedValue(Object.assign(new Error('denied'), { code: 'EACCES' }))
  await expect(file.saveUpdates({ checkForUpdates: true })).rejects.toMatchObject({ problem: {
    kind: 'write', operation: 'save', effect: 'unchanged',
  } })
  await expect(readFile(file.path)).rejects.toMatchObject({ code: 'ENOENT' })
})

it('reports uncertain write completion without reporting a successful save', async () => {
  const { file } = await fixture('{}')
  vi.spyOn(atomic, 'writeFileAtomic').mockRejectedValue(new Error('write failed'))
  await expect(file.saveUpdates({ checkForUpdates: true })).rejects.toMatchObject({ problem: {
    kind: 'write', operation: 'save', effect: 'unknown',
  } })
  expect(await readFile(file.path, 'utf8')).toBe('{}')
  await expect(fs.access(`${file.path}.lock`)).rejects.toMatchObject({ code: 'ENOENT' })
})

it('reports a committed write when lock cleanup fails, without claiming rollback', async () => {
  const { file } = await fixture('{}')
  const original = fs.rm
  vi.spyOn(fs, 'rm').mockImplementation(async (path, options) => {
    if (path === `${file.path}.lock`) throw new Error('lock cleanup failed')
    return original(path, options)
  })
  await expect(file.saveUpdates({ checkForUpdates: true })).rejects.toMatchObject({ problem: {
    kind: 'write', operation: 'save', effect: 'written',
  } })
  expect(JSON.parse(await readFile(file.path, 'utf8'))).toEqual({ updates: { checkForUpdates: true } })
})

it.each([true, false])('reads an explicit preference: %s', async (checkForUpdates) => {
  const { file } = await fixture(JSON.stringify({ updates: { checkForUpdates } }))
  expect(await file.read()).toMatchObject({ kind: 'ready', fields: { checkForUpdates: { kind: 'valid', value: checkForUpdates } } })
})

it.each([null, 'true', 1, 'stable', ''])('rejects an explicit invalid preference without treating it as absent: %s', async (checkForUpdates) => {
  const { file } = await fixture(JSON.stringify({ updates: { checkForUpdates } }))
  expect(await file.read()).toMatchObject({ kind: 'ready', fields: { checkForUpdates: { kind: 'invalid' } } })
})

it('rereads fields after acquiring the writer lock instead of saving a stale snapshot', async () => {
  const { file } = await fixture('{"updates":{"checkForUpdates":false}}')
  const started = Promise.withResolvers<undefined>()
  const release = Promise.withResolvers<undefined>()
  const holder = atomic.withFileLock(file.path, async () => {
    started.resolve(undefined)
    await release.promise
    await writeFile(file.path, '{"updates":{"checkForUpdates":false,"future":3},"other":4}')
  })
  await started.promise
  const attempting = Promise.withResolvers<undefined>()
  const originalLock = atomic.withFileLock
  vi.spyOn(atomic, 'withFileLock').mockImplementation(<T>(path: string, operation: () => Promise<T>, options?: atomic.FileLockOptions): Promise<T> => {
    attempting.resolve(undefined)
    return originalLock(path, operation, options)
  })
  const save = file.saveUpdates({ checkForUpdates: true })
  onTestFinished(async () => { release.resolve(undefined); await Promise.allSettled([holder, save]) })
  await attempting.promise
  release.resolve(undefined)
  const outcomes = await Promise.allSettled([holder, save])
  expect(outcomes.map(result => result.status)).toEqual(['fulfilled', 'fulfilled'])
  expect(JSON.parse(await readFile(file.path, 'utf8'))).toEqual({ updates: { checkForUpdates: true, future: 3 }, other: 4 })
})

it('accepts the new preference and persists a warning after a real write with failed lock removal', async () => {
  const { root, file } = await fixture('{"updates":{"checkForUpdates":false},"keep":true}')
  const settings = new DesktopUpdateSettings(root)
  const original = fs.rm
  vi.spyOn(fs, 'rm').mockImplementation(async (path, options) => {
    if (path === `${file.path}.lock`) throw new Error('injected lock removal failure')
    return original(path, options)
  })
  await expect(settings.save(true)).resolves.toBeUndefined()
  expect(JSON.parse(await readFile(file.path, 'utf8'))).toEqual({ updates: { checkForUpdates: true }, keep: true })
  expect(await settings.load()).toBe(true)
  expect(JSON.parse(await readFile(`${file.path}.save.jsonl`, 'utf8'))).toMatchObject({
    effect: 'written', reason: 'injected lock removal failure',
  })
  await expect(fs.access(`${file.path}.lock`)).resolves.toBeUndefined()
})

it.each([false, true])('leaves an uncertain write for explicit recovery, committed=%s', async (committed) => {
  const { root, file } = await fixture('{"updates":{"checkForUpdates":false},"keep":true}')
  const settings = new DesktopUpdateSettings(root)
  const original = atomic.writeFileAtomic
  const write = vi.spyOn(atomic, 'writeFileAtomic').mockImplementationOnce(async (...args) => {
    if (committed) await original(...args)
    throw new Error('injected uncertain completion')
  })
  const read = vi.spyOn(DesktopSettingsFile.prototype, 'read')
  await expect(settings.save(true)).rejects.toMatchObject({ problem: { effect: 'unknown' } })
  expect(write).toHaveBeenCalledTimes(1)
  expect(read).toHaveBeenCalledTimes(1)
  expect(JSON.parse(await readFile(file.path, 'utf8'))).toEqual({
    updates: { checkForUpdates: committed }, keep: true,
  })
  expect(JSON.parse(await readFile(`${file.path}.save.jsonl`, 'utf8'))).toMatchObject({ effect: 'unknown' })
  await expect(fs.access(`${file.path}.lock`)).rejects.toMatchObject({ code: 'ENOENT' })
  expect(await settings.load()).toBe(committed)
})
