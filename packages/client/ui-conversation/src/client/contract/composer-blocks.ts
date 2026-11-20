import type { SnapshotStore } from '@deepseek-ai/dsh-client-store'
import type { SessionId } from '@deepseek-ai/dsh-session/types'

/** The one step that clears a block, offered beside the composer. */
export interface ComposerBlockAction {
  /** Localized button label owned by the plugin that raised the block. */
  readonly label: string
  /** Start the step, for example by opening the model setup. */
  run(): void
}

/** Why one session's composer is inert. */
export interface ComposerBlock {
  /** Localized placeholder owned by the plugin that raised the block. */
  readonly reason: string
  /** Optional step that clears the block; the composer shows it as a button under the reason. */
  readonly action?: ComposerBlockAction
}

/** The registry face other plugins reach through `ctx.conversation.blocks`. */
export interface ComposerBlocks {
  /**
   * Raise or clear this session's block.
   * @param sessionId - Session whose composer is affected.
   * @param block - Block to raise, or undefined to clear it.
   */
  set(sessionId: SessionId, block: ComposerBlock | undefined): void
  /**
   * Resolve the observable block state for one Session.
   * @param sessionId - Session to observe.
   * @returns Identity-stable block store.
   */
  storeFor(sessionId: SessionId): SnapshotStore<ComposerBlock | undefined>
  /**
   * Drop one Session's store.
   * @param sessionId - Session being released.
   */
  forget(sessionId: SessionId): void
}
