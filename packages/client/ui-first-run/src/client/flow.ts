/**
 * Which first-run surface is open. One snapshot source shared by the overlay
 * and the two entry points that open it (Plugins page, Settings → Models).
 */
import { createSnapshotStore, type SnapshotStore } from '@deepseek-ai/dsh-client-store'

/**
 * How the flow was opened: `first-run` walks every step once per profile;
 * `provider` and `components` open one part on demand.
 */
export type FlowEntry = 'first-run' | 'provider' | 'components'

/** The shared open state. */
export interface FlowState {
  /** The surface the user asked for; `null` while no entry point asked. */
  readonly entry: FlowEntry | null
  /** Whether this page closed the automatic first run, so it does not reopen before its completion is stored. */
  readonly dismissed: boolean
}

/**
 * Create the flow's open-state source.
 * @returns a snapshot store, closed and not dismissed.
 */
export function createFlowStore(): SnapshotStore<FlowState> {
  return createSnapshotStore<FlowState>({ entry: null, dismissed: false })
}

/**
 * The surface to render now.
 * @param flow - the shared open state.
 * @param pending - whether the stored completion is missing or older than this flow.
 * @returns the entry to render, or `null` for none.
 */
export function visibleEntry(flow: FlowState, pending: boolean): FlowEntry | null {
  if (flow.entry !== null) return flow.entry
  return pending && !flow.dismissed ? 'first-run' : null
}
