/**
 * The Accounts section inside every pi-ai provider card: one row per account with its kind, default marker, pool and
 * model-picker switches, model allowlist, health, and usage bars, plus Sign in / Add API key. Every change is one
 * `llmAccounts` Remote call; the rows re-render from the next pushed snapshot.
 */
import { useEffect, useId, useState, type ReactNode } from 'react'
import { Button, Input, Modal, Switch, Tag, type TagTone } from '@deepseek-ai/dsh-client-ui-primitives'
import type { InjectFace, PropsRuntime, Translate } from '@deepseek-ai/dsh-client-ui-slots'
import type {} from '@deepseek-ai/dsh-client-ui-settings-models/client'
import type { AccountKind, AccountView, ProviderAccountsView, SignInRequest } from '@deepseek-ai/dsh-api-remotes/client'
import { ApiKeyDialog } from './ApiKeyDialog.tsx'
import { accountName, formatRemaining, signInTarget } from './format.ts'
import type { LlmAccountsKey } from './locales.ts'
import { ModelsDialog } from './ModelsDialog.tsx'
import type { AccountsOperations, Outcome } from './operations.ts'
import { refusalText, SignInDialog } from './SignInDialog.tsx'
import type { AccountsSectionInjected } from './types.ts'
import { UsageBars } from './UsageBars.tsx'
import css from './accounts.module.css'

type T = Translate<LlmAccountsKey>

/** Props the `settings.models.provider-card` entry receives. */
export type AccountsSectionProps = Pick<PropsRuntime<'settings.models.provider-card'>, 'provider' | 'reportOwnCredentials'>
  & InjectFace<AccountsSectionInjected> & { t: T }

const KIND_TONE: Record<AccountKind, TagTone> = { oauth: 'success', 'api-key': 'info', 'key-ref': 'neutral', ambient: 'quiet' }

/** The dialog the section shows, at most one at a time. */
type Dialog =
  | { kind: 'sign-in'; request: SignInRequest }
  | { kind: 'api-key'; replaces?: AccountView }
  | { kind: 'models'; account: AccountView }
  | { kind: 'rename'; account: AccountView }
  | { kind: 'remove'; account: AccountView }

/**
 * Render the Accounts section of one provider card.
 * @param props - the card's directory row, the accounts store, operations, and translator.
 * @returns the section, or null when the Host lists no accounts view for this route.
 */
export function AccountsSection(props: AccountsSectionProps): ReactNode {
  const { provider, reportOwnCredentials, useAccounts, acquire, operations, t } = props
  const route = provider.provider
  const view = useAccounts(state => state.snapshot?.providers.find(entry => entry.provider === route))
  const linked = useAccounts(state => state.linked)
  const [dialog, setDialog] = useState<Dialog>()
  const [error, setError] = useState<string>()
  const [busy, setBusy] = useState(false)
  useEffect(() => acquire(), [acquire])
  // Signed-in accounts and stored keys are credentials of this section's own; the card's key field then steps aside.
  const ownCredentials = view?.accounts.some(account => account.kind === 'oauth' || account.kind === 'api-key') === true
  useEffect(() => { reportOwnCredentials(route, ownCredentials) }, [reportOwnCredentials, route, ownCredentials])

  if (view === undefined) return linked ? null : <p className={css.muted}>{t('section.unlinked')}</p>

  const run = (call: () => Promise<Outcome<unknown>>): void => {
    setBusy(true)
    setError(undefined)
    void call()
      .then((outcome) => { if (!outcome.ok) setError(refusalText(outcome, t)) })
      .catch((cause: unknown) => { setError(t('action.failed', { message: cause instanceof Error ? cause.message : String(cause) })) })
      .finally(() => { setBusy(false) })
  }
  const close = (): void => { setDialog(undefined) }
  const addKey = (replaces?: AccountView): void => {
    setDialog(view.apiKey.interactive
      ? { kind: 'sign-in', request: { method: 'api-key' } }
      : replaces === undefined ? { kind: 'api-key' } : { kind: 'api-key', replaces })
  }

  return (
    <section className={css.section} data-llm-accounts={route}>
      <div className={css.header}>
        <h4 className={css.title}>{t('section.title')}</h4>
        <div className={css.actions}>
          {view.oauth === undefined ? null : (
            <Button variant="outline" size="sm" onClick={() => { setDialog({ kind: 'sign-in', request: { method: 'oauth' } }) }}>
              {t('add.signIn', { label: signInTarget(view.oauth.label) })}
            </Button>
          )}
          <Button variant="outline" size="sm" onClick={() => { addKey() }}>{t('add.apiKey')}</Button>
        </div>
      </div>
      <p className={css.hint}>{t('section.hint')}</p>
      {view.accounts.length === 0 ? <p className={css.muted}>{t('section.empty')}</p> : (
        <ul className={css.rows}>
          {view.accounts.map(account => (
            <AccountRow key={account.id} view={view} account={account} busy={busy} t={t} operations={operations}
              run={run} open={setDialog} replaceKey={addKey} />
          ))}
        </ul>
      )}
      {linked ? null : <p className={css.warn}>{t('section.unlinked')}</p>}
      {error === undefined ? null : <p className={css.error} role="alert">{error}</p>}
      {dialog?.kind === 'sign-in'
        ? (
          <SignInDialog
            provider={route}
            displayName={view.displayName}
            request={dialog.request}
            operations={operations}
            t={t}
            onClose={close}
          />
        )
        : dialog?.kind === 'api-key'
          ? (
            <ApiKeyDialog provider={route} displayName={view.displayName} operations={operations} t={t} onClose={close}
              {...dialog.replaces === undefined ? {} : { replaces: dialog.replaces }} />
          )
          : dialog?.kind === 'models'
            ? <ModelsDialog account={dialog.account} operations={operations} t={t} onClose={close} />
            : dialog?.kind === 'rename'
              ? <RenameDialog account={dialog.account} operations={operations} t={t} onClose={close} />
              : dialog?.kind === 'remove'
                ? (
                  <Modal open tone="warning" title={t('remove.title', { account: accountName(dialog.account) })} closeLabel={t('close')}
                    onClose={close}
                    footer={<>
                      <Button variant="ghost" onClick={close}>{t('cancel')}</Button>
                      <Button variant="primary" data-modal-autofocus onClick={() => {
                        const target = dialog.account
                        close()
                        run(() => operations.removeAccount(target.provider, target.id))
                      }}>{t('account.remove')}</Button>
                    </>}>
                    <p>{t('remove.body')}</p>
                  </Modal>
                )
                : null}
    </section>
  )
}

