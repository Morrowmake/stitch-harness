/**
 * Sign-in dialog: starts one Host sign-in attempt, follows it, and renders what the provider flow asks for — links
 * (opened once in a new tab), device codes, and the pending prompt (text, secret, select, or a pasted callback URL).
 * It closes itself when the attempt is authorized or cancelled and shows the failure text otherwise.
 */
import { useEffect, useRef, useState, type ReactNode } from 'react'
import { Button, Input, Modal } from '@deepseek-ai/dsh-client-ui-primitives'
import type { Translate } from '@deepseek-ai/dsh-client-ui-slots'
import type { SignInAttemptView, SignInRequest } from '@deepseek-ai/dsh-api-remotes/client'
import type { LlmAccountsKey } from './locales.ts'
import type { AccountsOperations, Outcome } from './operations.ts'
import css from './accounts.module.css'

const LOOPBACK_HOSTS: Record<string, true> = { '127.0.0.1': true, localhost: true, '[::1]': true }

/**
 * Open a provider page in a new tab when it is HTTPS, or HTTP on a loopback address.
 * @param url - the page a notice links to; other values open nothing.
 * @returns whether the page was opened.
 */
export function openProviderPage(url: string): boolean {
  if (!URL.canParse(url)) return false
  const parsed = new URL(url)
  if (parsed.protocol !== 'https:' && !(parsed.protocol === 'http:' && LOOPBACK_HOSTS[parsed.hostname] === true)) return false
  window.open(url, '_blank', 'noopener,noreferrer')
  return true
}

/**
 * The text of a refused call.
 * @param outcome - a refused outcome.
 * @param t - the translator.
 * @returns display text.
 */
export function refusalText(outcome: Extract<Outcome<unknown>, { ok: false }>, t: Translate<LlmAccountsKey>): string {
  if (outcome.reason === 'busy') return t('signin.busy')
  if (outcome.reason === 'invalid-key') return t('apikey.invalid')
  if (outcome.reason === 'key-rejected') return t('apikey.rejected')
  return t('action.failed', { message: outcome.message })
}

/** Props of {@link SignInDialog}. */
export interface SignInDialogProps {
  readonly provider: string
  readonly displayName: string
  readonly request: SignInRequest
  readonly operations: AccountsOperations
  readonly t: Translate<LlmAccountsKey>
  readonly onClose: () => void
}

/**
 * Run one sign-in attempt in a dialog.
 * @param props - provider, request, operations, translator, and the close callback.
 * @returns the dialog.
 */
