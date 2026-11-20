/** Desktop-only daily update check (on by default); persistence, the request, and installation stay in Electron. */
import { Button, Switch } from '@deepseek-ai/dsh-client-ui-primitives'
import type { InjectFace, PropsLocale, PropsRuntime } from '@deepseek-ai/dsh-client-ui-slots'
import type { DesktopUpdateSnapshot, DesktopUpdateSource } from './desktop-update-source.ts'
import css from './DesktopUpdateRow.module.css'

/** Framework-bound shell state and explicit user actions. */
export interface DesktopUpdateRowInjected {
  hooks: { desktopUpdate: DesktopUpdateSource['store'] }
  setEnabled(enabled: boolean): Promise<void>
  check(): Promise<void>
}

type SettingsTranslate = PropsLocale<'settings'>['t']

function checkStatus(check: DesktopUpdateSnapshot['check'], t: SettingsTranslate): string | undefined {
  if (check.phase === 'idle') return undefined
  if (check.phase === 'checking') return t('desktop.update.checking')
  const { result } = check
  if (result.kind === 'available') return t('desktop.update.available', { version: result.version })
  if (result.kind === 'current') return t('desktop.update.current', { version: result.version })
  return t('desktop.update.failed')
}

/**
 * Render the 'Check for updates' toggle and its 'Check now' action.
 * @param props - Shell observation, actions, and localized copy.
 * @returns The General settings row.
 */
export function DesktopUpdateRow({ useDesktopUpdate, setEnabled, check, t }:
  PropsRuntime<'settings.general.item'> & PropsLocale<'settings'> & InjectFace<DesktopUpdateRowInjected>) {
  const { enabled, saving, saveFailed, check: lastCheck } = useDesktopUpdate(value => value)
  const status = checkStatus(lastCheck, t)
  return <div className={css.row} role="group" aria-label={t('desktop.update.title')}>
    <div className={css.rowText}>
      <div className={css.title}>{t('desktop.update.title')}</div>
      <div className={css.description}>{t('desktop.update.description')}</div>
      {saveFailed && <div role="alert">{t('desktop.update.saveError')}</div>}
      {status !== undefined && <div className={css.status} role="status">{status}</div>}
    </div>
    <div className={css.controls}>
      <Button variant="outline" size="sm" disabled={lastCheck.phase === 'checking'} aria-busy={lastCheck.phase === 'checking'}
        onClick={() => { void check() }}>{t('desktop.update.checkNow')}</Button>
      <Switch checked={enabled === true} disabled={saving || enabled === undefined} label={t('desktop.update.title')}
        onChange={(next) => { void setEnabled(next) }} />
    </div>
  </div>
}
