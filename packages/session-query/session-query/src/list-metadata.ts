/** Session-list metadata projection definition registered by `SessionQueryEngine`. */

import type { SessionEvent } from '@deepseek-ai/dsh-session'
import type { ProjectionDefinition } from '@deepseek-ai/dsh-session-projection'
import { z } from 'zod'
import type { SessionListMetadata } from './types.ts'

const sessionListMetadataSchema: z.ZodType<SessionListMetadata> = z.object({
  blank: z.boolean(),
  lastPromptAt: z.number().nullable(),
})

/**
 * Whether an event starts a conversation: a turn, or a slash command whose
 * outcome the transcript shows (`command/run`, declared by the commands
 * package). A started Session is listed, shown as a conversation, and never
 * reused as a new chat.
 * @param event - one Session event.
 * @returns true for `turn/start` and `command/run`.
 */
export function startsConversation(event: { readonly type: string }): boolean {
  return event.type === 'turn/start' || event.type === 'command/run'
}

/** Advance blankness and human-prompt recency without retaining history. */
function applySessionListMetadata(
  state: SessionListMetadata,
  event: SessionEvent,
): SessionListMetadata {
  const blank = state.blank && !startsConversation(event)
  const lastPromptAt = event.type === 'user/message' && event.data.source.kind === 'user'
    ? event.time
    : state.lastPromptAt
  return blank === state.blank && lastPromptAt === state.lastPromptAt
    ? state
    : { blank, lastPromptAt }
}

/** Blankness and latest human-prompt time folded per Session; persisted at state version 2. */
export const sessionListMetadataDefinition = {
  key: 'sessionListMetadata',
  stateSchema: sessionListMetadataSchema,
  init: () => ({ blank: true, lastPromptAt: null }),
  apply: applySessionListMetadata,
  wire: { viewSchema: sessionListMetadataSchema, view: state => state },
  stateVersion: 2,
} satisfies ProjectionDefinition<'sessionListMetadata', SessionListMetadata>
