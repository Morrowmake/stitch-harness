/** Client-owned observation of the Desktop `stitch` terminal command; inspection and changes stay in Electron. */
import { createSnapshotStore } from '@deepseek-ai/dsh-client-store'
import type { DesktopCommandAction, DesktopCommandBridge, DesktopCommandStatus } from '../types.ts'

/** Last observed registration and whether a status read or action is in flight. */
export interface DesktopCommandSnapshot {
  /** Undefined until the shell answers the first status read. */
  readonly status?: DesktopCommandStatus
  readonly busy: boolean
}

/** Shared by every mounted General view; re-reads the status each time the row mounts. */
export class DesktopCommandSource {
  /** Framework-observed state of the Settings row. */
  readonly store = createSnapshotStore<DesktopCommandSnapshot>({ busy: false })
  private live = true

  /** @param bridge - Isolated Electron API, present only in Desktop. */
  constructor(private readonly bridge: DesktopCommandBridge) {}

  /** Re-read the registration, which the menu or a terminal may have changed. */
  async refresh(): Promise<void> {
    await this.settle(() => this.bridge.status())
  }

  /**
   * Run one action through the shell's native dialogs, then show the observed result.
   * @param action - Button the user pressed.
   */
  async run(action: DesktopCommandAction): Promise<void> {
    await this.settle(() => this.bridge.run(action))
  }

  /** Ignore late IPC responses after the plugin is disposed. */
  dispose(): void { this.live = false }

  private async settle(request: () => Promise<DesktopCommandStatus>): Promise<void> {
    if (!this.live || this.store.getSnapshot().busy) return
    this.patch({ busy: true })
    let status: DesktopCommandStatus
    try { status = await request() } catch (_error) { status = { kind: 'failed' } }
    this.patch({ status, busy: false })
  }

  private patch(next: Partial<DesktopCommandSnapshot>): void {
    if (this.live) this.store.set({ ...this.store.getSnapshot(), ...next })
  }
}
