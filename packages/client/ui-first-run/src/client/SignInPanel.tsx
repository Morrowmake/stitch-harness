/**
 * Inline sign-in for a hosted provider: starts one Host sign-in attempt,
 * follows it, and renders what the provider flow asks for — links (opened once
 * in a new tab), device codes, and the pending prompt. It reports success when
 * the attempt is authorized and cancels a running attempt when it unmounts.
 */
import { useEffect, useRef, useState, type ReactNode } from 'react'
import { Button, Input, StateDot } from '@deepseek-ai/dsh-client-ui-primitives'
import type { Translate } from '@deepseek-ai/dsh-client-ui-slots'
import type { SignInAttemptView, SignInRequest } from '@deepseek-ai/dsh-api-remotes/client'
import { refusalText, thrownText } from './errors.ts'
import type { FirstRunKey } from './locales.ts'
import type { FirstRunOperations } from './operations.ts'
import css from './first-run.module.css'

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

/** Props of {@link SignInPanel}. */
export interface SignInPanelProps {
  readonly provider: string
  readonly request: SignInRequest
  readonly operations: FirstRunOperations
  readonly t: Translate<FirstRunKey>
  /** The attempt was authorized: the provider now has an account. */
  readonly onAuthorized: () => void
  /** The user or the provider ended the attempt without an account. */
  readonly onCancel: () => void
}

/**
 * Run one sign-in attempt inline.
 * @param props - provider, request, operations, translator, and the settle callbacks.
 * @returns the panel.
 */
export function SignInPanel({ provider, request, operations, t, onAuthorized, onCancel }: SignInPanelProps): ReactNode {
  const [attempt, setAttempt] = useState<SignInAttemptView>()
  const [error, setError] = useState<string>()
  const [answer, setAnswer] = useState('')
  const [answering, setAnswering] = useState(false)
  const opened = useRef(new Set<string>())
  const attemptRef = useRef<SignInAttemptView>()
  const settle = useRef({ onAuthorized, onCancel })
  settle.current = { onAuthorized, onCancel }

  useEffect(() => {
    const abort = new AbortController()
    // A function, not the property, so re-checks after awaits are not narrowed away.
    const isAborted = (): boolean => abort.signal.aborted
    const follow = async (): Promise<void> => {
      const begun = await operations.beginSignIn(provider, request)
      if (isAborted()) {
        if (begun.ok) void operations.cancelSignIn(begun.value.id)
        return
      }
      if (!begun.ok) { setError(refusalText(begun, t)); return }
      const show = (next: SignInAttemptView): void => {
        attemptRef.current = next
        setAttempt(next)
        for (const notice of next.notices) {
          if (notice.url !== undefined && !opened.current.has(notice.url)) {
            opened.current.add(notice.url)
            openProviderPage(notice.url)
          }
        }
        if (next.phase === 'authorized') settle.current.onAuthorized()
        else if (next.phase === 'cancelled') settle.current.onCancel()
        else if (next.phase === 'failed') setError(t('signin.failed', { message: next.error ?? '' }))
      }
      let view = begun.value
      show(view)
      if (view.phase !== 'running') return
      for await (view of operations.watchSignIn(view.id, abort.signal)) {
        if (isAborted()) return
        show(view)
        if (view.phase !== 'running') return
      }
    }
    follow().catch((cause: unknown) => {
      if (!isAborted()) setError(thrownText(cause, t))
    })
    return () => {
      abort.abort()
      const current = attemptRef.current
      if (current?.phase === 'running') void operations.cancelSignIn(current.id)
    }
    // One attempt per mounted panel: the request is fixed when the panel opens.
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

  return (
    <div className={css.form} data-first-run-signin={attempt?.phase ?? 'starting'}>
      {(attempt?.notices ?? []).map((notice, index) => (
        <div key={index} className={css.form}>
          <p className={css.intro}>{notice.message}</p>
          {notice.code === undefined ? null : (
            <div className={css.rowHead}>
              <code className={css.code}>{notice.code}</code>
              <Button variant="outline" size="sm" onClick={() => { void navigator.clipboard.writeText(notice.code ?? '') }}>
                {t('signin.copyCode')}
              </Button>
            </div>
          )}
          {notice.url === undefined ? null : (
            <div className={css.rowHead}>
              <Button variant="outline" size="sm" onClick={() => { if (notice.url !== undefined) openProviderPage(notice.url) }}>
                {t('signin.openLink')}
              </Button>
            </div>
          )}
        </div>
      ))}
      {prompt === undefined ? null : (
        <form className={css.form} onSubmit={(event) => { event.preventDefault(); reply({ value: answer }) }}>
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
          <div className={css.formActions}>
            <Button type="button" variant="ghost" size="sm" disabled={answering} onClick={() => { reply({ declined: true }) }}>
              {t('signin.decline')}
            </Button>
            <Button type="submit" variant="primary" size="sm" disabled={answering || answer === ''}>{t('signin.submit')}</Button>
          </div>
        </form>
      )}
      {error === undefined && prompt === undefined
        ? <p className={css.muted}><StateDot state="ongoing" /> {t('signin.waiting')}</p>
        : null}
      {error === undefined ? null : <p className={css.error} role="alert">{error}</p>}
      <div className={css.formActions}>
        <Button variant="ghost" size="sm" onClick={onCancel}>{t('cancel')}</Button>
      </div>
    </div>
  )
}
