/** Chat-owned approval detail resolving a correlated Tool call's command or raw arguments. */
import type { PropsLocale, PropsRuntime } from '@deepseek-ai/dsh-client-ui-slots'
import type {} from '@deepseek-ai/dsh-client-ui-approval/client'
import type { ChatNode } from '../contract/chat-nodes.ts'
import type { ChatSnapshot } from '../contract/snapshot.ts'
import css from './ApprovalCommand.module.css'

interface ApprovalToolCall {
  readonly callId: string
  readonly name: string
  readonly argsRaw: string
}

/**
 * Extract the command line from a correlated Tool call: a shell `command`, or the text `terminal_send` types into a terminal.
 * @param call - Tool call name and arguments, when a correlated call exists.
 * @returns command text, or undefined for absent, empty, malformed, or unrelated arguments.
 */
export function commandOf(call: ApprovalToolCall | undefined): string | undefined {
  if (call === undefined) return undefined
  try {
    const args = JSON.parse(call.argsRaw) as Record<string, unknown>
    const command = call.name === 'terminal_send' ? args.text : args.command
    return typeof command === 'string' && command.length > 0 ? command : undefined
  } catch {
    return undefined
  }
}

/**
 * Format a correlated Tool call's arguments for the collapsed approval details.
 * @param argsRaw - streamed argument text of the call.
 * @returns indented JSON, the raw text when it is not JSON, or undefined when the call has no arguments.
 */
export function argumentsOf(argsRaw: string): string | undefined {
  try {
    const args: unknown = JSON.parse(argsRaw)
    if (args === null || (typeof args === 'object' && Object.keys(args).length === 0)) return undefined
    return JSON.stringify(args, null, 2)
  } catch {
    return argsRaw.trim() === '' ? undefined : argsRaw
  }
}

/** The started Tool call node correlated with an approval, when the Chat holds one. */
function startedCall(snapshot: ChatSnapshot, callId: string): ApprovalToolCall | undefined {
  for (const node of snapshot.nodes.values()) {
    const root = node.kind === 'tool-call' ? (node as ChatNode<'tool-call'>).data.root : undefined
    if (root !== undefined && root.callId === callId && !('kind' in root) && root.phase === 'start') return root
  }
  return undefined
}

/**
 * Render the command of the Chat Tool node correlated with an approval, or
 * its raw arguments behind a collapsed Details disclosure when it has no command.
 * @param props - Approval identity, Session-standard Chat selector hook, and approval copy.
 * @returns the command, the details disclosure, or nothing without a started correlated call.
 */
export function ApprovalCommand({ callId, useChat, t }: PropsRuntime<'conversation.approval.detail'> & PropsLocale<'approval'>) {
  const name = useChat(snapshot => startedCall(snapshot, callId)?.name)
  const argsRaw = useChat(snapshot => startedCall(snapshot, callId)?.argsRaw)
  if (name === undefined || argsRaw === undefined) return null
  const command = commandOf({ callId, name, argsRaw })
  if (command !== undefined) return <span className={css.command}>{command}</span>
  const args = argumentsOf(argsRaw)
  if (args === undefined) return null
  return (
    <details className={css.details}>
      <summary>{t('details')}</summary>
      <pre className={css.arguments}>{args}</pre>
    </details>
  )
}
