/** Inject faces of the first-run registrations. */
import type { HostObservable } from '@deepseek-ai/dsh-client-ui-slots'
import type { ConfigFormSnapshot } from '@deepseek-ai/dsh-client-ui-settings/client'
import type { ComponentEntry } from './components.ts'
import type { FlowEntry, FlowState } from './flow.ts'
import type { FirstRunOperations, Outcome } from './operations.ts'

/** The first-run settings section as the overlay reads it. */
export type FirstRunSection = Record<string, unknown>

/** What applying a component selection answered. */
export interface ComponentsApplied {
  /** Whether the Host needs a restart before the change takes effect. */
  readonly restartRequired: boolean
}

/** The Host operations of the component step. */
export interface ComponentOperations {
  /** The optional components with their meta and current state, in picker order. */
  list(): Promise<Outcome<readonly ComponentEntry[]>>
  /** Switch bundles in one profile write and one reload. */
  apply(changes: Readonly<Record<string, boolean>>): Promise<Outcome<ComponentsApplied>>
}

/** Face of the `shell.overlay` entry. */
export interface FirstRunOverlayInjected {
  hooks: {
    /** Which surface an entry point asked for. */
    flow: HostObservable<FlowState>
    /** The stored first-run completion. */
    firstRun: HostObservable<ConfigFormSnapshot<FirstRunSection>>
    /** The section that records the preview notice's acknowledgement. */
    welcome: HostObservable<ConfigFormSnapshot<FirstRunSection>>
  }
  /** Whether this shell shows the preview notice, which the automatic first run waits for. */
  welcomeGate: boolean
  operations: FirstRunOperations
  components: ComponentOperations
  /**
   * Close the open surface. Closing the automatic first run also stores its
   * completion; it stays closed for this page even if that write fails, and
   * then opens again on the next load.
   */
  close: (entry: FlowEntry) => void
}

/** Face of the two entry points: open their part of the flow. */
export interface FirstRunEntryInjected {
  open: () => void
}

/** The `firstRunUi` service: lets other plugins open the provider setup. */
export interface FirstRunUi {
  /** Open the provider step, as Settings → Models "Set up a provider" does. */
  openProvider: () => void
}
