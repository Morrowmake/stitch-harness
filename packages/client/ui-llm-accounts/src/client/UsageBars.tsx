/** Usage bars of one account: one bar per window with its share, reset time, and freshness markers. */
import type { ReactNode } from 'react'
import { Button, IconRefreshOutlineRegular } from '@deepseek-ai/dsh-client-ui-primitives'
import type { Translate } from '@deepseek-ai/dsh-client-ui-slots'
import type { UsageSnapshotView } from '@deepseek-ai/dsh-api-remotes/client'
import { formatRemaining, shownPercent, usedPercentOf, windowName, type UsageMode } from './format.ts'
import type { LlmAccountsKey } from './locales.ts'
import css from './accounts.module.css'

/** Props of {@link UsageBars}. */
export interface UsageBarsProps {
  readonly usage: UsageSnapshotView | undefined
  readonly mode: UsageMode
  readonly t: Translate<LlmAccountsKey>
  /** Present when the account can be refreshed (a forced `usage` call). */
  readonly onRefresh?: (() => void) | undefined
  readonly refreshing?: boolean
}

/**
 * Render an account's usage windows.
 * @param props - the cached snapshot, display mode, translator, and optional refresh.
 * @returns the bars, an empty-state line, or null when nothing can be shown or refreshed.
 */
export function UsageBars({ usage, mode, t, onRefresh, refreshing = false }: UsageBarsProps): ReactNode {
  const now = Date.now()
  const windows = (usage?.windows ?? []).flatMap((window) => {
    const used = usedPercentOf(window)
    return used === undefined ? [] : [{ window, used }]
  })
  if (windows.length === 0 && onRefresh === undefined) return null
  const credits = usage?.credits
  return (
    <div className={css.usage} data-llm-usage>
      {windows.length === 0 ? <span className={css.muted}>{t('usage.none')}</span> : windows.map(({ window, used }, index) => {
        const name = windowName(window, t)
        const percent = shownPercent(used, mode)
        const tone = used >= 100 ? 'full' : used >= 80 ? 'high' : 'normal'
        return (
          <div key={`${name}-${index}`} className={css.window}>
            <div className={css.windowHead}>
              <span>{name}</span>
              <span className={css.muted}>
                {t(mode === 'used' ? 'usage.used' : 'usage.left', { percent })}
                {window.resetsAt !== undefined && window.resetsAt > now
                  ? ` · ${t('usage.resets', { time: formatRemaining(window.resetsAt - now, t) })}`
                  : null}
              </span>
            </div>
            <div className={css.track} role="meter" aria-label={name} aria-valuemin={0} aria-valuemax={100} aria-valuenow={percent}>
              <div className={css.fill} data-tone={tone} style={{ width: `${Math.round(used)}%` }} />
            </div>
          </div>
        )
      })}
      <div className={css.usageFoot}>
        {usage?.plan === undefined ? null : <span className={css.muted}>{t('usage.plan', { plan: usage.plan })}</span>}
        {credits === undefined || !credits.hasCredits ? null : (
          <span className={css.muted}>
            {credits.unlimited ? t('usage.creditsUnlimited') : t('usage.credits', { balance: credits.balance ?? '—' })}
          </span>
        )}
        {usage?.refreshFailed === true
          ? <span className={css.warn}>{t('usage.failed')}</span>
          : usage?.stale === true ? <span className={css.warn}>{t('usage.stale')}</span> : null}
        {onRefresh === undefined ? null : (
          <Button variant="ghost" size="sm" icon={<IconRefreshOutlineRegular />} disabled={refreshing}
            aria-label={t('usage.refresh')} title={t('usage.refresh')} onClick={onRefresh} />
        )}
      </div>
    </div>
  )
}
