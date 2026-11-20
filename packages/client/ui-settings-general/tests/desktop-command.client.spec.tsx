// @vitest-environment jsdom
import { allowAllAccess, bindSnapshotSelector, contextMenuHook } from '@deepseek-ai/dsh-client-test-runtime'
import type { GlobalStandardProps } from '@deepseek-ai/dsh-client-ui-slots'
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, expect, it, vi } from 'vitest'
import type { DesktopCommandBridge, DesktopCommandStatus } from '../src/types.ts'
import { DesktopCommandSource } from '../src/client/desktop-command-source.ts'
import { DesktopCommandRow } from '../src/client/DesktopCommandRow.tsx'
import { de, en, es, fr, ja, pt, ru, zh } from '../src/client/locales.ts'

afterEach(() => { cleanup() })

const unusedHook = (() => { throw new Error('unused by the terminal command row') }) as never
const usePanelInfo: GlobalStandardProps['usePanelInfo'] = selector => selector({ activePanelId: null })
const kit = {
  useSessions: unusedHook, useSessionStatus: unusedHook, useWorkspaces: unusedHook, useSessionRetainInfo: () => undefined, usePanelInfo,
  useResource: (() => ({ status: 'none' as const, value: undefined, failure: undefined, reload: () => {} })) as GlobalStandardProps['useResource'],
  ...allowAllAccess, useContextMenu: contextMenuHook(),
}
const t = ((key: string) => (en as Record<string, string>)[key] ?? key) as never

function fixture(initial: DesktopCommandStatus) {
  const bridge = {
    status: vi.fn(async (): Promise<DesktopCommandStatus> => initial),
    run: vi.fn(async (): Promise<DesktopCommandStatus> => initial),
  } satisfies DesktopCommandBridge
  const source = new DesktopCommandSource(bridge)
  render(<DesktopCommandRow {...kit} t={t} useDesktopCommand={bindSnapshotSelector(source.store)}
    refresh={() => source.refresh()} run={action => source.run(action)} />)
  return { bridge, source }
}

const buttons = () => screen.queryAllByRole('button').map(button => button.textContent)
const status = () => [...screen.getByRole('status').children].map(line => line.textContent)

it.each<[string, DesktopCommandStatus, string[], string[]]>([
  ['not installed', { kind: 'notInstalled', shadowed: false, selectionUnknown: false }, [en['desktop.command.notInstalled']], ['Install']],
  ['installed', { kind: 'installed', shadowed: false, selectionUnknown: false }, [en['desktop.command.installed']], ['Repair', 'Remove']],
  ['needing repair', { kind: 'broken', shadowed: false, selectionUnknown: false }, [en['desktop.command.broken']], ['Repair', 'Remove']],
  ['shadowed by another stitch', { kind: 'installed', shadowed: true, selectionUnknown: true },
    [en['desktop.command.installed'], en['desktop.command.shadowed'], en['desktop.command.selectionUnknown']], ['Repair', 'Remove']],
  ['outside the Applications folder', { kind: 'unavailable' }, [en['desktop.command.unavailable']], []],
  ['failing to inspect', { kind: 'failed' }, [en['desktop.command.failed']], ['Retry']],
])('shows a command that is %s with its actions', async (_label, observed, lines, actions) => {
  const { bridge } = fixture(observed)
  expect(status()).toEqual([en['desktop.command.checking']])
  await waitFor(() => { expect(status()).toEqual(lines) })
  expect(buttons()).toEqual(actions)
  expect(bridge.status).toHaveBeenCalledOnce()
})

it('hides the row where the platform has no managed command', async () => {
  const { source } = fixture({ kind: 'unsupported' })
  await waitFor(() => { expect(source.store.getSnapshot().status).toEqual({ kind: 'unsupported' }) })
  expect(screen.queryByRole('group')).toBeNull()
})

it('runs one action at a time and shows the state the shell observed afterwards', async () => {
  const { bridge } = fixture({ kind: 'notInstalled', shadowed: false, selectionUnknown: false })
  await waitFor(() => { expect(buttons()).toEqual(['Install']) })
  const reply = Promise.withResolvers<DesktopCommandStatus>()
  bridge.run.mockReturnValueOnce(reply.promise)
  fireEvent.click(screen.getByRole('button', { name: 'Install' }))
  expect(bridge.run).toHaveBeenCalledExactlyOnceWith('install')
  const install = screen.getByRole('button', { name: 'Install' })
  expect(install.hasAttribute('disabled')).toBe(true)
  fireEvent.click(install)
  expect(bridge.run).toHaveBeenCalledOnce()
  reply.resolve({ kind: 'installed', shadowed: false, selectionUnknown: false })
  await waitFor(() => { expect(buttons()).toEqual(['Repair', 'Remove']) })
  bridge.run.mockResolvedValueOnce({ kind: 'notInstalled', shadowed: false, selectionUnknown: false })
  fireEvent.click(screen.getByRole('button', { name: 'Remove' }))
  expect(bridge.run).toHaveBeenLastCalledWith('remove')
  await waitFor(() => { expect(status()).toEqual([en['desktop.command.notInstalled']]) })
})

it('reports a rejected IPC call as a failure that Retry re-reads', async () => {
  const { bridge } = fixture({ kind: 'installed', shadowed: false, selectionUnknown: false })
  await waitFor(() => { expect(buttons()).toEqual(['Repair', 'Remove']) })
  bridge.run.mockRejectedValueOnce(new Error('IPC closed'))
  fireEvent.click(screen.getByRole('button', { name: 'Repair' }))
  await waitFor(() => { expect(buttons()).toEqual(['Retry']) })
  fireEvent.click(screen.getByRole('button', { name: 'Retry' }))
  await waitFor(() => { expect(buttons()).toEqual(['Repair', 'Remove']) })
  expect(bridge.status).toHaveBeenCalledTimes(2)
})

it('ignores answers that arrive after disposal', async () => {
  const reply = Promise.withResolvers<DesktopCommandStatus>()
  const source = new DesktopCommandSource({ status: () => reply.promise, run: vi.fn() })
  const pending = source.refresh()
  source.dispose()
  reply.resolve({ kind: 'failed' })
  await pending
  expect(source.store.getSnapshot()).toEqual({ busy: true })
})

it('translates every terminal command string in all eight locales', () => {
  const keys = Object.keys(en).filter(key => key.startsWith('desktop.command.'))
  expect(keys).toHaveLength(14)
  for (const dictionary of [zh, ja, es, fr, de, ru, pt]) {
    for (const key of keys) expect((dictionary as Record<string, string>)[key]).not.toBe((en as Record<string, string>)[key])
  }
})
