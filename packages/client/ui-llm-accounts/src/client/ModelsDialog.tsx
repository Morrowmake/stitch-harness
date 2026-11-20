/**
 * Per-account model allowlist editor. "All models" stores no list (the account follows the catalog, future models
 * included); "Only the selected models" stores the ticked ids, and ticking none stores an empty list (no models).
 * The draft is saved through `updateAccount` only on Save.
 */
import { useEffect, useId, useState, type ReactNode } from 'react'
import { Button, Checkbox, Modal, SegmentedControl } from '@deepseek-ai/dsh-client-ui-primitives'
import type { Translate } from '@deepseek-ai/dsh-client-ui-slots'
import type { AccountView } from '@deepseek-ai/dsh-api-remotes/client'
import { accountName } from './format.ts'
import type { LlmAccountsKey } from './locales.ts'
import type { AccountsOperations, CatalogModel } from './operations.ts'
import { refusalText } from './SignInDialog.tsx'
import css from './accounts.module.css'

/** Props of {@link ModelsDialog}. */
export interface ModelsDialogProps {
  readonly account: AccountView
  readonly operations: AccountsOperations
  readonly t: Translate<LlmAccountsKey>
  readonly onClose: () => void
}

type Catalog = { status: 'loading' } | { status: 'ready'; models: readonly CatalogModel[] } | { status: 'failed'; message: string }

/**
 * Edit one account's model allowlist.
 * @param props - the account, operations, translator, and the close callback.
 * @returns the dialog.
 */
export function ModelsDialog({ account, operations, t, onClose }: ModelsDialogProps): ReactNode {
  const modeId = useId()
  const [catalog, setCatalog] = useState<Catalog>({ status: 'loading' })
  const [follow, setFollow] = useState(account.models === undefined)
  const [selected, setSelected] = useState<readonly string[]>(account.models ?? [])
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string>()

  useEffect(() => {
    let live = true
    void operations.catalogModels(account.provider).then((outcome) => {
      if (!live) return
      setCatalog(outcome.ok ? { status: 'ready', models: outcome.value } : { status: 'failed', message: outcome.message })
    })
    return () => { live = false }
  }, [operations, account.provider])

  // Ids the account already lists but the catalog no longer offers stay visible so saving never drops them silently.
  const models = catalog.status === 'ready'
    ? [...catalog.models, ...selected.filter(id => !catalog.models.some(model => model.id === id)).map(id => ({ id, name: id }))]
    : []
  const toggle = (id: string, on: boolean): void => {
    setSelected(current => on ? [...current, id] : current.filter(entry => entry !== id))
  }
  const save = (): void => {
    setSaving(true)
    setError(undefined)
    void operations.updateAccount(account.provider, account.id, { models: follow ? null : selected })
      .then((outcome) => { if (outcome.ok) onClose(); else setError(refusalText(outcome, t)) })
      .finally(() => { setSaving(false) })
  }
  return (
    <Modal open title={t('models.title', { account: accountName(account) })} closeLabel={t('close')} onClose={onClose}
      footer={<>
        <Button variant="ghost" onClick={onClose}>{t('cancel')}</Button>
        <Button variant="primary" disabled={saving} onClick={save}>{t('save')}</Button>
      </>}>
      <div className={css.dialogBody} data-llm-models={follow ? 'follow' : 'explicit'}>
        <SegmentedControl<'follow' | 'explicit'>
          id={modeId}
          label={t('account.models')}
          value={follow ? 'follow' : 'explicit'}
          onChange={(value) => { setFollow(value === 'follow') }}
          options={[
            { value: 'follow', label: t('models.follow') },
            { value: 'explicit', label: t('models.explicit') },
          ]}
        />
        {follow ? <p className={css.muted}>{t('models.followHint')}</p> : catalog.status === 'loading'
          ? <p className={css.muted}>{t('models.loading')}</p>
          : catalog.status === 'failed'
            ? <p className={css.error} role="alert">{t('models.loadFailed', { message: catalog.message })}</p>
            : models.length === 0
              ? <p className={css.muted}>{t('models.empty')}</p>
              : (
                <div className={css.modelList}>
                  {models.map(model => (
                    <Checkbox key={model.id} label={model.name} title={model.id} checked={selected.includes(model.id)}
                      onChange={(on) => { toggle(model.id, on) }} />
                  ))}
                </div>
              )}
        {error === undefined ? null : <p className={css.error} role="alert">{error}</p>}
      </div>
    </Modal>
  )
}
