/**
 * Add-API-key dialog for providers whose key is a single value: the key crosses to the Host once and never returns.
 * The Host checks the key with the provider before storing it, so the dialog shows the check, keeps itself open on a
 * refused key, and says so when the key was stored without a check.
 */
import { useState, type ReactNode } from 'react'
import type { AccountView } from '@deepseek-ai/dsh-api-remotes/client'
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
  /** The key account this new key replaces: removed once the new key is stored, its default role carried over. */
  readonly replaces?: AccountView
}

/**
 * Collect an API key and an optional account name, then add the account.
 * @param props - provider, operations, translator, the close callback, and the account a replacement retires.
 * @returns the dialog.
 */
export function ApiKeyDialog({ provider, displayName, operations, t, onClose, replaces }: ApiKeyDialogProps): ReactNode {
  const [key, setKey] = useState('')
  const [alias, setAlias] = useState(replaces?.alias ?? '')
  const [checking, setChecking] = useState(false)
  const [error, setError] = useState<string>()
  /** Set once the key was stored without the provider confirming it. */
  const [unverified, setUnverified] = useState(false)
  const save = (): void => {
    const trimmed = alias.trim()
    setChecking(true)
    setError(undefined)
    void (async () => {
      const outcome = await operations.addApiKeyAccount(provider, trimmed === '' ? { key: key.trim() } : { key: key.trim(), alias: trimmed })
      if (!outcome.ok) {
        setError(outcome.reason === 'key-rejected' ? t('apikey.rejectedBy', { provider: displayName }) : refusalText(outcome, t))
        return
      }
      if (replaces !== undefined) {
        if (replaces.isDefault) await operations.setDefaultAccount(provider, outcome.value.account.id)
        await operations.removeAccount(provider, replaces.id)
      }
      if (outcome.value.check.status === 'verified') onClose()
      else setUnverified(true)
    })()
      .catch((cause: unknown) => { setError(t('action.failed', { message: cause instanceof Error ? cause.message : String(cause) })) })
      .finally(() => { setChecking(false) })
  }
  const title = replaces === undefined
    ? t('signin.apiKeyTitle', { provider: displayName })
    : t('apikey.replaceTitle', { provider: displayName })
  if (unverified) {
    return (
      <Modal open title={title} closeLabel={t('close')} onClose={onClose}
        footer={<Button variant="primary" data-modal-autofocus onClick={onClose}>{t('done')}</Button>}>
        <p className={css.warn} role="status">{t('apikey.unverified')}</p>
      </Modal>
    )
  }
  return (
    <Modal open title={title} closeLabel={t('close')} onClose={onClose}
      footer={<>
        <Button variant="ghost" onClick={onClose}>{t('cancel')}</Button>
        <Button variant="primary" disabled={checking || key.trim() === ''} onClick={save}>
          {checking ? t('apikey.checking') : t('apikey.add')}
        </Button>
      </>}>
      <form className={css.dialogBody} aria-busy={checking}
        onSubmit={(event) => { event.preventDefault(); if (!checking && key.trim() !== '') save() }}>
        <label className={css.field}>
          <span>{t('apikey.key')}</span>
          <Input type="password" autoComplete="new-password" value={key} data-modal-autofocus
            onChange={(event) => { setKey(event.target.value); setError(undefined) }} />
        </label>
        <label className={css.field}>
          <span>{t('signin.alias')}</span>
          <Input value={alias} maxLength={80} onChange={(event) => { setAlias(event.target.value) }} />
        </label>
        {checking ? <p className={css.muted} role="status"><span className={css.spinner} aria-hidden />{t('apikey.checkingHint')}</p> : null}
        {error === undefined ? null : <p className={css.error} role="alert">{error}</p>}
      </form>
    </Modal>
  )
}
