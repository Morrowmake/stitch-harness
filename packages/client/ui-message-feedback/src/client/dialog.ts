/**
 * Headless state of one Session's feedback dialog and its acknowledgement and
 * failure toasts. One form serves two targets: the Session itself (a bare `/feedback`)
 * and one assistant message (Like or Dislike); saving it keeps a note on this
 * computer and sends nothing. From the form, or after a typed
 * `/feedback <text>`, the dialog switches to a GitHub issue preview that is
 * sent only when the human picks a method: the prefilled page in the browser,
 * or, only on that explicit choice, filing with their GitHub account.
 * @module @deepseek-ai/dsh-client-ui-message-feedback/client/dialog
 */

import { createSnapshotStore, type SnapshotStore } from '@deepseek-ai/dsh-client-store'
import type { MessageId } from '@deepseek-ai/dsh-api-remotes/client'
import type {
  FeedbackCategory, FeedbackRecord, SessionFeedbackIssue, SessionFeedbackIssueDraft,
  SessionFeedbackReportIssueMethod, SessionFeedbackReportIssueResult,
} from '@deepseek-ai/dsh-command-feedback/types'
import type { MessageFeedbackRating } from '@deepseek-ai/dsh-message-feedback/types'
import type { MessageFeedbackActionFailure, MessageFeedbackActionResult } from './controller.ts'

/** What one open dialog submits to. */
export type FeedbackDialogTarget =
  | { readonly kind: 'session' }
  | { readonly kind: 'message'; readonly messageId: MessageId; readonly rating: MessageFeedbackRating }

/** The editable GitHub issue preview; nothing leaves the Host until the human picks a method. */
export interface FeedbackIssuePreview {
  readonly title: string
  readonly body: string
  /** `owner/name` of the public repository the Host files on. */
  readonly repository: string
  /** The body carries the Session id line; off unless the human ticks it. */
  readonly includeSessionId: boolean
  /** The remark is already in the Session log, so confirming files the issue only. */
  readonly recorded: boolean
  /** The method of the report in flight or last tried; null before the first choice. */
  readonly via: SessionFeedbackReportIssueMethod | null
}

/**
 * Which acknowledgement the success toast shows; `issue-fallback` is a
 * prefilled page opened because filing with the GitHub account did not work.
 */
export type FeedbackNotice = 'recorded' | 'issue-created' | 'issue-opened' | 'issue-fallback'

/** Dialog and toast state the overlay view renders from. */
export interface FeedbackDialogState {
  /** Target the dialog is open for; null while closed. */
  readonly target: FeedbackDialogTarget | null
  readonly category: FeedbackCategory | null
  readonly text: string
  /** The issue preview while the dialog shows it; null while it shows the form. */
  readonly report: FeedbackIssuePreview | null
  /** A submission is in flight; the form ignores edits and submits until it settles. */
  readonly submitting: boolean
  /** Failure code of the last submission from this open; null when none. */
  readonly failure: string | null
  /** Sequence of the acknowledgement toast on screen; 0 while none. */
  readonly toast: number
  /** Copy of the acknowledgement toast on screen. */
  readonly notice: FeedbackNotice
}

/**
 * Record one submission against its target.
 * @param target - the open target.
 * @param entry - the trimmed text and the category, each present only when given.
 */
export type FeedbackSubmit = (target: FeedbackDialogTarget, entry: FeedbackRecord) => Promise<MessageFeedbackActionResult>

/** A Remote reply carrying a value, or the carried failure. */
export type FeedbackIssueCall<T> = { readonly ok: true; readonly value: T } | MessageFeedbackActionFailure

/** The Host and browser operations behind the GitHub issue preview. */
export interface FeedbackIssueChannel {
  /** Session the dialog belongs to, named in the body only on opt-in. */
  readonly sessionId: string
  /**
   * Build the preview for one remark; sends nothing.
   * @param entry - the trimmed text and the category.
   */
  draft(entry: FeedbackRecord): Promise<FeedbackIssueCall<SessionFeedbackIssueDraft>>
  /**
   * Send the confirmed issue the way the human chose.
   * @param issue - the title and body as the human left them.
   * @param via - `browser` opens the prefilled page only; `github-cli` files with the signed-in `gh`.
   */
  report(issue: SessionFeedbackIssue, via: SessionFeedbackReportIssueMethod): Promise<FeedbackIssueCall<SessionFeedbackReportIssueResult>>
  /**
   * Show a GitHub page in a new browser tab.
   * @param url - the created issue or the prefilled new-issue page.
   */
  open(url: string): void
}

