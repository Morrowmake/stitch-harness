/**
 * Step 3, the component picker: Standard (the shipped default) or a custom set
 * of ticks, applied in one batched plugin-manager change.
 */
import { useEffect, useState, type ReactNode } from 'react'
import { Button, Checkbox, SegmentedControl, StateDot } from '@deepseek-ai/dsh-client-ui-primitives'
import type { Translate } from '@deepseek-ai/dsh-client-ui-slots'
import {
  bundleChanges, currentSelection, presetSelection, selectionPreset, toggleComponent,
  type ComponentEntry, type ComponentPreset,
} from './components.ts'
import type { FirstRunKey } from './locales.ts'
import { refusalText } from './errors.ts'
import type { ComponentOperations } from './types.ts'
import css from './first-run.module.css'

/** What the step applied. */
export interface ComponentsResult {
  readonly preset: ComponentPreset
  readonly restartRequired: boolean
}

/** Props of {@link ComponentStep}. */
export interface ComponentStepProps {
  readonly components: ComponentOperations
  readonly t: Translate<FirstRunKey>
  /** Opened by the automatic first run: Custom then starts from Core alone instead of the current ticks. */
  readonly firstRun: boolean
  readonly onApplied: (result: ComponentsResult) => void
}

type Listed = { readonly status: 'loading' } | { readonly status: 'ready'; readonly list: readonly ComponentEntry[] } | { readonly status: 'error'; readonly message: string }

/**
 * Render the component picker.
 * @param props - operations, translator, and the applied callback.
 * @returns the step body.
 */
export function ComponentStep({ components, t, firstRun, onApplied }: ComponentStepProps): ReactNode {
  const [generation, setGeneration] = useState(0)
  const [listed, setListed] = useState<Listed>({ status: 'loading' })
  /** The user's explicit mode; `undefined` follows the profile's current set. */
  const [mode, setMode] = useState<ComponentPreset>()
  const [selection, setSelection] = useState<ReadonlySet<string>>()
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string>()

  useEffect(() => {
    let live = true
    setListed({ status: 'loading' })
    void components.list().then((outcome) => {
      if (!live) return
      setListed(outcome.ok ? { status: 'ready', list: outcome.value } : { status: 'error', message: refusalText(outcome, t) })
    })
    return () => { live = false }
    // The operations are bound once; the generation reruns the read.
  }, [generation])

  if (listed.status === 'loading') return <p className={css.muted}><StateDot state="ongoing" /> {t('components.loading')}</p>
  if (listed.status === 'error') {
    return (
      <div className={css.step}>
        <p className={css.error} role="alert">{listed.message}</p>
        <div className={css.rowHead}><Button variant="ghost" size="sm" onClick={() => { setGeneration(value => value + 1) }}>{t('retry')}</Button></div>
      </div>
    )
  }

  const list = listed.list
  const ticks = selection ?? currentSelection(list)
  const shownMode = mode ?? selectionPreset(list, ticks)
  const choose = (next: ComponentPreset): void => {
    setMode(next)
    if (next !== 'custom') setSelection(presetSelection(list, next))
    // In the first run Custom starts with only Core on; opened later it keeps the ticks shown now.
    else if (firstRun) setSelection(new Set())
  }
  const apply = (): void => {
    const changes = bundleChanges(list, ticks)
    const preset = selectionPreset(list, ticks)
    if (Object.keys(changes).length === 0) {
      onApplied({ preset, restartRequired: false })
      return
    }
    setBusy(true)
    setError(undefined)
    void components.apply(changes).then((outcome) => {
      if (outcome.ok) onApplied({ preset, restartRequired: outcome.value.restartRequired })
      else setError(refusalText(outcome, t))
    }).finally(() => { setBusy(false) })
  }
  const titleOf = new Map(list.map(component => [component.id, component.title]))

  return (
    <div className={css.step}>
      <p className={css.intro}>{t('components.intro')}</p>
      <SegmentedControl id="first-run-components" label={t('components.preset')} value={shownMode}
        options={[
          { value: 'standard', label: t('preset.standard'), disabled: busy },
          { value: 'custom', label: t('preset.custom'), disabled: busy },
        ]}
        onChange={choose} />
      <div id={`first-run-components-${shownMode}-panel`} role="tabpanel" aria-labelledby={`first-run-components-${shownMode}`} className={css.group}>
        <div className={css.presets}>
          <p className={css.hint}>{t(`preset.${shownMode}Hint` as const)}</p>
        </div>
        <p className={css.muted}>{t('components.core')}</p>
        <ul className={css.rows}>
          {list.map(component => (
            <li key={component.id} className={css.row} data-first-run-component={component.id}>
              <div className={css.rowHead}>
                <Checkbox className={css.name} label={component.title} checked={ticks.has(component.id)} disabled={busy || shownMode !== 'custom'}
                  onChange={(checked) => { setSelection(toggleComponent(list, ticks, component.id, checked)) }} />
                {component.icon === undefined ? null : <img className={`${css.icon ?? ''} ${css.rowActions ?? ''}`} src={component.icon} alt="" />}
              </div>
              {component.description === '' ? null : <span className={css.detail}>{component.description}</span>}
              {component.requires.length === 0 ? null : (
                <span className={css.detail}>
                  {t('components.requires', { names: component.requires.map(id => titleOf.get(id) ?? id).join(', ') })}
                </span>
              )}
            </li>
          ))}
        </ul>
      </div>
      {error === undefined ? null : <p className={css.error} role="alert">{error}</p>}
      <div className={css.formActions}>
        <Button variant="primary" disabled={busy} onClick={apply}>{busy ? t('components.applying') : t('components.apply')}</Button>
      </div>
    </div>
  )
}
