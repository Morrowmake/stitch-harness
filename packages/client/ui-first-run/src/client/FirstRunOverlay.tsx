/**
 * The first-run surface in the shell overlay: shown once per profile until the
 * user finishes or closes it, and on demand from the Plugins page ("Choose
 * components…") and Settings → Models ("Set up a provider…").
 */
import { useState, type ReactNode } from 'react'
import { Button, Modal } from '@deepseek-ai/dsh-client-ui-primitives'
import type { InjectFace, PropsLocale, PropsRuntime, Translate } from '@deepseek-ai/dsh-client-ui-slots'
import type {} from '@deepseek-ai/dsh-client-ui-layout/client'
import { ComponentStep, type ComponentsResult } from './ComponentStep.tsx'
import { visibleEntry, type FlowEntry } from './flow.ts'
import type { FirstRunKey, NS } from './locales.ts'
import { ModelStep } from './ModelStep.tsx'
import { ProviderStep, type ReadyProvider } from './ProviderStep.tsx'
import { FIRST_RUN_COMPLETED_FIELD, FIRST_RUN_VERSION } from '../settings.ts'
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
 * @param props - open state, completion, operations, the close callback, and copy.
 * @returns the dialog, or nothing.
 */
export function FirstRunOverlay({ useFlow, useFirstRun, operations, components, close, t }: FirstRunOverlayProps): ReactNode {
  const flow = useFlow(state => state)
  const pending = useFirstRun(scope => scope.status === 'ready' && scope.writable
    && scope.value?.[FIRST_RUN_COMPLETED_FIELD] !== FIRST_RUN_VERSION)
  const entry = visibleEntry(flow, pending)
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
  const [step, setStep] = useState<Step>(steps[0] ?? 'done')
  const [provider, setProvider] = useState<ReadyProvider>()
  const [summary, setSummary] = useState<Summary>({})
  const advance = (from: Step): void => { setStep(steps[steps.indexOf(from) + 1] ?? 'done') }
  const finish = (): void => { close(entry) }

  const counted: readonly Step[] = steps.filter(candidate => candidate !== 'done')
  const index = counted.indexOf(step)
  const titles: Record<Step, FirstRunKey> = {
    provider: 'provider.title', model: 'model.title', components: 'components.title', done: 'done.title',
  }
  const skip = step === 'provider' || step === 'model'
    ? <Button variant="ghost" onClick={() => { advance(step === 'provider' ? 'model' : step) }}>{t('skip')}</Button>
    : undefined
  const footer = step === 'done'
    ? <Button variant="primary" data-modal-autofocus onClick={finish}>{entry === 'first-run' ? t('done.start') : t('done.close')}</Button>
    : skip

  return (
    <Modal open title={t(titles[step])} closeLabel={t('close')} onClose={finish} className={css.dialog ?? ''} contentClassName={css.content ?? ''}
      footer={footer}>
      <div className={css.step} data-first-run-step={step}>
        {index < 0 || counted.length < 2 ? null : <p className={css.progress}>{t('progress', { current: index + 1, total: counted.length })}</p>}
        {step === 'provider'
          ? (
            <ProviderStep operations={operations} t={t} onReady={(ready) => {
              setProvider(ready)
              setSummary(current => ({ ...current, provider: ready.name }))
              setStep('model')
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
            <ComponentStep components={components} t={t} onApplied={(result) => {
              setSummary(current => ({ ...current, components: result }))
              advance('components')
            }} />
          )
          : null}
        {step === 'done' ? <DoneStep summary={summary} entry={entry} t={t} /> : null}
      </div>
    </Modal>
  )
}

function DoneStep({ summary, entry, t }: { summary: Summary; entry: FlowEntry; t: Translate<FirstRunKey> }): ReactNode {
  const presetLabels = { minimal: t('preset.minimal'), standard: t('preset.standard'), custom: t('preset.custom') }
  return (
    <div className={css.group}>
      {entry === 'components' ? null : (
        <p className={css.intro}>
          {summary.provider === undefined
            ? t('done.noProvider')
            : summary.model === undefined
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
