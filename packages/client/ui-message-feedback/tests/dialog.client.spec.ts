/**
 * FeedbackDialogController: one draft per open, submission routed by target,
 * success closes and acknowledges, failure keeps the draft with its code, a
 * settlement from a superseded open closes nothing, and the toast sequence
 * retires only the toast the view finished showing. The GitHub issue preview
 * is editable, names the Session only on opt-in, records the remark before
 * filing it, sends nothing until the human picks a method, and passes that
 * method through: the browser page by default, the GitHub account only when chosen.
 */
import { describe, expect, it, vi } from 'vitest'
import type { MessageId } from '@deepseek-ai/dsh-api-remotes/client'
import type { MessageFeedbackActionResult } from '../src/client/controller.ts'
import {
  FeedbackDialogController, sessionIdLine, type FeedbackIssueChannel, type FeedbackSubmit,
} from '../src/client/dialog.ts'

const MSG = 'm-1' as MessageId
const MESSAGE_TARGET = { kind: 'message', messageId: MSG, rating: 'positive' } as const
const SESSION = 'session-1'
const DRAFT = {
  title: 'slow',
  body: 'slow\n\nDetails:\n\n- Category: none\n- Stitch version: 1.0.0\n- OS: Linux',
  repository: 'Morrowmake/stitch-harness',
}
const ISSUE_URL = 'https://github.com/Morrowmake/stitch-harness/issues/7'

function bench(
  result: () => Promise<MessageFeedbackActionResult> = () => Promise.resolve({ ok: true }),
  report: FeedbackIssueChannel['report'] = () => Promise.resolve({ ok: true, value: { kind: 'created', url: ISSUE_URL } }),
) {
  const submit = vi.fn<FeedbackSubmit>(() => result())
  const issues = {
    sessionId: SESSION,
    draft: vi.fn<FeedbackIssueChannel['draft']>(() => Promise.resolve({ ok: true, value: DRAFT })),
    report: vi.fn(report),
    open: vi.fn<FeedbackIssueChannel['open']>(),
  }
  return { submit, issues, controller: new FeedbackDialogController(submit, issues) }
}

const CLOSED_STATE = {
  target: null, category: null, text: '', report: null, submitting: false, failure: null, toast: 0, notice: 'recorded',
}

