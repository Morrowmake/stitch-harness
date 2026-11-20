import { mkdtemp, mkdir, readFile, writeFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { beforeEach, expect, it, onTestFinished, vi } from 'vitest'
import { DesktopUpdateSettings } from '../src/update-settings.ts'
import { DesktopSettingsFile, DesktopSettingsFileError } from '../src/settings-file.ts'

async function fixture() {
  const root = await mkdtemp(join(tmpdir(), 'desktop-update-preference-'))
  onTestFinished(() => rm(root, { recursive: true, force: true }))
  await mkdir(join(root, 'desktop'))
  return new DesktopUpdateSettings(root)
}

beforeEach(() => { vi.spyOn(console, 'warn').mockImplementation(() => {}); return () => { vi.restoreAllMocks() } })

it('defaults to on for missing settings without creating the document', async () => {
  const settings = await fixture()
  expect(await settings.load()).toBe(true)
  await expect(readFile(settings.path)).rejects.toMatchObject({ code: 'ENOENT' })
})

it('preserves other fields during explicit saves and rereads external edits on load', async () => {
  const settings = await fixture()
  await writeFile(settings.path, JSON.stringify({ updates: { future: true, channel: 'stable' }, other: 4 }))
  expect(await settings.load()).toBe(true)
  await settings.save(false)
  expect(JSON.parse(await readFile(settings.path, 'utf8')))
    .toEqual({ updates: { future: true, channel: 'stable', checkForUpdates: false }, other: 4 })
  expect(await settings.load()).toBe(false)
  await writeFile(settings.path, '{}')
  expect(await settings.load()).toBe(true)
})

it.each(['{', 'null', '{"updates":[]}', '{"updates":{"checkForUpdates":"yes"}}', '{"updates":{"checkForUpdates":null}}'])(
  'keeps the default (on) for invalid settings without rewriting them: %s', async (raw) => {
    const settings = await fixture()
    await writeFile(settings.path, raw)
    expect(await settings.load()).toBe(true)
    expect(console.warn).toHaveBeenCalled()
    expect(await readFile(settings.path, 'utf8')).toBe(raw)
  })

it('keeps the default (on) for unreadable settings', async () => {
  const settings = await fixture()
  await mkdir(settings.path)
  expect(await settings.load()).toBe(true)
})

it('refuses to replace malformed user JSON during a UI save', async () => {
  const settings = await fixture()
  await writeFile(settings.path, '{')
  await expect(settings.save(true)).rejects.toBeInstanceOf(DesktopSettingsFileError)
  expect(await readFile(settings.path, 'utf8')).toBe('{')
})

// Storage has already classified the write; the preference consumer must not retry it.
it.each(['written', 'unknown', 'unchanged'] as const)('handles the %s write outcome without retrying', async (effect) => {
  const settings = await fixture()
  const failure = new DesktopSettingsFileError({ kind: 'write', operation: 'save', effect }, settings.path,
    { cause: new Error('injected storage failure') })
  const save = vi.spyOn(DesktopSettingsFile.prototype, 'saveUpdates').mockRejectedValueOnce(failure)
  const read = vi.spyOn(DesktopSettingsFile.prototype, 'read')
  if (effect === 'written') await expect(settings.save(true)).resolves.toBeUndefined()
  else await expect(settings.save(true)).rejects.toBe(failure)
  expect(save).toHaveBeenCalledTimes(1)
  expect(read).not.toHaveBeenCalled()
  expect(JSON.parse(await readFile(`${settings.path}.save.jsonl`, 'utf8'))).toMatchObject({ effect })
})
