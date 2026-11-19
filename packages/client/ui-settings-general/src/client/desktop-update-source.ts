/** Client-owned observation of the Desktop update-check preference and the last explicit check. */
import { createSnapshotStore } from '@deepseek-ai/dsh-client-store'
import type { DesktopUpdateBridge, DesktopUpdateCheckResult } from '../types.ts'

/** Accepted preference, save feedback, and the outcome of the latest 'Check now'. */
export interface DesktopUpdateSnapshot {
  /** Persisted preference; undefined until the shell answers. */
  readonly enabled?: boolean
  readonly saving: boolean
  readonly saveFailed: boolean
  readonly check: { readonly phase: 'idle' } | { readonly phase: 'checking' }
    | { readonly phase: 'done'; readonly result: DesktopUpdateCheckResult }
}

/** Owns one preload subscription shared by every mounted General view. */
export class DesktopUpdateSource {
  /** Framework-observed state of the Settings row. */
  readonly store = createSnapshotStore<DesktopUpdateSnapshot>({ saving: false, saveFailed: false, check: { phase: 'idle' } })
  private live = true
  private received = false
  private readonly unsubscribe: () => void

  /** @param bridge - Isolated Electron API, present only in Desktop. */
  constructor(private readonly bridge: DesktopUpdateBridge) {
    this.unsubscribe = bridge.subscribe((enabled) => {
      if (!this.live) return
      this.received = true
      this.patch({ enabled })
    })
    void bridge.getPreference().then((enabled) => {
      if (!this.received) this.patch({ enabled })
    }, () => {
      // The toggle stays unavailable until the shell reports a value.
    })
  }

  /**
   * Persist an explicit choice; the shell checks immediately when it is turned on.
   * @param enabled - New preference.
   * @returns After the shell confirms or rejects the save.
   */
  async setEnabled(enabled: boolean): Promise<void> {
    if (!this.live || this.store.getSnapshot().saving) return
    this.patch({ saving: true, saveFailed: false })
    try {
      const accepted = await this.bridge.setPreference(enabled)
      this.patch({ enabled: accepted, saving: false })
    } catch (_error) {
      this.patch({ saving: false, saveFailed: true })
    }
  }

  /** Run one check now, regardless of the preference, and keep its result for display. */
  async check(): Promise<void> {
    if (!this.live || this.store.getSnapshot().check.phase === 'checking') return
    this.patch({ check: { phase: 'checking' } })
    let result: DesktopUpdateCheckResult
    try { result = await this.bridge.check() } catch (_error) { result = { kind: 'failed' } }
    this.patch({ check: { phase: 'done', result } })
  }

  /** Detach the shell subscription and ignore late IPC responses. */
  dispose(): void { this.live = false; this.unsubscribe() }

  /** Late IPC responses after `dispose` are dropped here. */
  private patch(next: Partial<DesktopUpdateSnapshot>): void {
    if (this.live) this.store.set({ ...this.store.getSnapshot(), ...next })
  }
}