interface AccountRowProps {
  readonly view: ProviderAccountsView
  readonly account: AccountView
  readonly busy: boolean
  readonly t: T
  readonly operations: AccountsOperations
  readonly run: (call: () => Promise<Outcome<unknown>>) => void
  readonly open: (dialog: Dialog) => void
  readonly replaceKey: (replaces: AccountView) => void
}

function modelsSummary(account: AccountView, t: T): string {
  if (account.models === undefined) return t('account.modelsAll')
  if (account.models.length === 0) return t('account.modelsNone')
  return t('account.modelsCount', { count: account.models.length })
}

/** What the last "Retry now" showed: still checking, or the Host's answer as text and tone. */
type RetryState = { readonly kind: 'checking' } | { readonly kind: 'done'; readonly text: string; readonly tone: 'ok' | 'warn' | 'error' }

/** One labelled switch with its one-line help. */
function LabelledSwitch({ label, help, checked, disabled, onChange }: {
  readonly label: string
  readonly help: string
  readonly checked: boolean
  readonly disabled: boolean
  readonly onChange: (next: boolean) => void
}): ReactNode {
  const helpId = useId()
  return (
    <div className={css.toggle}>
      <Switch label={label} describedBy={helpId} checked={checked} disabled={disabled} onChange={onChange} />
      <span className={css.toggleCopy}>
        <span className={css.toggleLabel} aria-hidden>{label}</span>
        <span id={helpId} className={css.toggleHelp}>{help}</span>
      </span>
    </div>
  )
}

