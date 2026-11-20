/**
 * The feedback dialog and its acknowledgement and failure toasts, rendered as one entry
 * of `conversation.input.overlay` so each Session owns exactly one of each.
 * The Modal and the Toast both portal to `document.body`; the overlay slot
 * only supplies the per-session controller and the composer card the toast
 * centers over. The form saves a note on this computer only; the GitHub
 * preview renders the issue body as formatted text, names the public target
 * repository, and sends only through one of its two explicit actions.
 * @module @deepseek-ai/dsh-client-ui-message-feedback/client/FeedbackDialog
 */

import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import {
  Button, Checkbox, IconWarningOutlineRegular, Input, MarkdownText, Modal, Toast,
} from '@deepseek-ai/dsh-client-ui-primitives'
import type { FeedbackCategory } from '@deepseek-ai/dsh-command-feedback/types'
import type { FeedbackNotice } from './dialog.ts'
import type { FeedbackDialogProps } from './slots.ts'
import css from './FeedbackDialog.module.css'

/**
 * The chips in presentation order. A client bundle may not import a Host
 * package's values, so the taxonomy is restated as a complete record of the
 * `FeedbackCategory` union: a missing or foreign id is a compile error.
 */
const CATEGORY_CHIPS = {
  'task-result': true,
  'instruction-following': true,
  'product-interaction': true,
  'service-stability': true,
  'resource-cost': true,
  'security-privacy-permission': true,
  'other': true,
} satisfies Record<FeedbackCategory, true>
const CATEGORIES = Object.keys(CATEGORY_CHIPS) as FeedbackCategory[]

/** Failure codes with their own copy; every other code reads the generic line. */
const FAILURE_COPY: Partial<Record<string, 'error.conflict' | 'error.noteTooLarge'>> = {
  'version-conflict': 'error.conflict',
  'note-too-large': 'error.noteTooLarge',
}

/** Acknowledgement copy per notice. */
const NOTICE_COPY = {
  'recorded': 'toast.recorded',
  'issue-created': 'toast.issueCreated',
  'issue-opened': 'toast.issueOpened',
  'issue-fallback': 'toast.issueFallback',
} as const satisfies Record<FeedbackNotice, string>

/**
 * Render one Session's feedback dialog and toast.
 * @param props - the dialog hook, the draft and preview verbs, and the locale seat.
 * @returns the modal while a target is open and either toast while it is showing.
 */