const CLOSED: Omit<FeedbackDialogState, 'toast' | 'notice'> = {
  target: null, category: null, text: '', report: null, submitting: false, failure: null,
}

/**
 * The body line that names the Session when the human opts in.
 * @param sessionId - Session the dialog belongs to.
 * @returns one Markdown list line matching the preview's metadata list.
 */
export function sessionIdLine(sessionId: string): string {
  return `- Session id: ${sessionId}`
}

/** Per-session dialog controller; one instance backs the overlay entry and every message control. */
export class FeedbackDialogController {
  /** Dialog state store (the overlay entry subscribes here). */
  readonly state: SnapshotStore<FeedbackDialogState> = createSnapshotStore<FeedbackDialogState>({
    ...CLOSED, toast: 0, notice: 'recorded',
  })
  /** Bumped by every open, dismiss, and dispose so a late settlement can tell its draft is gone. */
  private generation = 0
  private toastSeq = 0

  /**
   * @param submit - records one submission; the owner routes it by target.
   * @param issues - previews and files GitHub issues for this Session.
   */
  constructor(private readonly submit: FeedbackSubmit, private readonly issues: FeedbackIssueChannel) {}

  /**
   * Open the dialog with an empty draft, replacing any open draft.
   * @param target - what the submission records against.
   */
  open(target: FeedbackDialogTarget): void {
    this.generation += 1
    const { toast, notice } = this.state.getSnapshot()
    this.state.set({ ...CLOSED, target, toast, notice })
  }

  /**
   * Open the issue preview for a remark the Host already recorded (a typed
   * `/feedback <text>`), replacing any open draft. Nothing is filed until
   * {@link confirmReport}.
   * @param text - the recorded remark.
   * @returns after the preview is drafted or its failure is published.
   */
  async openReport(text: string): Promise<void> {
    this.open({ kind: 'session' })
    this.state.set({ ...this.state.getSnapshot(), text })
    await this.draftReport(true)
  }

  /** Close the dialog and discard the draft; a toast on screen stays. */
  dismiss(): void {
    this.generation += 1
    const { toast, notice } = this.state.getSnapshot()
    this.state.set({ ...CLOSED, toast, notice })
  }

  /**
   * Replace part of the draft while it is editable.
   * @param draft - the category (null clears it) or the text as typed.
   */
  edit(draft: Partial<Pick<FeedbackDialogState, 'category' | 'text'>>): void {
    const s = this.state.getSnapshot()
    if (s.target === null || s.submitting || s.report !== null) return
    this.state.set({ ...s, ...draft })
  }

  /**
   * Submit the draft; an empty draft is a valid submission. Success closes the
   * dialog and raises the acknowledgement toast; a failure keeps the dialog
   * open and publishes its code for the failure toast.
   * @returns after the submission settles.
   */
  async submitDraft(): Promise<void> {
    const s = this.state.getSnapshot()
    if (s.target === null || s.submitting || s.report !== null) return
    const generation = this.generation
    this.state.set({ ...s, submitting: true, failure: null })
    const result = await this.submit(s.target, this.entry(s))
    if (result.ok) {
      // The remark is recorded whichever draft is on screen now, so the toast
      // always shows; only the draft that produced it closes.
      if (generation === this.generation) this.dismiss()
      this.acknowledge('recorded')
      return
    }
    this.fail(generation, result.error.code)
  }

  /**
   * Switch from the form to the issue preview of the current draft.
   * @returns after the preview is drafted or its failure is published.
   */
  async previewReport(): Promise<void> {
    await this.draftReport(false)
  }

  /** Return from the preview to the form; a preview of an already recorded remark closes instead. */
  closeReport(): void {
    const s = this.state.getSnapshot()
    if (s.report === null || s.submitting) return
    if (s.report.recorded) this.dismiss()
    else this.state.set({ ...s, report: null, failure: null })
  }

  /**
   * Replace the previewed title or body as the human edits them.
   * @param draft - the members to replace.
   */
  editReport(draft: Partial<Pick<FeedbackIssuePreview, 'title' | 'body'>>): void {
    const s = this.state.getSnapshot()
    if (s.report === null || s.submitting) return
    this.state.set({ ...s, report: { ...s.report, ...draft } })
  }

