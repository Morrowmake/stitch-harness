/**
 * The program section of a bundle that runs Claude Code or Codex: which executable the bundle uses, and, when none is
 * found, a Download button for the copy Stitch fetches and the command to install it yourself. Downloads start only
 * from the button; enabling the bundle never starts one.
 */
import { useEffect, type ReactNode } from 'react'
import type { ProductCliStatus } from '@deepseek-ai/dsh-api-remotes/client'
import {
  Button, IconCheckOutlineRegular, IconCloseOutlineRegular, IconDownloadOutlineRegular, IconTrashOutlineRegular,
  IconWarningOutlineRegular, StateDot,
} from '@deepseek-ai/dsh-client-ui-primitives'
import type { PluginManagerFace } from './manager-store.ts'
import { downloadPercent, PRODUCT_CLI_BUNDLES, type ProductCliFailure, type ProductCliState, type ProductCliTask } from './product-cli-store.ts'
import type { Translate } from './presentation.ts'
import css from './PluginManagerPage.module.css'

const FAILURE_KEYS = {
  'network': 'productCliFailedNetwork',
  'integrity': 'productCliFailedIntegrity',
  'unsupported-platform': 'productCliFailedPlatform',
  'filesystem': 'productCliFailedFilesystem',
  'busy': 'productCliFailedBusy',
  'cancelled': 'productCliFailedCancelled',
  'other': 'productCliFailedOther',
} as const satisfies Record<ProductCliFailure, string>

const SOURCE_KEYS = {
  installed: 'productCliInstalled',
  configured: 'productCliConfigured',
  bundled: 'productCliBundled',
  downloaded: 'productCliDownloaded',
} as const satisfies Record<NonNullable<ProductCliStatus['source']>, string>

/** Bytes per megabyte as download sizes are shown. */
const MEGABYTE = 1_000_000

/** What the section reads and calls; the page passes them from its injected face. */
export interface ProductCliSectionProps {
  /** The bundle whose page shows the section; bundles that run no product CLI render nothing. */
  readonly bundle: string
  readonly state: ProductCliState
  readonly t: Translate
  readonly ensure: PluginManagerFace['ensureProductClis']
  readonly retryRead: PluginManagerFace['retryProductClis']
  readonly download: PluginManagerFace['downloadProductCli']
  readonly cancel: PluginManagerFace['cancelProductCliDownload']
  readonly remove: PluginManagerFace['removeProductCli']
}

/** The tone of the summary glyph, styled by the Versions section's glyph classes. */
type Tone = 'info' | 'success' | 'warn' | 'error' | 'neutral'

interface Summary {
  readonly tone: Tone
  readonly glyph: ReactNode
  readonly title: string
  readonly sub?: string
  readonly end?: ReactNode
}

/** The product as the copy names it: its name and, when known, its version. */
function productName(cli: ProductCliStatus): string {
  return cli.version === undefined ? cli.displayName : `${cli.displayName} ${cli.version}`
}

function runningTitle(task: Extract<ProductCliTask, { kind: 'download' }>, t: Translate): string {
  if (task.cancelling) return t('productCliCancelling')
  if (task.phase === 'verifying') return t('productCliVerifying')
  if (task.phase === 'installing') return t('productCliInstalling')
  const percent = downloadPercent(task)
  return percent === undefined ? t('productCliDownloadStarting') : t('productCliDownloading', { percent: String(percent) })
}

