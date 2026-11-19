/**
 * The injected faces of this package's two entries. The
 * 'conversation.chat.assistant-actions' and 'conversation.input.overlay'
 * slots are declared and typed by ui-chat and ui-conversation; this package
 * only contributes entries, so no SlotMap merge lives here. Live state
 * arrives through the `hooks` compartment (the framework standard kit binds
 * `feedback` into `useFeedback` and `dialog` into `useDialog`).
 * @module @deepseek-ai/dsh-client-ui-message-feedback/client/slots
 */

import type {
  HostObservable, InjectFace, PropsLocale, PropsRuntime,
} from '@deepseek-ai/dsh-client-ui-slots'
import type {} from '@deepseek-ai/dsh-client-ui-conversation/client'
import type { MessageId } from '@deepseek-ai/dsh-api-remotes/client'
import type { MessageFeedbackItem, MessageFeedbackRating } from '@deepseek-ai/dsh-message-feedback/types'
// Type-only: pulls this package's LocaleNamespaceMap merge (the 'feedback' seat).
import type {} from './locales.ts'
import type { MessageFeedbackActionResult, MessageFeedbackView } from './controller.ts'
import type { FeedbackDialogState, FeedbackIssuePreview } from './dialog.ts'

/** Injected business face of one assistant-message feedback entry. */
export interface MessageFeedbackInjected {
  hooks: {
    /** The owning Session's feedback view, shared by every message control. */
    feedback: HostObservable<MessageFeedbackView>
  }
  /** Load the Session's feedback once, on first interaction. */
  ensure: () => Promise<MessageFeedbackActionResult>
  /**
   * The committed item as this Session's controller last observed it.
   * @param messageId - target assistant message.
   */
  current: (messageId: MessageId) => MessageFeedbackItem | undefined
  /**
   * Retract the requested judgment only while the committed rating still
   * matches; a concurrent change makes the serialized operation a no-op.
   * @param messageId - target assistant message.
   * @param rating - judgment the human asked to retract.
   */
  retract: (messageId: MessageId, rating: MessageFeedbackRating) => Promise<MessageFeedbackActionResult>
  /**
   * Open the Session's feedback dialog for one message and judgment; its
   * submission records that rating with the dialog's category and text.
   * @param messageId - target assistant message.
   * @param rating - judgment to record on submission.
   */
  openDialog: (messageId: MessageId, rating: MessageFeedbackRating) => void
}

/** Full props of one assistant-message feedback entry. */
export type MessageFeedbackActionProps =
  PropsRuntime<'conversation.chat.assistant-actions'>
  & InjectFace<MessageFeedbackInjected>
  & PropsLocale<'feedback'>

/** Injected business face of the Session's feedback dialog entry. */
export interface FeedbackDialogInjected {
  hooks: {
    /** The Session's dialog and toast state. */
    dialog: HostObservable<FeedbackDialogState>
  }
  /**
   * Replace part of the draft: the category (null clears it) or the text.
   * @param draft - the members to replace.
   */
  edit: (draft: Partial<Pick<FeedbackDialogState, 'category' | 'text'>>) => void
  /** Submit the draft to the open target. */
  submit: () => Promise<void>
  /** Show the editable GitHub issue preview of the draft; sends nothing. */
  previewReport: () => Promise<void>
  /**
   * Replace the previewed title or body.
   * @param draft - the members to replace.
   */
  editReport: (draft: Partial<Pick<FeedbackIssuePreview, 'title' | 'body'>>) => void
  /**
   * Add or remove the Session id line in the previewed body.
   * @param include - whether the body names the Session.
   */
  includeSessionId: (include: boolean) => void
  /** Leave the preview: back to the form, or closed for an already recorded remark. */
  closeReport: () => void
  /** File the previewed issue and open its GitHub page. */
  confirmReport: () => Promise<void>
  /** Close the dialog and discard the draft. */
  dismiss: () => void
  /** Retire the current submission-failure toast without closing its draft. */
  dismissFailure: () => void
  /**
   * Retire the toast the view finished showing.
   * @param seq - the toast sequence.
   */
  dismissToast: (seq: number) => void
}

/** Full props of the feedback dialog overlay entry. */
export type FeedbackDialogProps =
  InjectFace<FeedbackDialogInjected>
  & PropsLocale<'feedback'>