  /**
   * Add or remove the Session id line in the previewed body.
   * @param include - whether the body names the Session.
   */
  includeSessionId(include: boolean): void {
    const s = this.state.getSnapshot()
    if (s.report === null || s.submitting) return
    const line = sessionIdLine(this.issues.sessionId)
    const without = s.report.body.split('\n').filter(row => row !== line).join('\n')
    const body = include ? `${without.trimEnd()}\n${line}` : without
    this.state.set({ ...s, report: { ...s.report, body, includeSessionId: include } })
  }

  /**
   * Send the previewed issue the chosen way: record the remark first unless
   * it already is, then report it and open the resulting GitHub page. Success
   * closes the dialog; a failure keeps the preview open with its code.
   * @param via - `browser` (the prefilled page; never runs `gh`) or `github-cli` (only on explicit choice).
   * @returns after the report settles.
   */
  async confirmReport(via: SessionFeedbackReportIssueMethod): Promise<void> {
    const s = this.state.getSnapshot()
    if (s.target === null || s.report === null || s.submitting) return
    const generation = this.generation
    this.state.set({ ...s, submitting: true, failure: null, report: { ...s.report, via } })
    if (!s.report.recorded) {
      const recorded = await this.submit(s.target, this.entry(s))
      if (!recorded.ok) {
        this.fail(generation, recorded.error.code)
        return
      }
      // A retry after a failed report must not record the remark twice.
      if (generation === this.generation) {
        const current = this.state.getSnapshot()
        if (current.report !== null) this.state.set({ ...current, report: { ...current.report, recorded: true } })
      }
    }
    const filed = await this.issues.report({ title: s.report.title, body: s.report.body }, via)
    if (!filed.ok) {
      this.fail(generation, filed.error.code)
      return
    }
    this.issues.open(filed.value.url)
    if (generation === this.generation) this.dismiss()
    const notice: FeedbackNotice = filed.value.kind === 'created'
      ? 'issue-created'
      : via === 'github-cli' ? 'issue-fallback' : 'issue-opened'
    this.acknowledge(notice)
  }

  /** Clear the current failure toast without closing its draft. */
  dismissFailure(): void {
    const s = this.state.getSnapshot()
    this.state.set({ ...s, failure: null })
  }

  /**
   * Retire one toast after its fade; a newer toast is left alone.
   * @param seq - the toast sequence the view finished showing.
   */
  dismissToast(seq: number): void {
    const s = this.state.getSnapshot()
    if (s.toast === seq) this.state.set({ ...s, toast: 0 })
  }

  /** Scope-teardown disposer: drop the draft and the toast, orphan in-flight work. */
  dispose(): void {
    this.generation += 1
    this.state.set({ ...CLOSED, toast: 0, notice: 'recorded' })
  }

  /** The trimmed text and the category of one draft, each present only when given. */
  private entry(s: FeedbackDialogState): FeedbackRecord {
    const text = s.text.trim()
    return {
      ...(text.length === 0 ? {} : { text }),
      ...(s.category === null ? {} : { category: s.category }),
    }
  }

  /** Draft the preview of the current form, unless the draft changed meanwhile. */
  private async draftReport(recorded: boolean): Promise<void> {
    const s = this.state.getSnapshot()
    if (s.target === null || s.submitting || s.report !== null) return
    const generation = this.generation
    this.state.set({ ...s, submitting: true, failure: null })
    const drafted = await this.issues.draft(this.entry(s))
    if (!drafted.ok) {
      // A remark the Host already recorded has no form to fall back to.
      if (recorded && generation === this.generation) {
        this.generation += 1
        this.state.set({ ...CLOSED, failure: drafted.error.code, toast: 0, notice: this.state.getSnapshot().notice })
        return
      }
      this.fail(generation, drafted.error.code)
      return
    }
    if (generation !== this.generation) return
    this.state.set({
      ...this.state.getSnapshot(),
      submitting: false,
      report: { ...drafted.value, includeSessionId: false, recorded, via: null },
    })
  }

  /** Publish a failure for the draft that produced it, keeping that draft open. */
  private fail(generation: number, code: string): void {
    if (generation !== this.generation) return
    this.state.set({ ...this.state.getSnapshot(), submitting: false, failure: code, toast: 0 })
  }

  /** Show the acknowledgement toast; a toast already on screen restarts. */
  private acknowledge(notice: FeedbackNotice): void {
    this.toastSeq += 1
    this.state.set({ ...this.state.getSnapshot(), toast: this.toastSeq, notice })
  }
}