function summaryOf(props: ProductCliSectionProps, cli: ProductCliStatus | undefined, task: ProductCliTask | undefined): Summary {
  const { state, t } = props
  const ongoing = <StateDot state="ongoing" size={14} />
  if (task?.kind === 'download' && cli !== undefined) {
    return {
      tone: 'info', glyph: ongoing, title: runningTitle(task, t),
      end: <Button variant="outline" size="sm" disabled={task.cancelling} onClick={() => { props.cancel(cli.id) }}>{t('cancel')}</Button>,
    }
  }
  if (task?.kind === 'remove') return { tone: 'neutral', glyph: ongoing, title: t('productCliRemoving') }
  if (cli === undefined) {
    return state.status === 'error'
      ? {
        tone: 'error', glyph: <IconCloseOutlineRegular size={14} />, title: t('productCliReadFailed'),
        end: <Button variant="outline" size="sm" onClick={props.retryRead}>{t('retry')}</Button>,
      }
      : { tone: 'neutral', glyph: ongoing, title: t('productCliChecking') }
  }
  if (task?.kind === 'failed') {
    const retry = task.action === 'download' ? props.download : props.remove
    return {
      tone: 'error', glyph: <IconCloseOutlineRegular size={14} />,
      title: task.action === 'remove' ? t('productCliRemoveFailed') : t(FAILURE_KEYS[task.failure], { name: cli.displayName }),
      end: <Button variant="outline" size="sm" onClick={() => { retry(cli.id) }}>{t('retry')}</Button>,
    }
  }
  const remove = cli.downloaded
    ? (
      <Button variant="outline" size="sm" className={css.danger} icon={<IconTrashOutlineRegular size={13} />} onClick={() => { props.remove(cli.id) }}>
        {t('productCliRemove')}
      </Button>
    )
    : undefined
  if (cli.available) {
    const source = cli.source ?? 'installed'
    return {
      tone: 'success', glyph: <IconCheckOutlineRegular size={14} />,
      title: t(SOURCE_KEYS[source], { product: productName(cli), path: cli.path ?? '' }), end: remove,
    }
  }
  const { download } = cli
  return {
    tone: 'warn', glyph: <IconWarningOutlineRegular size={14} />, title: t('productCliMissing', { name: cli.displayName }),
    ...download === null ? { sub: t('productCliNoDownload', { name: cli.displayName }) } : {},
    end: download === null ? remove : (
      <>
        {remove}
        <Button variant="primary" size="sm" icon={<IconDownloadOutlineRegular size={13} />} onClick={() => { props.download(cli.id) }}>
          {t('productCliDownload', { size: String(Math.round(download.sizeBytes / MEGABYTE)) })}
        </Button>
      </>
    ),
  }
}

/**
 * Show which product CLI a bundle runs, and offer its download, cancellation, or removal.
 * @param props - the bundle, the statuses, and the page's callbacks.
 * @returns the section, or null for a bundle that runs no product CLI.
 */
export function ProductCliSection(props: ProductCliSectionProps): ReactNode {
  const { bundle, state, t, ensure } = props
  const id = PRODUCT_CLI_BUNDLES[bundle]
  useEffect(() => { if (id !== undefined) ensure() }, [id, ensure])
  if (id === undefined) return null
  const cli = state.clis.find(item => item.id === id)
  const summary = summaryOf(props, cli, state.tasks[id])
  const missing = cli !== undefined && !cli.available
  return (
    <section className={css.detailSection} data-product-cli={id}>
      <h4 className={css.sectionTitle}>{t('productCliTitle')}</h4>
      <div className={css.versionPanel}>
        <div className={css.versionSummary} role="status">
          <span className={css.versionGlyph} data-tone={summary.tone} aria-hidden="true">{summary.glyph}</span>
          <span className={css.versionSummaryText}>
            <span className={`${css.versionSummaryTitle} ${css.productCliTitle}`}>{summary.title}</span>
            {summary.sub === undefined ? null : <span className={css.versionSummarySub}>{summary.sub}</span>}
          </span>
          {summary.end === undefined ? null : <span className={css.versionSummaryEnd}>{summary.end}</span>}
        </div>
        {missing
          ? (
            <div className={css.productCliNotes}>
              {cli.tooOld.map(old => (
                <p key={old.path} data-product-cli-too-old>
                  {t('productCliTooOld', { product: `${cli.displayName} ${old.version}`, path: old.path, minimum: cli.minimumVersion })}
                </p>
              ))}
              <p>
                {t('productCliInstallYourself')} <code data-product-cli-command>{cli.installCommand}</code>
              </p>
            </div>
          )
          : null}
      </div>
    </section>
  )
}