export function FeedbackDialog({
  useDialog, edit, submit, previewReport, editReport, includeSessionId, closeReport, confirmReport,
  dismiss, dismissFailure, dismissToast, t,
}: FeedbackDialogProps) {
  const state = useDialog(s => s)
  // The toast centers over the composer card this entry renders inside of.
  const probeRef = useRef<HTMLSpanElement>(null)
  const [card, setCard] = useState<HTMLElement | null>(null)
  useLayoutEffect(() => {
    setCard(probeRef.current?.closest<HTMLElement>('[data-composer-card]') ?? null)
  }, [])
  const toast = state.toast
  const onToastDone = useCallback(() => { dismissToast(toast) }, [dismissToast, toast])
  // A toast retires with the entry that showed it: the Toast's own timer dies
  // on unmount, and the Session's controller must not replay it on return.
  useEffect(() => () => { dismissToast(toast) }, [dismissToast, toast])
  const report = state.report
  const failureCode = state.failure
  const failure = failureCode === null
    ? null
    : t(FAILURE_COPY[failureCode] ?? (report === null ? 'error.generic' : 'error.report'))
  const onFailureDone = useCallback(() => { dismissFailure() }, [dismissFailure])
  // The preview shows formatted text until the human asks to edit the raw body;
  // every new preview starts formatted.
  const [editingBody, setEditingBody] = useState(false)
  const previewing = report !== null
  useEffect(() => { if (!previewing) setEditingBody(false) }, [previewing])
  // MarkdownText memoizes its vocabulary; keep the labels' identity stable.
  const markdownLabels = useMemo(() => ({
    code: {
      copyLabel: t('copy'),
      copiedLabel: t('copied'),
      toolbarLabels: { codeLabel: t('codeBlock.title'), wrapLabel: t('codeBlock.wrap'), unwrapLabel: t('codeBlock.unwrap') },
    },
    footnotes: t('markdown.footnotes'),
  }), [t])

  const form = (
    <>
      <div className={css.categories} role="group" aria-label={t('dialog.categories')}>
        {CATEGORIES.map(category => (
          <button
            key={category}
            type="button"
            className={state.category === category ? `${css.chip} ${css.chipActive}` : css.chip}
            aria-pressed={state.category === category}
            disabled={state.submitting}
            onClick={() => { edit({ category: state.category === category ? null : category }) }}
          >
            {t(`category.${category}`)}
          </button>
        ))}
      </div>
      <textarea
        className={css.detail}
        aria-label={t('dialog.detail')}
        placeholder={t('dialog.hint')}
        value={state.text}
        readOnly={state.submitting}
        onChange={(event) => { edit({ text: event.target.value }) }}
      />
    </>
  )
  const formFooter = (
    <div className={css.actions}>
      <Button
        variant="primary"
        className={css.submit}
        disabled={state.submitting}
        onClick={() => { void submit() }}
      >
        {state.submitting ? t('dialog.saving') : t('dialog.save')}
      </Button>
      <p className={css.note}>{t('dialog.localOnly')}</p>
      <Button
        variant="ghost"
        className={css.secondary}
        disabled={state.submitting}
        onClick={() => { void previewReport() }}
      >
        {t('report.open')}
      </Button>
    </div>
  )

  return (
    <>
      <span ref={probeRef} hidden />
      {toast > 0 && failure === null && (
        <Toast
          key={toast}
          text={t(NOTICE_COPY[state.notice])}
          tone="success"
          anchor={card}
          onDone={onToastDone}
        />
      )}
      {failure !== null && (
        <Toast
          key={`failure-${failureCode}`}
          text={failure}
          icon={<IconWarningOutlineRegular />}
          anchor={card}
          holdMs={6000}
          onDone={onFailureDone}
        />
      )}
      <Modal
        open={state.target !== null}
        title={report === null ? t('dialog.title') : t('report.title')}
        closeLabel={t('close')}
        onClose={dismiss}
        className={css.dialog as string}
        footer={report === null ? formFooter : (
          <div className={css.actions}>
            <Button
              variant="primary"
              className={css.submit}
              disabled={state.submitting}
              onClick={() => { void confirmReport('browser') }}
            >
              {state.submitting && report.via === 'browser' ? t('report.opening') : t('report.openBrowser')}
            </Button>
            <Button
              variant="outline"
              className={css.secondary}
              disabled={state.submitting}
              onClick={() => { void confirmReport('github-cli') }}
            >
              {state.submitting && report.via === 'github-cli' ? t('report.filing') : t('report.fileDirect')}
            </Button>
            <p className={css.note}>{t('report.fileDirectHint')}</p>
            <Button
              variant="ghost"
              className={css.secondary}
              disabled={state.submitting}
              onClick={closeReport}
            >
              {report.recorded ? t('close') : t('report.back')}
            </Button>
          </div>
        )}
      >
        {report === null ? form : (
          <div className={css.report}>
            <p className={css.hint}>{t('report.hint', { repository: report.repository })}</p>
            <Input
              aria-label={t('report.issueTitle')}
              value={report.title}
              readOnly={state.submitting}
              onChange={(event) => { editReport({ title: event.target.value }) }}
            />
            {editingBody
              ? (
                <textarea
                  className={`${css.detail} ${css.body}`}
                  aria-label={t('report.issueBody')}
                  value={report.body}
                  readOnly={state.submitting}
                  onChange={(event) => { editReport({ body: event.target.value }) }}
                />
              )
              : (
                <section className={css.preview} aria-label={t('report.preview')}>
                  <MarkdownText text={report.body} labels={markdownLabels} variant="compact" />
                </section>
              )}
            <div className={css.previewControls}>
              <Checkbox
                checked={report.includeSessionId}
                disabled={state.submitting}
                label={t('report.includeSessionId')}
                onChange={includeSessionId}
              />
              <Button
                size="sm"
                disabled={state.submitting}
                onClick={() => { setEditingBody(editing => !editing) }}
              >
                {editingBody ? t('report.showPreview') : t('report.editText')}
              </Button>
            </div>
          </div>
        )}
      </Modal>
    </>
  )
}
