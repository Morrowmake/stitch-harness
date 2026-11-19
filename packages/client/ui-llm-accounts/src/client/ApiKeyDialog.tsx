/** Add-API-key dialog for providers whose key is a single value: the key crosses to the Host once and never returns. */
import { useState, type ReactNode } from 'react'
import { Button, Input, Modal } from '@deepseek-ai/dsh-client-ui-primitives'
import type { Translate } from '@deepseek-ai/dsh-client-ui-slots'
import type { LlmAccountsKey } from './locales.ts'
import type { AccountsOperations } from './operations.ts'
import { refusalText } from './SignInDialog.tsx'
import css from './accounts.module.css'

/** Props of {@link ApiKeyDialog}. */
export interface ApiKeyDialogProps {
  readonly provider: string
  readonly displayName: string
  readonly operations: AccountsOperations
  readonly t: Translate<LlmAccountsKey>
  readonly onClose: () => void
}

/**
 * Collect an API key and an optional account name, then add the account.
 * @param props - provider, operations, translator, and the close callback.
 * @returns the dialog.
 */
export function ApiKeyDialog({ provider, displayName, operations, t, onClose }: ApiKeyDialogProps): ReactNode {
  const [key, setKey] = useState('')
  const [alias, setAlias] = useState('')
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string>()
  const save = (): void => {
    const trimmed = alias.trim()
    setSaving(true)
    setError(undefined)
    void operations.addApiKeyAccount(provider, trimmed === '' ? { key: key.trim() } : { key: key.trim(), alias: trimmed })
      .then((outcome) => { if (outcome.ok) onClose(); else setError(refusalText(outcome, t)) })
      .finally(() => { setSaving(false) })
  }
  return (
    <Modal open title={t('signin.apiKeyTitle', { provider: displayName })} closeLabel={t('close')} onClose={onClose}
      footer={<>
        <Button variant="ghost" onClick={onClose}>{t('cancel')}</Button>
        <Button variant="primary" disabled={saving || key.trim() === ''} onClick={save}>{t('apikey.add')}</Button>
      </>}>
      <form className={css.dialogBody} onSubmit={(event) => { event.preventDefault(); if (key.trim() !== '') save() }}>
        <label className={css.field}>
          <span>{t('apikey.key')}</span>
          <Input type="password" autoComplete="new-password" value={key} data-modal-autofocus
            onChange={(event) => { setKey(event.target.value) }} />
        </label>
        <label className={css.field}>
          <span>{t('signin.alias')}</span>
          <Input value={alias} maxLength={80} onChange={(event) => { setAlias(event.target.value) }} />
        </label>
        {error === undefined ? null : <p className={css.error} role="alert">{error}</p>}
      </form>
    </Modal>
  )
}
