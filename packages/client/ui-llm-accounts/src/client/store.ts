/**
 * Reference-counted subscriptions to `llmAccounts.watch`. Each observer key — the settings page (no session) or one
 * Session's badge — owns one snapshot store that outlives its subscription, so a surface that hides and reappears
 * shows the last snapshot at once. The Host fetches usage only while some subscription is open, which is why surfaces
 * acquire on mount (and, for the badge, while the document is visible) and release otherwise.
 */
import type { Context } from '@deepseek-ai/cordis'
import type { RemoteStream } from '@deepseek-ai/dsh-api-gateway/client'
import type { AccountsSnapshot } from '@deepseek-ai/dsh-api-remotes/client'
import { createSnapshotStore, type SnapshotStore } from '@deepseek-ai/dsh-client-store'

/** One observer's view of the Host accounts. */
export interface AccountsState {
  /** The latest snapshot, kept across subscriptions; undefined before the first one arrives. */
  readonly snapshot: AccountsSnapshot | undefined
  /** False after the stream failed or the carrier dropped, until the next snapshot arrives. */
  readonly linked: boolean
}

/** Opens one physical `watch` generation. */
export type OpenWatch = (opts: { usage: boolean; sessionId?: string }, signal: AbortSignal) => AsyncIterable<AccountsSnapshot>

interface Entry {
  readonly store: SnapshotStore<AccountsState>
  refs: number
  stream: RemoteStream<AccountsSnapshot> | undefined
}

/** The page-wide owner of every accounts subscription. */
export class AccountsWatcher {
  private readonly entries = new Map<string, Entry>()
  private disposed = false

  /**
   * @param ctx - the plugin context carrying `remote.$stream`.
   * @param open - the `llmAccounts.watch` binding.
   */
  constructor(private readonly ctx: Context, private readonly open: OpenWatch) {}

  /**
   * The store one observer reads; created on first use and kept for the plugin lifetime.
   * @param sessionId - the observed Session, or undefined for the settings page.
   * @returns the observer's store.
   */
  view(sessionId?: string): SnapshotStore<AccountsState> {
    return this.entry(sessionId).store
  }

  /**
   * Hold a usage subscription for one observer; the stream opens on the first hold and closes after the last release.
   * @param sessionId - the observed Session, or undefined for the settings page.
   * @returns the release callback (idempotent).
   */
  acquire(sessionId?: string): () => void {
    const entry = this.entry(sessionId)
    entry.refs += 1
    if (entry.refs === 1 && !this.disposed) this.start(entry, sessionId)
    let released = false
    return () => {
      if (released) return
      released = true
      entry.refs -= 1
      if (entry.refs > 0) return
      const stream = entry.stream
      entry.stream = undefined
      void stream?.dispose()
    }
  }

  /** Close every stream; stores keep their last snapshot. */
  async dispose(): Promise<void> {
    this.disposed = true
    const streams = [...this.entries.values()].flatMap(entry => entry.stream === undefined ? [] : [entry.stream])
    for (const entry of this.entries.values()) entry.stream = undefined
    await Promise.all(streams.map(stream => stream.dispose()))
  }

  private entry(sessionId: string | undefined): Entry {
    const key = sessionId ?? ''
    let entry = this.entries.get(key)
    if (entry === undefined) {
      entry = { store: createSnapshotStore<AccountsState>({ snapshot: undefined, linked: true }), refs: 0, stream: undefined }
      this.entries.set(key, entry)
    }
    return entry
  }

  private start(entry: Entry, sessionId: string | undefined): void {
    const opts = sessionId === undefined ? { usage: true } : { usage: true, sessionId }
    const stream = this.ctx.remote.$stream<AccountsSnapshot>({
      name: 'LLM accounts',
      open: signal => this.open(opts, signal),
      ended: () => new Error('LLM accounts stream ended'),
      carrierFailed: () => { entry.store.set({ ...entry.store.getSnapshot(), linked: false }) },
    })
    entry.stream = stream
    void this.observe(entry, stream)
  }

  private async observe(entry: Entry, stream: RemoteStream<AccountsSnapshot>): Promise<void> {
    try {
      for await (const item of stream) {
        if (entry.stream !== stream) return
        entry.store.set({ snapshot: item.value, linked: true })
        item.accept()
      }
    } catch (error) {
      if (entry.stream !== stream) return
      entry.store.set({ ...entry.store.getSnapshot(), linked: false })
      this.ctx.logger.warn('llm accounts stream failed: %s', error)
    }
  }
}