function AccountRow({ view, account, busy, t, operations, run, open, replaceKey }: AccountRowProps): ReactNode {
  const [refreshing, setRefreshing] = useState(false)
  const [retry, setRetry] = useState<RetryState>()
  const { provider, id, health } = account
  const name = accountName(account)
  // Key accounts are never asked to sign in: a refused key reads as rejected.
  const keyAccount = account.kind === 'api-key' || account.kind === 'key-ref'
  const refresh = account.kind === 'oauth'
    ? () => {
      setRefreshing(true)
      void operations.refreshUsage(provider, id).finally(() => { setRefreshing(false) })
    }
    : undefined
  const retryNow = (): void => {
    setRetry({ kind: 'checking' })
    void operations.retryAccountNow(provider, id)
      .then((outcome): RetryState => {
        if (!outcome.ok) return { kind: 'done', text: refusalText(outcome, t), tone: 'error' }
        switch (outcome.value.status) {
          case 'verified': return { kind: 'done', text: t('retry.verified'), tone: 'ok' }
          case 'rejected': return { kind: 'done', text: t('retry.rejected'), tone: 'error' }
          case 'unverified': return { kind: 'done', text: t('retry.unverified'), tone: 'warn' }
          case 'cleared': return { kind: 'done', text: t('retry.cleared'), tone: 'ok' }
        }
      })
      .catch((cause: unknown): RetryState => ({
        kind: 'done', text: t('action.failed', { message: cause instanceof Error ? cause.message : String(cause) }), tone: 'error',
      }))
      .then(setRetry)
  }
  const checking = retry?.kind === 'checking'
  const identity = [account.identity?.email, account.identity?.plan].filter(part => part !== undefined).join(' · ')
  return (
    <li className={css.row} data-llm-account={id}>
      <div className={css.rowHead}>
        <span className={css.name}>{name}</span>
        <Tag tone={KIND_TONE[account.kind]}>{t(`kind.${account.kind}`)}</Tag>
        {account.isDefault
          ? <Tag tone="solid">{t('account.default')}</Tag>
          : <Button variant="ghost" size="sm" disabled={busy} onClick={() => { run(() => operations.setDefaultAccount(provider, id)) }}>
            {t('account.makeDefault')}
          </Button>}
        {health.state === 'cooling' && health.reason === 'REFRESH_FAILED'
          ? <Tag tone="danger">{t('health.refreshFailed')}</Tag>
          : health.state === 'cooling'
            ? <Tag tone="warning">{t('health.cooling', { time: formatRemaining(health.until - Date.now(), t) })}</Tag>
            : health.state === 'needs-sign-in'
              ? <Tag tone="danger">{t(keyAccount ? 'health.keyRejected' : 'health.needsSignIn')}</Tag>
              : null}
      </div>
      {identity === '' || identity === name ? null : <span className={css.muted}>{identity}</span>}
      {account.kind === 'key-ref' ? <span className={css.muted}>{t('account.envHint')}</span> : null}
      {account.kind === 'ambient' ? <span className={css.muted}>{t('account.ambientHint')}</span> : null}
      <div className={css.toggles}>
        <LabelledSwitch label={t('account.pooled')} help={t('account.pooledHelp')} checked={account.pooled} disabled={busy}
          onChange={(pooled) => { run(() => operations.updateAccount(provider, id, { pooled })) }} />
        <LabelledSwitch label={t('account.pinned')} help={t('account.pinnedHelp')} checked={account.pinned} disabled={busy}
          onChange={(pinned) => { run(() => operations.updateAccount(provider, id, { pinned })) }} />
      </div>
      <div className={css.controls}>
        <Button variant="outline" size="sm" disabled={busy} title={modelsSummary(account, t)}
          onClick={() => { open({ kind: 'models', account }) }}>
          {`${t('account.models')} ${modelsSummary(account, t)}`}
        </Button>
      </div>
      <UsageBars usage={account.usage} mode="used" t={t} onRefresh={refresh} refreshing={refreshing} />
      <div className={css.actions}>
        <Button variant="ghost" size="sm" disabled={busy} onClick={() => { open({ kind: 'rename', account }) }}>{t('account.rename')}</Button>
        {account.kind === 'oauth' && view.oauth !== undefined
          ? (
            <Button variant="ghost" size="sm" disabled={busy}
              onClick={() => { open({ kind: 'sign-in', request: { method: 'oauth', accountId: id } }) }}>
              {t('account.resignIn')}
            </Button>
          )
          : null}
        {account.kind === 'api-key' && health.state === 'needs-sign-in'
          ? <Button variant="ghost" size="sm" disabled={busy} onClick={() => { replaceKey(account) }}>{t('account.replaceKey')}</Button>
          : null}
        {health.state === 'ok' || account.kind === 'ambient' ? null : (
          <Button variant="ghost" size="sm" disabled={busy || checking} onClick={retryNow}>{t('account.retry')}</Button>
        )}
        {account.removable
          ? <Button variant="ghost" size="sm" disabled={busy} onClick={() => { open({ kind: 'remove', account }) }}>{t('account.remove')}</Button>
          : null}
      </div>
      {retry === undefined ? null : (
        <p className={retry.kind === 'checking' ? css.muted : css[retry.tone === 'ok' ? 'muted' : retry.tone]}
          role="status" aria-live="polite">
          {retry.kind === 'checking' ? <><span className={css.spinner} aria-hidden />{t('retry.checking')}</> : retry.text}
        </p>
      )}
    </li>
  )
}

function RenameDialog({ account, operations, t, onClose }: {
  readonly account: AccountView
  readonly operations: AccountsOperations
  readonly t: T
  readonly onClose: () => void
}): ReactNode {
  const [alias, setAlias] = useState(account.alias ?? '')
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string>()
  const save = (): void => {
    const trimmed = alias.trim()
    setSaving(true)
    void operations.updateAccount(account.provider, account.id, { alias: trimmed === '' ? null : trimmed })
      .then((outcome) => { if (outcome.ok) onClose(); else setError(refusalText(outcome, t)) })
      .finally(() => { setSaving(false) })
  }
  return (
    <Modal open title={t('rename.title')} closeLabel={t('close')} onClose={onClose}
      footer={<>
        <Button variant="ghost" onClick={onClose}>{t('cancel')}</Button>
        <Button variant="primary" disabled={saving} onClick={save}>{t('save')}</Button>
      </>}>
      <form className={css.dialogBody} onSubmit={(event) => { event.preventDefault(); save() }}>
        <label className={css.field}>
          <span>{t('rename.label')}</span>
          <Input value={alias} maxLength={80} placeholder={account.label} data-modal-autofocus
            onChange={(event) => { setAlias(event.target.value) }} />
        </label>
        {error === undefined ? null : <p className={css.error} role="alert">{error}</p>}
      </form>
    </Modal>
  )
}
