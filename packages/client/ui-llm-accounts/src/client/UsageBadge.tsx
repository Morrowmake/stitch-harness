/**
 * Composer usage badge: the current Session provider's serving account and its most constrained window, e.g.
 * `ChatGPT · Weekly 42%`. Clicking opens a dialog with every account of the current provider first, then the other
 * providers. It renders nothing until some account has usage readings, and subscribes only while mounted and the
 * document is visible. The used/left display mode is a browser-local preference.
 */
import { useEffect, useId, useState, type ReactNode } from 'react'
import { IconGaugeOutlineRegular, Modal, SegmentedControl } from '@deepseek-ai/dsh-client-ui-primitives'
import type { InjectFace, Translate } from '@deepseek-ai/dsh-client-ui-slots'
import { accountName, mostConstrained, providersWithUsage, servingAccount, shownPercent, windowName, type UsageMode } from './format.ts'
import type { LlmAccountsKey } from './locales.ts'
import type { UsageBadgeInjected } from './types.ts'
import { UsageBars } from './UsageBars.tsx'
import css from './accounts.module.css'

/** `localStorage` key of the display mode. */
export const MODE_STORAGE_KEY = 'dsh.llm-accounts.usage-mode'

/** Props the `conversation.composer.dock` entry receives. */
export type UsageBadgeProps = InjectFace<UsageBadgeInjected> & { t: Translate<LlmAccountsKey> }

function readMode(): UsageMode {
  try {
    return globalThis.localStorage.getItem(MODE_STORAGE_KEY) === 'left' ? 'left' : 'used'
  } catch {
    return 'used'
  }
}

/**
 * Hold the usage subscription while the document is visible.
 * @param acquire - the face's subscription hold.
 */
function useVisibleSubscription(acquire: () => () => void): void {
  useEffect(() => {
    let release: (() => void) | undefined
    const sync = (): void => {
      if (document.visibilityState === 'visible') release ??= acquire()
      else { release?.(); release = undefined }
    }
    sync()
    document.addEventListener('visibilitychange', sync)
    return () => {
      document.removeEventListener('visibilitychange', sync)
      release?.()
    }
  }, [acquire])
}

/**
 * Render the badge for one Session.
 * @param props - the Session's accounts and selection stores, the subscription hold, and translator.
 * @returns the pill and its dialog, or null without usage readings.
 */
export function UsageBadge({ useAccounts, useSelection, acquire, operations, t }: UsageBadgeProps): ReactNode {
  useVisibleSubscription(acquire)
  const snapshot = useAccounts(state => state.snapshot)
  const current = useSelection(state => state.current?.provider)
  const [open, setOpen] = useState(false)
  const [mode, setMode] = useState<UsageMode>(readMode)
  const modeId = useId()
  const providers = providersWithUsage(snapshot, current)
  const head = providers[0]
  if (head === undefined) return null

  const serving = servingAccount(head)
  const reading = mostConstrained(serving?.usage)
    ?? head.accounts.map(account => mostConstrained(account.usage)).find(entry => entry !== undefined)
  const label = reading === undefined ? head.displayName : t('badge.label', {
    provider: head.displayName, window: windowName(reading.window, t), percent: shownPercent(reading.used, mode),
  })
  const changeMode = (next: UsageMode): void => {
    setMode(next)
    try {
      globalThis.localStorage.setItem(MODE_STORAGE_KEY, next)
    } catch (_storageUnavailable) {
      // Storage is unavailable or full: the mode still applies for this page, only not across reloads.
    }
  }
  return (
    <span className={css.badgeAnchor} data-llm-usage-badge={head.provider}>
      <button type="button" className={css.badge} aria-expanded={open} aria-label={label} title={label}
        onClick={() => { setOpen(true) }}>
        <IconGaugeOutlineRegular />
        <span className={css.badgeLabel}>{label}</span>
      </button>
      {open
        ? (
          <Modal open title={t('badge.title')} closeLabel={t('close')} onClose={() => { setOpen(false) }}>
            <div className={css.dialogBody}>
              <SegmentedControl<UsageMode> id={modeId} label={t('badge.mode')} value={mode} onChange={changeMode}
                options={[{ value: 'used', label: t('badge.modeUsed') }, { value: 'left', label: t('badge.modeLeft') }]} />
              {providers.map(view => (
                <div key={view.provider} className={css.badgeProvider}>
                  <h4 className={css.title}>{view.displayName}</h4>
                  {view.accounts.filter(account => account.usage !== undefined).map(account => (
                    <div key={account.id} className={css.row} data-llm-account={account.id}>
                      <div className={css.rowHead}>
                        <span className={css.name}>{accountName(account)}</span>
                        {view.provider === head.provider && account.id === serving?.id
                          ? <span className={css.muted}>{t('badge.serving')}</span>
                          : null}
                      </div>
                      <UsageBars usage={account.usage} mode={mode} t={t}
                        onRefresh={account.kind === 'oauth' ? () => { void operations.refreshUsage(view.provider, account.id) } : undefined} />
                    </div>
                  ))}
                </div>
              ))}
            </div>
          </Modal>
        )
        : null}
    </span>
  )
}