export function SignInDialog({ provider, displayName, request, operations, t, onClose }: SignInDialogProps): ReactNode {
  const [attempt, setAttempt] = useState<SignInAttemptView>()
  const [error, setError] = useState<string>()
  const [answer, setAnswer] = useState('')
  const [answering, setAnswering] = useState(false)
  const opened = useRef(new Set<string>())
  const attemptRef = useRef<SignInAttemptView>()
  const closeRef = useRef(onClose)
  closeRef.current = onClose

  useEffect(() => {
    const abort = new AbortController()
    // A function, not the property, so re-checks after awaits are not narrowed away.
    const isAborted = (): boolean => abort.signal.aborted
    const follow = async (): Promise<void> => {
      const begun = await operations.beginSignIn(provider, request)
      if (abort.signal.aborted) {
        if (begun.ok) void operations.cancelSignIn(begun.value.id)
        return
      }
      if (!begun.ok) { setError(refusalText(begun, t)); return }
      let view = begun.value
      const show = (next: SignInAttemptView): void => {
        attemptRef.current = next
        setAttempt(next)
        for (const notice of next.notices) {
          if (notice.url !== undefined && !opened.current.has(notice.url)) {
            opened.current.add(notice.url)
            openProviderPage(notice.url)
          }
        }
        if (next.phase === 'authorized' || next.phase === 'cancelled') closeRef.current()
        else if (next.phase === 'failed') setError(t('signin.failed', { message: next.error ?? '' }))
      }
      show(view)
      if (view.phase !== 'running') return
      for await (view of operations.watchSignIn(view.id, abort.signal)) {
        if (isAborted()) return
        show(view)
        if (view.phase !== 'running') return
      }
    }
    follow().catch((cause: unknown) => {
      if (!abort.signal.aborted) setError(t('action.failed', { message: cause instanceof Error ? cause.message : String(cause) }))
    })
    return () => {
      abort.abort()
      const current = attemptRef.current
      if (current?.phase === 'running') void operations.cancelSignIn(current.id)
    }
    // One attempt per mounted dialog: the request is fixed when the dialog opens.
  }, [])

  const prompt = attempt?.phase === 'running' ? attempt.prompt : undefined
  const promptId = prompt?.id
  useEffect(() => { setAnswer('') }, [promptId])

  const reply = (value: { value: string } | { declined: true }): void => {
    if (attempt === undefined || prompt === undefined) return
    setAnswering(true)
    void operations.answerSignInPrompt(attempt.id, prompt.id, value)
      .then((outcome) => { if (!outcome.ok) setError(refusalText(outcome, t)) })
      .finally(() => { setAnswering(false) })
  }

  const title = request.method === 'oauth' ? t('signin.title', { provider: displayName }) : t('signin.apiKeyTitle', { provider: displayName })
  return (
    <Modal open title={title} closeLabel={t('close')} onClose={onClose}
      footer={<Button variant="ghost" onClick={onClose}>{t('cancel')}</Button>}>
      <div className={css.dialogBody} data-llm-signin={attempt?.phase ?? 'starting'}>
        {(attempt?.notices ?? []).map((notice, index) => (
          <div key={index} className={css.notice}>
            <p className={css.noticeText}>{notice.message}</p>
            {notice.code === undefined ? null : (
              <div className={css.codeRow}>
                <code className={css.code} data-llm-signin-code>{notice.code}</code>
                <Button variant="outline" size="sm" onClick={() => { void navigator.clipboard.writeText(notice.code ?? '') }}>
                  {t('signin.copyCode')}
                </Button>
              </div>
            )}
            {notice.url === undefined ? null : (
              <Button variant="outline" size="sm" onClick={() => { if (notice.url !== undefined) openProviderPage(notice.url) }}>
                {t('signin.openLink')}
              </Button>
            )}
          </div>
        ))}
        {prompt === undefined ? null : (
          <form className={css.prompt} onSubmit={(event) => { event.preventDefault(); reply({ value: answer }) }}>
            <label className={css.field}>
              <span>{prompt.message}</span>
              {prompt.kind === 'select'
                ? (
                  <select className={css.select} value={answer} onChange={(event) => { setAnswer(event.target.value) }}>
                    <option value="" disabled>—</option>
                    {prompt.options.map(option => <option key={option.id} value={option.id}>{option.label}</option>)}
                  </select>
                )
                : (
                  <Input type={prompt.kind === 'secret' ? 'password' : 'text'} autoComplete={prompt.kind === 'secret' ? 'new-password' : 'off'}
                    placeholder={prompt.placeholder} value={answer} onChange={(event) => { setAnswer(event.target.value) }} />
                )}
            </label>
            <div className={css.promptActions}>
              <Button type="button" variant="ghost" size="sm" disabled={answering} onClick={() => { reply({ declined: true }) }}>
                {t('signin.decline')}
              </Button>
              <Button type="submit" variant="primary" size="sm" disabled={answering || answer === ''}>{t('signin.submit')}</Button>
            </div>
          </form>
        )}
        {error === undefined && attempt?.phase !== 'failed' && prompt === undefined
          ? <p className={css.muted}>{t('signin.waiting')}</p>
          : null}
        {error === undefined ? null : <p className={css.error} role="alert">{error}</p>}
      </div>
    </Modal>
  )
}
