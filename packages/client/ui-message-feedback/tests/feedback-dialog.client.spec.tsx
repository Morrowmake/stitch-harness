// @vitest-environment jsdom
/**
 * FeedbackDialog rendering: the modal shows the seven category chips, the
 * detail box, and the local-only hint while a target is open; a chip toggles
 * the category through the injected verb; Save note routes to the controller,
 * stays enabled with an empty draft, and says nothing is sent; a failure code
 * renders a warning toast; and the acknowledgement toast mounts from the toast
 * sequence and retires through dismissToast once its fade completes. The
 * GitHub issue preview names the public repository, renders the body as
 * formatted text with an explicit Edit text toggle, keeps the Session id
 * opt-in off, and opens the browser page or files with the GitHub account
 * only through their own buttons.
 */
import { useSyncExternalStore } from 'react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { act, cleanup, fireEvent, render } from '@testing-library/react'
import { makeTranslate } from '@deepseek-ai/dsh-client-test-runtime'
import { zh as commonZh } from '@deepseek-ai/dsh-client-locale/src/locales/zh.ts'
import { en as commonEn } from '@deepseek-ai/dsh-client-locale/src/locales/en.ts'
import { FEEDBACK_CATEGORIES } from '@deepseek-ai/dsh-command-feedback'
import { FeedbackDialog } from '../src/client/FeedbackDialog.tsx'
import type { FeedbackDialogState, FeedbackIssuePreview } from '../src/client/dialog.ts'
import * as dictionaries from '../src/client/locales.ts'
import { en, zh } from '../src/client/locales.ts'

afterEach(cleanup)

const t = makeTranslate(zh, commonZh)
const tEn = makeTranslate(en, commonEn)
const REPOSITORY = 'Morrowmake/stitch-harness'

/** One preview as the controller holds it. */
function preview(overrides: Partial<FeedbackIssuePreview> = {}): FeedbackIssuePreview {
  return {
    title: 'slow',
    body: 'Replies are slow.\n\nDetails:\n\n- Category: none\n- Stitch version: 1.2.3',
    repository: REPOSITORY,
    includeSessionId: false,
    recorded: false,
    via: null,
    ...overrides,
  }
}

/** Render the entry over a fixed state and recording verbs. */
function mount(overrides: Partial<FeedbackDialogState> = {}, translate = t) {
  const state: FeedbackDialogState = {
    target: { kind: 'session' }, category: null, text: '', report: null, submitting: false, failure: null,
    toast: 0, notice: 'recorded',
    ...overrides,
  }
  const verbs = {
    edit: vi.fn(),
    submit: vi.fn(() => Promise.resolve()),
    previewReport: vi.fn(() => Promise.resolve()),
    editReport: vi.fn(),
    includeSessionId: vi.fn(),
    closeReport: vi.fn(),
    confirmReport: vi.fn(() => Promise.resolve()),
    dismiss: vi.fn(),
    dismissFailure: vi.fn(),
    dismissToast: vi.fn(),
  }
  const useDialog = (<T,>(select: (v: FeedbackDialogState) => T): T =>
    useSyncExternalStore(() => () => {}, () => select(state))) as never
  const props = { useDialog, ...verbs, t: translate } as Parameters<typeof FeedbackDialog>[0]
  return { ...render(<FeedbackDialog {...props} />), ...verbs }
}

