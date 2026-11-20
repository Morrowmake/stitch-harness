/**
 * Session feedback: the `feedback/record` event, its command-independent
 * producer, the `sessionFeedback` Host Remote a product surface records
 * through, and the human-facing `/feedback` command. Recording appends one
 * authoritative log-only event and does not start model work; the note stays
 * on this computer. The append is eager but unflushed, so acknowledgement
 * reports that the entry is logged, not that it reached disk. The same Remote
 * previews a remark as a public GitHub issue and sends it only the way the
 * human explicitly chooses.
 * @module @deepseek-ai/dsh-command-feedback
 */

import type { Context } from '@deepseek-ai/cordis'
import { brandString } from '@deepseek-ai/dsh-brand'
import type { CommandDefinitionId } from '@deepseek-ai/dsh-commands/types'
import type { CommandInvocation, CommandResult } from '@deepseek-ai/dsh-commands'
import type { Session } from '@deepseek-ai/dsh-session'
import { TypertRemoteService, Remote } from '@deepseek-ai/dsh-typert-protocol'
import {
  draftFeedbackIssue,
  execFileRunner,
  feedbackEnvironment,
  reportFeedbackIssue,
  subprocessRunner,
  type FeedbackSubprocessSeam,
} from './github-issue.ts'
import type {
  FeedbackCategory,
  FeedbackRecord,
  SessionFeedbackIssueDraft,
  SessionFeedbackIssueDraftRequest,
  SessionFeedbackRecordRequest,
  SessionFeedbackRecordResult,
  SessionFeedbackReportIssueRequest,
  SessionFeedbackReportIssueResult,
} from './types.ts'

export type * from './types.ts'
export type {
  FeedbackEnvironment, FeedbackProcessResult, FeedbackProcessRunner, FeedbackSubprocessSeam,
} from './github-issue.ts'

/**
 * Every feedback category in the order product surfaces present them; each
 * surface owns its localized labels.
 */
export const FEEDBACK_CATEGORIES = [
  'task-result',
  'instruction-following',
  'product-interaction',
  'service-stability',
  'resource-cost',
  'security-privacy-permission',
  'other',
] as const satisfies readonly FeedbackCategory[]

export const name = 'command-feedback'
export const inject = ['commands']

const USAGE = 'Type your note after the command, for example: /feedback The answer missed my question.'

declare module '@deepseek-ai/cordis' {
  interface Context {
    sessionFeedback: SessionFeedbackService
  }
}

/**
 * Record feedback independently of any UI trigger. Surrounding whitespace is
 * discarded and a blank text is recorded as absent; an entry with neither
 * text nor category is still recorded.
 * @param session - session the feedback describes.
 * @param entry - human-authored remark and its category.
 */
export function recordFeedback(session: Session, entry: FeedbackRecord): void {
  const text = entry.text?.trim() ?? ''
  session.append('feedback/record', {
    ...(text.length === 0 ? {} : { text }),
    ...(entry.category === undefined ? {} : { category: entry.category }),
  })
}

/**
 * Validate, record, and acknowledge one feedback entry. Returning an error
 * leaves no `feedback/record` event.
 * @param invocation - receiving agent, raw command input, and UI cancellation.
 * @returns an acknowledgement that the note stays on this computer, or a
 * usage error when no feedback text was supplied.
 */
function executeFeedbackCommand(invocation: CommandInvocation): CommandResult {
  if (invocation.rawInput.trim().length === 0) {
    return { kind: 'error', text: `The note is empty. ${USAGE}` }
  }
  recordFeedback(invocation.agent.session, { text: invocation.rawInput })
  return { kind: 'success', text: 'Note saved on this computer. Nothing was sent.' }
}

/**
 * Host Remote through which a product surface records a Session-level remark
 * and, after the human confirms a preview, reports it as a GitHub issue.
 */
export class SessionFeedbackService extends TypertRemoteService {
  static inject = ['sessions']

  /**
   * @param ctx - Host context carrying the live Session store.
   */
  constructor(ctx: Context) {
    super(ctx, 'sessionFeedback')
  }

  /**
   * Record one remark on a live Session.
   * @param request - target Session plus the optional text and category.
   * @returns the recorded postcondition, or `session-not-found` when no live
   * Session carries the id.
   */
  @Remote('record')
  record(request: SessionFeedbackRecordRequest): Promise<SessionFeedbackRecordResult> {
    const session = this.ctx.sessions.get(request.sessionId)
    if (session === undefined) {
      return Promise.resolve({ ok: false, error: { code: 'session-not-found', sessionId: request.sessionId } })
    }
    recordFeedback(session, request)
    return Promise.resolve({ ok: true, value: { recorded: true } })
  }

  /**
   * Preview a remark as a GitHub issue without sending anything. The body
   * names only the remark, its category, the Stitch version, and the OS.
   * @param request - the remark text and category.
   * @returns an editable title and Markdown body, and the public repository it would be filed on.
   */
  @Remote('draftIssue')
  draftIssue(request: SessionFeedbackIssueDraftRequest): Promise<SessionFeedbackIssueDraft> {
    return Promise.resolve(draftFeedbackIssue(request, feedbackEnvironment()))
  }

  /**
   * Send a confirmed issue to the feedback repository the way the human
   * chose: `browser` answers with the prefilled new-issue page the caller
   * opens and never runs `gh`; `github-cli` files through an installed,
   * authenticated `gh` CLI (run by the Host `subprocess` provider when one is
   * mounted, else by Node without a shell) and falls back to the prefilled page.
   * @param request - the title and body the human confirmed, and the chosen method.
   * @returns `created` with the issue URL, or `browser` with the prefilled page URL.
   */
  @Remote('reportIssue')
  reportIssue(request: SessionFeedbackReportIssueRequest): Promise<SessionFeedbackReportIssueResult> {
    const subprocess = this.ctx.get('subprocess') as FeedbackSubprocessSeam | undefined
    return reportFeedbackIssue(request, subprocess === undefined ? execFileRunner : subprocessRunner(subprocess))
  }
}

/**
 * Register the global `/feedback` command for every composed command adapter
 * and mount the `sessionFeedback` Remote.
 * @param ctx - Host context.
 */
export function apply(ctx: Context): void {
  ctx.plugin(SessionFeedbackService)
  ctx.commands.register({
    definitionId: brandString<CommandDefinitionId>('@deepseek-ai/dsh-command-feedback'),
    name: 'feedback',
    description: 'Save a note about this chat or report a problem',
    input: { hint: '<note>' },
    recordInput: false,
    handler: executeFeedbackCommand,
  })
}