describe('FeedbackDialogController', () => {
  it('starts closed with no toast', () => {
    const { controller } = bench()

    expect(controller.state.getSnapshot()).toEqual(CLOSED_STATE)
  })

  it('opens with an empty draft and drops the draft on dismiss', () => {
    const { controller } = bench()

    controller.open({ kind: 'session' })
    controller.edit({ category: 'task-result' })
    controller.edit({ text: 'slow' })
    expect(controller.state.getSnapshot()).toMatchObject({
      target: { kind: 'session' }, category: 'task-result', text: 'slow',
    })

    controller.dismiss()
    controller.open(MESSAGE_TARGET)
    expect(controller.state.getSnapshot()).toMatchObject({
      target: MESSAGE_TARGET, category: null, text: '',
    })
  })

  it('ignores draft edits and submits while closed', async () => {
    const { controller, submit } = bench()

    controller.edit({ category: 'other' })
    controller.edit({ text: 'x' })
    await controller.submitDraft()

    expect(controller.state.getSnapshot()).toMatchObject({ category: null, text: '', toast: 0 })
    expect(submit).not.toHaveBeenCalled()
  })

  it('submits the Session target with the trimmed text and the category', async () => {
    const { controller, submit } = bench()
    controller.open({ kind: 'session' })
    controller.edit({ category: 'service-stability' })
    controller.edit({ text: '  timed out twice  ' })

    await controller.submitDraft()

    expect(submit).toHaveBeenCalledWith({ kind: 'session' }, { text: 'timed out twice', category: 'service-stability' })
    expect(controller.state.getSnapshot()).toMatchObject({ target: null, toast: 1 })
  })

  it('submits an empty draft as an entry with neither text nor category', async () => {
    const { controller, submit } = bench()
    controller.open({ kind: 'session' })
    controller.edit({ text: '   ' })

    await controller.submitDraft()

    expect(submit).toHaveBeenCalledWith({ kind: 'session' }, {})
  })

  it('submits the message target with the entry', async () => {
    const { controller, submit } = bench()
    controller.open(MESSAGE_TARGET)
    controller.edit({ category: 'task-result' })
    controller.edit({ text: 'wrong file' })

    await controller.submitDraft()

    expect(submit).toHaveBeenCalledWith(MESSAGE_TARGET, { text: 'wrong file', category: 'task-result' })
    expect(controller.state.getSnapshot()).toMatchObject({ target: null, toast: 1 })
  })

  it('keeps the draft open with the failure code when the submission is rejected', async () => {
    const { controller } = bench(() => Promise.resolve({ ok: false, error: { code: 'version-conflict', message: 'changed' } }))
    controller.open(MESSAGE_TARGET)
    controller.edit({ text: 'draft' })

    await controller.submitDraft()

    expect(controller.state.getSnapshot()).toMatchObject({
      target: MESSAGE_TARGET, text: 'draft', submitting: false,
      failure: 'version-conflict', toast: 0,
    })
  })

  it('retires the failure toast without closing its draft', async () => {
    const { controller } = bench(() => Promise.resolve({ ok: false, error: { code: 'version-conflict', message: 'changed' } }))
    controller.open(MESSAGE_TARGET)
    await controller.submitDraft()

    controller.dismissFailure()
    expect(controller.state.getSnapshot().failure).toBeNull()
    expect(controller.state.getSnapshot().target).toEqual(MESSAGE_TARGET)
  })

  it('freezes the draft and refuses a second submit while one is in flight', async () => {
    let release = (): void => {}
    const gate = new Promise<MessageFeedbackActionResult>((resolve) => { release = () => { resolve({ ok: true }) } })
    const { controller, submit } = bench(() => gate)
    controller.open({ kind: 'session' })
    controller.edit({ text: 'first' })

    const first = controller.submitDraft()
    controller.edit({ text: 'second' })
    controller.edit({ category: 'other' })
    await controller.submitDraft()
    expect(controller.state.getSnapshot()).toMatchObject({ submitting: true, text: 'first', category: null })

    release()
    await first
    expect(submit).toHaveBeenCalledTimes(1)
    expect(controller.state.getSnapshot()).toMatchObject({ target: null, toast: 1 })
  })

  it('acknowledges a success that lands after a reopen without closing the new draft', async () => {
    let release = (): void => {}
    const gate = new Promise<MessageFeedbackActionResult>((resolve) => { release = () => { resolve({ ok: true }) } })
    const { controller } = bench(() => gate)
    controller.open({ kind: 'session' })
    const pending = controller.submitDraft()
    controller.open(MESSAGE_TARGET)
    controller.edit({ text: 'new draft' })

    release()
    await pending

    expect(controller.state.getSnapshot()).toMatchObject({
      target: MESSAGE_TARGET, text: 'new draft', toast: 1,
    })
  })

  it('drops a failure that lands after the draft was dismissed', async () => {
    let release = (): void => {}
    const gate = new Promise<MessageFeedbackActionResult>((resolve) => {
      release = () => { resolve({ ok: false, error: { code: 'gateway/internal', message: 'boom' } }) }
    })
    const { controller } = bench(() => gate)
    controller.open({ kind: 'session' })
    const pending = controller.submitDraft()
    controller.dismiss()

    release()
    await pending

    expect(controller.state.getSnapshot()).toMatchObject({ target: null, failure: null, submitting: false, toast: 0 })
  })

  it('retires only the toast the view finished showing', async () => {
    const { controller } = bench()

    controller.open({ kind: 'session' })
    await controller.submitDraft()
    controller.open({ kind: 'session' })
    await controller.submitDraft()
    expect(controller.state.getSnapshot().toast).toBe(2)

    controller.dismissToast(1)
    expect(controller.state.getSnapshot().toast).toBe(2)
    controller.dismissToast(2)
    expect(controller.state.getSnapshot().toast).toBe(0)
  })

  it('keeps a toast on screen across a dismiss and drops everything on dispose', async () => {
    const { controller } = bench()
    controller.open({ kind: 'session' })
    await controller.submitDraft()
    controller.open({ kind: 'session' })

    controller.dismiss()
    expect(controller.state.getSnapshot()).toMatchObject({ target: null, toast: 1 })

    controller.open({ kind: 'session' })
    controller.dispose()
    expect(controller.state.getSnapshot()).toEqual(CLOSED_STATE)
  })
})