describe('FeedbackDialog', () => {
  it('says the note stays on this computer and the GitHub issue is public, in every locale', () => {
    expect(en['dialog.title']).toBe('Leave feedback')
    expect(en['dialog.hint']).toBe('Describe what happened. This note is saved on this computer with this chat. Nothing is sent.')
    expect(en['dialog.save']).toBe('Save note')
    expect(en['toast.recorded']).toBe('Note saved on this computer. Use Report on GitHub to tell the Stitch team.')
    expect(tEn('report.hint', { repository: REPOSITORY })).toBe(
      'This creates a public issue on github.com/Morrowmake/stitch-harness that anyone can read. Nothing is sent until you choose an option below.',
    )
    for (const [locale, dict] of Object.entries(dictionaries)) {
      if (typeof dict !== 'object') continue
      expect(dict['report.hint'], locale).toContain('github.com/{repository}')
      expect(dict['report.hint'], locale).not.toContain('Morrowmake')
    }
    expect(zh['category.service-stability']).toBe('稳定性和速度')
    expect(en['category.service-stability']).toBe('Stability and speed')
  })

  it('renders nothing but the probe while closed with no toast', () => {
    const ui = mount({ target: null })

    expect(ui.queryByRole('dialog')).toBeNull()
    expect(ui.queryByRole('alert')).toBeNull()
  })

  it('shows every category, the detail box with the hint, and an enabled Save note that says nothing is sent', () => {
    const ui = mount({}, tEn)

    const dialog = ui.getByRole('dialog', { name: 'Leave feedback' })
    expect(dialog).toBeTruthy()
    const chips = ui.getByRole('group', { name: en['dialog.categories'] }).querySelectorAll('button')
    expect([...chips].map(chip => chip.textContent)).toEqual(
      FEEDBACK_CATEGORIES.map(category => en[`category.${category}`]),
    )
    expect(ui.getByLabelText(en['dialog.detail']).getAttribute('placeholder')).toBe(en['dialog.hint'])
    expect(ui.getByRole('button', { name: 'Save note' }).hasAttribute('disabled')).toBe(false)
    expect(ui.queryByRole('button', { name: commonEn.submit })).toBeNull()
    expect(ui.getByText('Saved on this computer only. Nothing is sent. To tell the Stitch team, use Report on GitHub.')).toBeTruthy()
    expect(dialog.textContent).not.toMatch(/conversation log|help us improve/iu)
  })

  it('selects a chip, and clears it when the selected chip is clicked again', () => {
    const ui = mount({ category: 'task-result' })

    const chips = ui.getByRole('group', { name: zh['dialog.categories'] }).querySelectorAll('button')
    expect(chips[0]?.getAttribute('aria-pressed')).toBe('true')
    expect(chips[1]?.getAttribute('aria-pressed')).toBe('false')

    fireEvent.click(chips[1]!)
    expect(ui.edit).toHaveBeenLastCalledWith({ category: 'instruction-following' })
    fireEvent.click(chips[0]!)
    expect(ui.edit).toHaveBeenLastCalledWith({ category: null })
  })

  it('forwards typing, submits, and closes through the injected verbs', () => {
    const ui = mount({ text: 'draft' })

    fireEvent.change(ui.getByLabelText(zh['dialog.detail']), { target: { value: 'draft more' } })
    expect(ui.edit).toHaveBeenCalledWith({ text: 'draft more' })

    fireEvent.click(ui.getByRole('button', { name: zh['dialog.save'] }))
    expect(ui.submit).toHaveBeenCalledTimes(1)

    fireEvent.click(ui.getByRole('button', { name: commonZh.close }))
    expect(ui.dismiss).toHaveBeenCalledTimes(1)
  })

  it('disables Save note and the chips while a save is in flight', () => {
    const ui = mount({ submitting: true })

    expect(ui.getByRole('button', { name: zh['dialog.saving'] }).hasAttribute('disabled')).toBe(true)
    const chips = ui.getByRole('group', { name: zh['dialog.categories'] }).querySelectorAll('button')
    expect([...chips].every(chip => chip.hasAttribute('disabled'))).toBe(true)
  })

  it('renders submission failures as toasts outside the dialog', () => {
    const conflict = mount({ failure: 'version-conflict' })
    const conflictToast = conflict.getByRole('alert')
    expect(conflictToast.textContent).toBe(zh['error.conflict'])
    expect(conflict.getByRole('dialog').contains(conflictToast)).toBe(false)
    cleanup()

    const oversized = mount({ failure: 'note-too-large' })
    expect(oversized.getByRole('alert').textContent).toBe(zh['error.noteTooLarge'])
    cleanup()

    const other = mount({ failure: 'session-not-found' })
    expect(other.getByRole('alert').textContent).toBe(zh['error.generic'])
  })

  it('retires a submission-failure toast after its extended hold', () => {
    vi.useFakeTimers()
    try {
      const ui = mount({ failure: 'version-conflict' })

      act(() => { vi.advanceTimersByTime(7000) })

      expect(ui.dismissFailure).toHaveBeenCalledTimes(1)
    } finally {
      vi.useRealTimers()
    }
  })

  it('retires the toast when the entry unmounts, so a Session switch does not replay it', () => {
    const ui = mount({ target: null, toast: 3 })

    ui.unmount()

    expect(ui.dismissToast).toHaveBeenCalledWith(3)
  })

  it('shows the acknowledgement toast and retires it after the fade', () => {
    vi.useFakeTimers()
    try {
      const ui = mount({ target: null, toast: 3 })

      expect(ui.getByRole('alert').textContent).toBe(zh['toast.recorded'])
      act(() => { vi.advanceTimersByTime(4000) })
      expect(ui.dismissToast).toHaveBeenCalledWith(3)
    } finally {
      vi.useRealTimers()
    }
  })

  it('opens the GitHub preview from the form without submitting', () => {
    const ui = mount({ text: 'slow' })

    fireEvent.click(ui.getByRole('button', { name: zh['report.open'] }))

    expect(ui.previewReport).toHaveBeenCalledTimes(1)
    expect(ui.submit).not.toHaveBeenCalled()
  })

  it('names the public repository and renders the body as formatted text until Edit text', () => {
    const report = preview()
    const ui = mount({ text: 'slow', report }, tEn)

    expect(ui.getByRole('dialog', { name: en['report.title'] })).toBeTruthy()
    expect(ui.getByText(/public issue on github\.com\/Morrowmake\/stitch-harness that anyone can read/u)).toBeTruthy()
    const formatted = ui.getByRole('region', { name: en['report.preview'] })
    expect(formatted.querySelector('p')?.textContent).toBe('Replies are slow.')
    expect([...formatted.querySelectorAll('li')].map(item => item.textContent)).toEqual([
      'Category: none', 'Stitch version: 1.2.3',
    ])
    expect(formatted.textContent).not.toMatch(/(^|\n)- |---|_/u)
    expect(ui.queryByLabelText(en['report.issueBody'])).toBeNull()

    fireEvent.click(ui.getByRole('button', { name: en['report.editText'] }))

    const body = ui.getByLabelText(en['report.issueBody']) as HTMLTextAreaElement
    expect(body.value).toBe(report.body)
    expect(ui.queryByRole('region', { name: en['report.preview'] })).toBeNull()
    fireEvent.change(body, { target: { value: 'edited' } })
    expect(ui.editReport).toHaveBeenCalledWith({ body: 'edited' })
    fireEvent.click(ui.getByRole('button', { name: en['report.showPreview'] }))
    expect(ui.getByRole('region', { name: en['report.preview'] })).toBeTruthy()
  })

  it('edits the title, keeps the Session id opt-in off, and sends only through the chosen button', () => {
    const ui = mount({ text: 'slow', report: preview() })

    const title = ui.getByLabelText(zh['report.issueTitle']) as HTMLInputElement
    expect(title.value).toBe('slow')
    const optIn = ui.getByLabelText(zh['report.includeSessionId']) as HTMLInputElement
    expect(optIn.checked).toBe(false)
    expect(ui.queryByRole('group', { name: zh['dialog.categories'] })).toBeNull()
    expect(ui.getByText(zh['report.fileDirectHint'])).toBeTruthy()

    fireEvent.change(title, { target: { value: 'Slow replies' } })
    expect(ui.editReport).toHaveBeenCalledWith({ title: 'Slow replies' })
    fireEvent.click(optIn)
    expect(ui.includeSessionId).toHaveBeenCalledWith(true)
    expect(ui.confirmReport).not.toHaveBeenCalled()

    fireEvent.click(ui.getByRole('button', { name: zh['report.back'] }))
    expect(ui.closeReport).toHaveBeenCalledTimes(1)
    fireEvent.click(ui.getByRole('button', { name: zh['report.openBrowser'] }))
    expect(ui.confirmReport).toHaveBeenLastCalledWith('browser')
    fireEvent.click(ui.getByRole('button', { name: zh['report.fileDirect'] }))
    expect(ui.confirmReport).toHaveBeenLastCalledWith('github-cli')
    expect(ui.confirmReport).toHaveBeenCalledTimes(2)
    expect(ui.submit).not.toHaveBeenCalled()
  })

  it('shows the busy label only on the button that is sending', () => {
    const ui = mount({ report: preview({ via: 'github-cli' }), submitting: true })

    expect(ui.getByRole('button', { name: zh['report.filing'] }).hasAttribute('disabled')).toBe(true)
    expect(ui.getByRole('button', { name: zh['report.openBrowser'] }).hasAttribute('disabled')).toBe(true)
  })

  it('shows the report failure copy and the filed-issue acknowledgements', () => {
    const report = preview({ recorded: true })
    const failed = mount({ report, failure: 'gateway/internal' })
    expect(failed.getByRole('alert').textContent).toBe(zh['error.report'])
    // A recorded remark has no form to return to, so the footer closes the dialog too.
    expect(failed.getAllByRole('button', { name: commonZh.close })).toHaveLength(2)
    cleanup()

    const created = mount({ target: null, toast: 1, notice: 'issue-created' })
    expect(created.getByRole('alert').textContent).toBe(zh['toast.issueCreated'])
    cleanup()

    const opened = mount({ target: null, toast: 1, notice: 'issue-opened' })
    expect(opened.getByRole('alert').textContent).toBe(zh['toast.issueOpened'])
    cleanup()

    const fallback = mount({ target: null, toast: 1, notice: 'issue-fallback' }, tEn)
    expect(fallback.getByRole('alert').textContent).toBe(
      'Could not file with your GitHub account. Finish your report on the GitHub page.',
    )
  })
})
