/**
 * Step 2, the default model: the models of the provider just set up, one of
 * which becomes the default for new Sessions (the same selection the composer
 * stores when a Session switches model).
 */
import { useEffect, useState, type ReactNode } from 'react'
import { Button, StateDot } from '@deepseek-ai/dsh-client-ui-primitives'
import type { Translate } from '@deepseek-ai/dsh-client-ui-slots'
import type { FirstRunKey } from './locales.ts'
import type { FirstRunOperations, ProviderModel } from './operations.ts'
import type { ReadyProvider } from './ProviderStep.tsx'
import { refusalText } from './errors.ts'
import css from './first-run.module.css'

/** Props of {@link ModelStep}. */
export interface ModelStepProps {
  readonly provider: ReadyProvider
  readonly operations: FirstRunOperations
  readonly t: Translate<FirstRunKey>
  /** The default was stored; `model` is its display name. */
  readonly onSaved: (model: string) => void
}

type Models = { readonly status: 'loading' } | { readonly status: 'ready'; readonly models: readonly ProviderModel[] } | { readonly status: 'error'; readonly message: string }

/**
 * Render the default-model choice.
 * @param props - provider, operations, translator, and the saved callback.
 * @returns the step body.
 */
export function ModelStep({ provider, operations, t, onSaved }: ModelStepProps): ReactNode {
  const known = provider.models
  const [generation, setGeneration] = useState(0)
  const [state, setState] = useState<Models>(known === undefined
    ? { status: 'loading' }
    : { status: 'ready', models: known.map(id => ({ id, name: id })) })
  const [chosen, setChosen] = useState<string>()
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string>()

  useEffect(() => {
    if (known !== undefined) return
    let live = true
    setState({ status: 'loading' })
    void operations.providerModels(provider.id).then((outcome) => {
      if (!live) return
      setState(outcome.ok ? { status: 'ready', models: outcome.value } : { status: 'error', message: refusalText(outcome, t) })
    })
    return () => { live = false }
    // The provider is fixed for a mounted step; the generation reruns the read.
  }, [generation])

  const models = state.status === 'ready' ? state.models : []
  // Nothing is chosen for the user: a lone model is the only answer, otherwise they pick.
  const selected = chosen ?? (models.length === 1 ? models[0]?.id : undefined)
  const current = models.filter(model => model.older !== true)
  // A provider whose every model is marked older still lists them up front.
  const shown = current.length === 0 ? models : current
  const older = current.length === 0 ? [] : models.filter(model => model.older === true)
  const [olderOpen, setOlderOpen] = useState(false)
  const save = (): void => {
    const model = models.find(entry => entry.id === selected)
    if (model === undefined) return
    setBusy(true)
    setError(undefined)
    void operations.saveDefaultModel(provider.id, model.id).then((outcome) => {
      if (outcome.ok) onSaved(model.name)
      else setError(refusalText(outcome, t))
    }).finally(() => { setBusy(false) })
  }

  return (
    <div className={css.step}>
      <p className={css.intro}>{t('model.intro', { provider: provider.name })}</p>
      {state.status === 'loading' ? <p className={css.muted}><StateDot state="ongoing" /> {t('model.loading')}</p> : null}
      {state.status === 'error' ? <p className={css.error} role="alert">{state.message}</p> : null}
      {state.status === 'ready' && models.length === 0 ? <p className={css.muted}>{t('model.empty')}</p> : null}
      {state.status !== 'loading' && models.length === 0 && known === undefined
        ? <div className={css.rowHead}><Button variant="ghost" size="sm" onClick={() => { setGeneration(value => value + 1) }}>{t('retry')}</Button></div>
        : null}
      {models.length === 0 ? null : (
        <div className={css.models} role="radiogroup" aria-label={t('model.title')}>
          <ModelChoices models={shown} selected={selected} busy={busy} choose={setChosen} />
          {older.length === 0 ? null : (
            <>
              <div className={css.rowHead}>
                <Button variant="ghost" size="sm" aria-expanded={olderOpen} onClick={() => { setOlderOpen(open => !open) }}>
                  {olderOpen ? t('model.olderHide') : t('model.olderShow', { count: older.length })}
                </Button>
              </div>
              {olderOpen ? <ModelChoices models={older} selected={selected} busy={busy} choose={setChosen} /> : null}
            </>
          )}
        </div>
      )}
      {models.length > 1 && selected === undefined ? <p className={css.muted}>{t('model.pick')}</p> : null}
      {error === undefined ? null : <p className={css.error} role="alert">{error}</p>}
      <div className={css.formActions}>
        <Button variant="primary" disabled={busy || selected === undefined} onClick={save}>{t('model.use')}</Button>
      </div>
    </div>
  )
}

function ModelChoices({ models, selected, busy, choose }: {
  models: readonly ProviderModel[]
  selected: string | undefined
  busy: boolean
  choose: (id: string) => void
}): ReactNode {
  return (
    <ul className={css.modelList}>
      {models.map(model => (
        <li key={model.id}>
          <label className={css.field}>
            <span className={css.rowHead}>
              <input type="radio" name="first-run-default-model" value={model.id} checked={selected === model.id} disabled={busy}
                onChange={() => { choose(model.id) }} />
              <span className={css.name}>{model.name}</span>
              {model.name === model.id ? null : <span className={css.detail}>{model.id}</span>}
            </span>
          </label>
        </li>
      ))}
    </ul>
  )
}
