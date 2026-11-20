/**
 * The first-run surface in the shell overlay: shown once per profile until the
 * user finishes or closes it, and on demand from the Plugins page ("Choose
 * components…") and Settings → Models ("Set up a provider…").
 */
import { useEffect, useState, type ReactNode } from 'react'
import { Button, Modal } from '@deepseek-ai/dsh-client-ui-primitives'
import type { InjectFace, PropsLocale, PropsRuntime, Translate } from '@deepseek-ai/dsh-client-ui-slots'
import type {} from '@deepseek-ai/dsh-client-ui-layout/client'
import { ComponentStep, type ComponentsResult } from './ComponentStep.tsx'
import { visibleEntry, type FlowEntry } from './flow.ts'
import type { FirstRunKey, NS } from './locales.ts'
import { ModelStep } from './ModelStep.tsx'
import { ProviderStep, type ReadyProvider } from './ProviderStep.tsx'
import { FIRST_RUN_COMPLETED_FIELD, FIRST_RUN_VERSION, WELCOME_ACK_FIELD } from '../settings.ts'
import type { ComponentOperations, FirstRunOverlayInjected } from './types.ts'
import type { FirstRunOperations } from './operations.ts'
import css from './first-run.module.css'

/** Root overlay props. */
export type FirstRunOverlayProps = PropsRuntime<'shell.overlay'> & InjectFace<FirstRunOverlayInjected> & PropsLocale<typeof NS>

/** The steps one entry walks, in order. */
type Step = 'provider' | 'model' | 'components' | 'done'

/**
 * The steps an entry walks.
 * @param entry - how the flow was opened.
 * @returns the steps, `done` last.
 */
export function stepsOf(entry: FlowEntry): readonly Step[] {
  if (entry === 'provider') return ['provider', 'model', 'done']
  if (entry === 'components') return ['components', 'done']
  return ['provider', 'model', 'components', 'done']
}

/**
 * Render the first-run dialog when an entry point asked for it, or once per profile.
 * The automatic first run waits while the preview notice is still to be
 * acknowledged, so the two dialogs never stack.
 * @param props - open state, completion, preview-notice state, operations, the close callback, and copy.
 * @returns the dialog, or nothing.
 */
export function FirstRunOverlay({
  useFlow, useFirstRun, useWelcome, welcomeGate, operations, components, close, t,
}: FirstRunOverlayProps): ReactNode {
  const flow = useFlow(state => state)
  const pending = useFirstRun(scope => scope.status === 'ready' && scope.writable
    && scope.value?.[FIRST_RUN_COMPLETED_FIELD] !== FIRST_RUN_VERSION)
  const noticeFirst = useWelcome(scope => welcomeGate && (scope.status === 'loading'
    || (scope.status === 'ready' && typeof scope.value?.[WELCOME_ACK_FIELD] !== 'string')))
  const entry = visibleEntry(flow, pending && !noticeFirst)
  if (entry === null) return null
  return <FirstRunDialog key={entry} entry={entry} operations={operations} components={components} close={close} t={t} />
}

/** What the done step summarizes. */
interface Summary {
  readonly provider?: string
  readonly model?: string
  readonly components?: ComponentsResult
}

