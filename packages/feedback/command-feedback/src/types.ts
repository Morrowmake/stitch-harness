/**
 * Public vocabulary of Session-level feedback: the fixed category taxonomy,
 * the `feedback/record` event payload, the `sessionFeedback.record` Remote
 * request and result types, and the GitHub issue draft and report types.
 * Types only; the runtime category tuple and the repository slug are
 * exported by the package entry, and a browser plugin imports types alone
 * because its bundle may not carry Host values.
 * @module @deepseek-ai/dsh-command-feedback/types
 */

import type { SessionId } from '@deepseek-ai/dsh-session/types'

/** One of the fixed feedback categories; the ids are durable log vocabulary. */
export type FeedbackCategory =
  | 'task-result'
  | 'instruction-following'
  | 'product-interaction'
  | 'service-stability'
  | 'resource-cost'
  | 'security-privacy-permission'
  | 'other'

/**
 * One recorded human remark about a Session. Both members are optional: a
 * submission with neither still records that the human asked for the
 * Session to be reviewed, which is what authorizes log delivery.
 */
export interface FeedbackRecord {
  /** Free-text remark with surrounding whitespace removed; never empty when present. */
  readonly text?: string
  /** Category the human filed the remark under. */
  readonly category?: FeedbackCategory
}

declare module '@deepseek-ai/dsh-session/types' {
  interface SessionEventMap {
    /**
     * One recorded human remark about this session. Log-only and independent
     * of its trigger; it never enters model context or derived history.
     */
    'feedback/record': FeedbackRecord
  }
}

/** Record one Session-level remark through the Host Remote. */
export interface SessionFeedbackRecordRequest {
  /** Live Session the remark describes. */
  readonly sessionId: SessionId
  /** Free-text remark; blank text is recorded as absent. */
  readonly text?: string
  /** Category the human filed the remark under. */
  readonly category?: FeedbackCategory
}

/** Stable postcondition of a recorded remark. */
export interface SessionFeedbackRecordValue {
  /** The remark is appended to the Session log; flushing follows the Session's own schedule. */
  readonly recorded: true
}

/** No live Session carries the requested id. */
export interface SessionFeedbackSessionNotFound {
  readonly code: 'session-not-found'
  readonly sessionId: SessionId
}

/** Result returned by the `sessionFeedback.record` operation. */
export type SessionFeedbackRecordResult =
  | { readonly ok: true; readonly value: SessionFeedbackRecordValue }
  | { readonly ok: false; readonly error: SessionFeedbackSessionNotFound }

/**
 * Ask the Host for an editable GitHub issue preview of one remark. Nothing is
 * sent anywhere; the reply only carries the text the human will review.
 */
export interface SessionFeedbackIssueDraftRequest {
  /** Free-text remark; blank text yields a placeholder line. */
  readonly text?: string
  /** Category the human filed the remark under. */
  readonly category?: FeedbackCategory
}

/** An issue title and Markdown body, as previewed or as confirmed by the human. */
export interface SessionFeedbackIssue {
  /** Issue title; a blank title is replaced by a generic one when filed. */
  readonly title: string
  /** Markdown issue body. */
  readonly body: string
}

/** The editable preview of one remark and the public repository it would be filed on. */
export interface SessionFeedbackIssueDraft extends SessionFeedbackIssue {
  /** `owner/name` of the public GitHub repository a confirmed issue is filed on. */
  readonly repository: string
}

/**
 * How the human chose to send a confirmed issue: `browser` only builds the
 * prefilled new-issue page and never runs `gh`; `github-cli` files through
 * an installed, signed-in `gh` and falls back to the prefilled page.
 */
export type SessionFeedbackReportIssueMethod = 'browser' | 'github-cli'

/** A confirmed issue plus the sending method the human explicitly chose. */
export interface SessionFeedbackReportIssueRequest extends SessionFeedbackIssue {
  readonly via: SessionFeedbackReportIssueMethod
}

/**
 * Where a confirmed issue ended up: `created` when the `gh` CLI filed it,
 * `browser` when the human must finish filing it on a prefilled GitHub page.
 */
export type SessionFeedbackReportIssueResult =
  | { readonly kind: 'created'; readonly url: string }
  | { readonly kind: 'browser'; readonly url: string }
