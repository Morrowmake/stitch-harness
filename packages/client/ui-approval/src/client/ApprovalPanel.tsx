/** Composer adapter for one pending tool-approval waterfall. */
import type { ApprovalComposerProps } from './contract/slots.ts'

/**
 * Render the shared card using the tool approval's decision policy: allow once,
 * allow for the rest of the chat when the asker offers it, or deny.
 * @param props Selector-matched request and standard Slot props.
 * @returns The approval composer takeover.
 */
export function ApprovalPanel(props: ApprovalComposerProps) {
  const approval = props.matched
  const reason = approval.displayReason === undefined ? approval.reason : props.resolveReason(approval.displayReason)
  return props.renderFactorySlot('conversation.approval.card', {
    requestKey: approval.key,
    title: reason ?? props.t('escalation', { toolName: approval.toolName }),
    ...(approval.callId === undefined ? {} : { callId: approval.callId }),
    canAnswer: () => approval.answerable,
    onAllow: () => approval.answer('allowed-once'),
    onReject: () => approval.answer('rejected'),
    ...(approval.grant === undefined ? {} : { onAllowForChat: () => approval.answer('allowed-for-session') }),
  })
}