describe('FeedbackDialogController GitHub issue preview', () => {
  it('previews the draft without recording or filing anything', async () => {
    const { controller, submit, issues } = bench()
    controller.open({ kind: 'session' })
    controller.edit({ category: 'service-stability' })
    controller.edit({ text: '  slow  ' })

    await controller.previewReport()

    expect(issues.draft).toHaveBeenCalledWith({ text: 'slow', category: 'service-stability' })
    expect(controller.state.getSnapshot()).toMatchObject({
      submitting: false,
      report: { ...DRAFT, includeSessionId: false, recorded: false, via: null },
    })
    expect(submit).not.toHaveBeenCalled()
    expect(issues.report).not.toHaveBeenCalled()
    expect(issues.open).not.toHaveBeenCalled()
  })

  it('lets the human edit the preview and opt the Session id in and out', async () => {
    const { controller } = bench()
    controller.open({ kind: 'session' })
    await controller.previewReport()

    controller.editReport({ title: 'Slow replies', body: 'edited' })
    controller.includeSessionId(true)
    expect(controller.state.getSnapshot().report).toMatchObject({
      title: 'Slow replies', body: `edited\n${sessionIdLine(SESSION)}`, includeSessionId: true,
    })

    controller.includeSessionId(false)
    expect(controller.state.getSnapshot().report).toMatchObject({ body: 'edited', includeSessionId: false })
    expect(controller.state.getSnapshot().report?.body).not.toContain(SESSION)
  })

  it('records, opens the prefilled page for the browser method, and acknowledges', async () => {
    const page = 'https://github.com/Morrowmake/stitch-harness/issues/new?title=Edited+title&body=b'
    const { controller, submit, issues } = bench(undefined, () => Promise.resolve({ ok: true, value: { kind: 'browser', url: page } }))
    controller.open({ kind: 'session' })
    controller.edit({ text: 'slow' })
    await controller.previewReport()
    controller.editReport({ title: 'Edited title' })

    await controller.confirmReport('browser')

    expect(submit).toHaveBeenCalledWith({ kind: 'session' }, { text: 'slow' })
    expect(issues.report).toHaveBeenCalledWith({ title: 'Edited title', body: DRAFT.body }, 'browser')
    expect(issues.open).toHaveBeenCalledWith(page)
    expect(controller.state.getSnapshot()).toMatchObject({ target: null, report: null, toast: 1, notice: 'issue-opened' })
  })

  it('files with the GitHub account only when that method is chosen, and opens the created issue', async () => {
    const { controller, issues } = bench()
    controller.open({ kind: 'session' })
    await controller.previewReport()

    const pending = controller.confirmReport('github-cli')
    expect(controller.state.getSnapshot().report).toMatchObject({ via: 'github-cli' })
    await pending

    expect(issues.report).toHaveBeenCalledWith({ title: DRAFT.title, body: DRAFT.body }, 'github-cli')
    expect(issues.open).toHaveBeenCalledWith(ISSUE_URL)
    expect(controller.state.getSnapshot()).toMatchObject({ target: null, notice: 'issue-created' })
  })

  it('says to finish on GitHub when filing with the account fell back to the prefilled page', async () => {
    const page = 'https://github.com/Morrowmake/stitch-harness/issues/new?title=slow&body=b'
    const { controller, issues } = bench(undefined, () => Promise.resolve({ ok: true, value: { kind: 'browser', url: page } }))
    controller.open({ kind: 'session' })
    await controller.previewReport()

    await controller.confirmReport('github-cli')

    expect(issues.open).toHaveBeenCalledWith(page)
    expect(controller.state.getSnapshot()).toMatchObject({ target: null, notice: 'issue-fallback' })
  })

  it('keeps the preview on a failed report and does not record twice on retry', async () => {
    let fail = true
    const { controller, submit, issues } = bench(undefined, () => Promise.resolve(fail
      ? { ok: false, error: { code: 'gateway/internal', message: 'boom' } }
      : { ok: true, value: { kind: 'created', url: ISSUE_URL } }))
    controller.open({ kind: 'session' })
    await controller.previewReport()

    await controller.confirmReport('github-cli')
    expect(controller.state.getSnapshot()).toMatchObject({
      failure: 'gateway/internal', submitting: false, report: { recorded: true },
    })
    expect(issues.open).not.toHaveBeenCalled()

    fail = false
    await controller.confirmReport('github-cli')
    expect(submit).toHaveBeenCalledTimes(1)
    expect(issues.report).toHaveBeenCalledTimes(2)
    expect(controller.state.getSnapshot()).toMatchObject({ target: null, notice: 'issue-created' })
  })

  it('files nothing when the remark cannot be recorded', async () => {
    const { controller, issues } = bench(() => Promise.resolve({ ok: false, error: { code: 'session-not-found', message: 'gone' } }))
    controller.open({ kind: 'session' })
    await controller.previewReport()

    await controller.confirmReport('browser')

    expect(issues.report).not.toHaveBeenCalled()
    expect(controller.state.getSnapshot()).toMatchObject({ failure: 'session-not-found', report: { recorded: false } })
  })

  it('returns from the preview to the form, keeping the draft', async () => {
    const { controller } = bench()
    controller.open({ kind: 'session' })
    controller.edit({ text: 'slow' })
    await controller.previewReport()

    controller.closeReport()

    expect(controller.state.getSnapshot()).toMatchObject({ target: { kind: 'session' }, text: 'slow', report: null })
  })

  it('previews an already recorded typed remark and files it without recording again', async () => {
    const { controller, submit, issues } = bench()

    await controller.openReport('typed remark')
    expect(issues.draft).toHaveBeenCalledWith({ text: 'typed remark' })
    expect(controller.state.getSnapshot()).toMatchObject({ target: { kind: 'session' }, report: { recorded: true } })

    await controller.confirmReport('browser')
    expect(submit).not.toHaveBeenCalled()
    expect(issues.report).toHaveBeenCalledOnce()
  })

  it('closes a typed remark preview instead of returning to a form that would record it again', async () => {
    const { controller, issues } = bench()
    await controller.openReport('typed remark')

    controller.closeReport()

    expect(controller.state.getSnapshot()).toMatchObject({ target: null, report: null })
    expect(issues.report).not.toHaveBeenCalled()
  })
})