function FirstRunDialog({ entry, operations, components, close, t }: {
  entry: FlowEntry
  operations: FirstRunOperations
  components: ComponentOperations
  close: FirstRunOverlayInjected['close']
  t: Translate<FirstRunKey>
}): ReactNode {
  const steps = stepsOf(entry)
  // The steps walked so far; Back pops one.
  const [trail, setTrail] = useState<readonly Step[]>([steps[0] ?? 'done'])
  const step = trail.at(-1) ?? 'done'
  const [provider, setProvider] = useState<ReadyProvider>()
  const [summary, setSummary] = useState<Summary>({})
  // Whether the user skipped the provider step: its model step drops out of the count.
  const [skipped, setSkipped] = useState(false)
  // Whether any provider serves requests, asked when the flow ends without one picked here.
  const [anyProvider, setAnyProvider] = useState<boolean>()
  const go = (next: Step): void => { setTrail(current => [...current, next]) }
  const advance = (from: Step): void => { go(steps[steps.indexOf(from) + 1] ?? 'done') }
  const back = (): void => { setTrail(current => current.length > 1 ? current.slice(0, -1) : current) }
  const finish = (): void => { close(entry) }
  const asksForProvider = step === 'done' && entry !== 'components' && summary.provider === undefined

  useEffect(() => {
    if (!asksForProvider) return
    let live = true
    setAnyProvider(undefined)
    void operations.configuredProviders().then((outcome) => {
      if (live) setAnyProvider(outcome.ok && outcome.value.length > 0)
    })
    return () => { live = false }
  }, [asksForProvider])
  const noProvider = asksForProvider && anyProvider === false

  const counted: readonly Step[] = steps.filter(candidate => candidate !== 'done' && !(candidate === 'model' && skipped))
  const index = counted.indexOf(step)
  const titles: Record<Step, FirstRunKey> = {
    provider: 'provider.title', model: 'model.title', components: 'components.title', done: 'done.title',
  }
  const backButton = trail.length > 1 ? <Button variant="ghost" onClick={back}>{t('back')}</Button> : null
  const forward = step === 'done'
    ? <Button variant="primary" data-modal-autofocus onClick={finish}>{entry === 'first-run' ? t('done.start') : t('done.close')}</Button>
    : step === 'provider' && entry !== 'first-run'
      ? <Button variant="ghost" onClick={finish}>{t('close')}</Button>
      : step === 'provider'
        ? (
          <Button variant="ghost" onClick={() => {
            setProvider(undefined)
            setSkipped(true)
            setSummary(({ provider: _provider, model: _model, ...rest }) => rest)
            advance('model')
          }}>
            {t('skip')}
          </Button>
        )
        : step === 'model' ? <Button variant="ghost" onClick={() => { advance('model') }}>{t('skip')}</Button> : null

  return (
    <Modal open title={noProvider ? t('done.titleNoProvider') : t(titles[step])}
      closeLabel={t('close')} onClose={finish} className={css.dialog ?? ''} contentClassName={css.content ?? ''}
      footer={backButton === null && forward === null ? undefined : <>{backButton}{forward}</>}>
      <div className={css.step} data-first-run-step={step}>
        {index < 0 || counted.length < 2 ? null : <p className={css.progress}>{t('progress', { current: index + 1, total: counted.length })}</p>}
        {step === 'provider'
          ? (
            <ProviderStep operations={operations} t={t} onReady={(ready) => {
              setProvider(ready)
              setSkipped(false)
              setSummary(({ model: _model, ...rest }) => ({ ...rest, provider: ready.name }))
              go('model')
            }} />
          )
          : null}
        {step === 'model' && provider !== undefined
          ? (
            <ModelStep provider={provider} operations={operations} t={t} onSaved={(model) => {
              setSummary(current => ({ ...current, model }))
              advance('model')
            }} />
          )
          : null}
        {step === 'components'
          ? (
            <ComponentStep components={components} t={t} firstRun={entry === 'first-run'} onApplied={(result) => {
              setSummary(current => ({ ...current, components: result }))
              advance('components')
            }} />
          )
          : null}
        {step === 'done' ? <DoneStep summary={summary} entry={entry} noProvider={noProvider} t={t} setUp={() => { go('provider') }} /> : null}
      </div>
    </Modal>
  )
}

function DoneStep({ summary, entry, noProvider, t, setUp }: {
  summary: Summary
  entry: FlowEntry
  /** The flow ends with no provider serving requests. */
  noProvider: boolean
  t: Translate<FirstRunKey>
  /** Return to the provider step. */
  setUp: () => void
}): ReactNode {
  const presetLabels = { standard: t('preset.standard'), custom: t('preset.custom') }
  return (
    <div className={css.group}>
      {noProvider
        ? (
          <>
            <p className={css.intro}>{t('done.noProvider')}</p>
            <div className={css.rowHead}><Button variant="outline" size="sm" onClick={setUp}>{t('done.setUp')}</Button></div>
          </>
        )
        : entry === 'components' || summary.provider === undefined ? null : (
          <p className={css.intro}>
            {summary.model === undefined
              ? t('done.provider', { provider: summary.provider })
              : t('done.providerModel', { provider: summary.provider, model: summary.model })}
          </p>
        )}
      {summary.components === undefined ? null : (
        <p className={css.intro}>{t('done.components', { preset: presetLabels[summary.components.preset] })}</p>
      )}
      {summary.components?.restartRequired === true ? <p className={css.notice} role="status">{t('done.restart')}</p> : null}
      <p className={css.muted}>{t('done.later')}</p>
    </div>
  )
}
