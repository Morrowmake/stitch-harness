/** Desktop-only 'Terminal command' row; inspection, confirmations and changes stay in Electron. */
import { useEffect } from 'react'
import { Button } from '@deepseek-ai/dsh-client-ui-primitives'
import type { InjectFace, PropsLocale, PropsRuntime } from '@deepseek-ai/dsh-client-ui-slots'
import type { DesktopCommandAction, DesktopCommandStatus } from '../types.ts'
import type { DesktopCommandSource } from './desktop-command-source.ts'
import css from './DesktopUpdateRow.module.css'

/** Framework-bound shell state and explicit user actions. */
export interface DesktopCommandRowInjected {
  hooks: { desktopCommand: DesktopCommandSource['store'] }
  refresh(): Promise<void>
  run(action: DesktopCommandAction): Promise<void>
}

type SettingsTranslate = PropsLocale<'settings'>['t']

function statusLines(status: DesktopCommandStatus | undefined, t: SettingsTranslate): string[] {
  if (status === undefined) return [t('desktop.command.checking')]
  switch (status.kind) {
    case 'unsupported': return []
    case 'unavailable': return [t('desktop.command.unavailable')]
    case 'failed': return [t('desktop.command.failed')]
    default: return [
      t(`desktop.command.${status.kind}`),
      ...status.shadowed ? [t('desktop.command.shadowed')] : [],
      ...status.selectionUnknown ? [t('desktop.command.selectionUnknown')] : [],
    ]
  }
}

function actions(status: DesktopCommandStatus | undefined): Array<DesktopCommandAction | 'retry'> {
  switch (status?.kind) {
    case 'notInstalled': return ['install']
    case 'installed': case 'broken': return ['repair', 'remove']
    case 'failed': return ['retry']
    default: return []
  }
}

/**
 * Render the terminal command status with Install, or Repair and Remove when registered.
 * @param props - Shell observation, actions, and localized copy.
 * @returns The General settings row, or nothing where the platform has no managed command.
 */
export function DesktopCommandRow({ useDesktopCommand, refresh, run, t }:
  PropsRuntime<'settings.general.item'> & PropsLocale<'settings'> & InjectFace<DesktopCommandRowInjected>) {
  const { status, busy } = useDesktopCommand(value => value)
  // The menu or a terminal may have changed the command since the last visit.
  useEffect(() => { void refresh() }, [])
  if (status?.kind === 'unsupported') return null
  return <div className={css.row} role="group" aria-label={t('desktop.command.title')}>
    <div className={css.rowText}>
      <div className={css.title}>{t('desktop.command.title')}</div>
      <div className={css.description}>{t('desktop.command.description')}</div>
      <div className={css.status} role="status">
        {statusLines(status, t).map(line => <div key={line}>{line}</div>)}
      </div>
    </div>
    <div className={css.controls}>
      {actions(status).map(action => <Button key={action} variant="outline" size="sm" disabled={busy} aria-busy={busy}
        onClick={() => { void (action === 'retry' ? refresh() : run(action)) }}>{t(`desktop.command.${action}`)}</Button>)}
    </div>
  </div>
}
