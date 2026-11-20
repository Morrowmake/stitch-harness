/**
 * Product CLI status for the bundles that run Claude Code or Codex: which executable the bundle will use, and the
 * download, cancellation, and removal of the copy Stitch fetches when a person asks for one. The Host owns every fact;
 * this controller reads `pluginManager.listProductClis()` once a page that shows one opens, again after each action
 * and after every `plugin-manager/changed` event, and folds `plugin-manager/product-cli-state` progress into the
 * download it started. Nothing here downloads on its own: only {@link ProductCliController.download} does.
 */
import { randomUUID } from '@deepseek-ai/dsh-util-crypto'
import type { Context as ClientContext } from '@deepseek-ai/cordis'
import type {
  PluginInstallRequestId, ProductCliId, ProductCliProgress, ProductCliStatus, RemoteErrorDetailsMap, RemoteFailure,
} from '@deepseek-ai/dsh-api-remotes/client'
import { createSnapshotStore, type SnapshotStore } from '@deepseek-ai/dsh-client-store'

/** The bundles that run a product CLI, by package name; their pages show its status. */
export const PRODUCT_CLI_BUNDLES: Readonly<Record<string, ProductCliId>> = {
  '@deepseek-ai/dsh-subagent-claude-code': 'claude-code',
  '@deepseek-ai/dsh-subagent-codex': 'codex',
}

/** Why a download or a removal failed: the Host's download-failed reason, `cancelled` after a cancellation, or `other`. */
export type ProductCliFailure =
  | RemoteErrorDetailsMap['plugin-manager/product-cli-download-failed']['reason']
  | 'cancelled'
  | 'other'

/** The action one product CLI has in flight, or the failure the last one left. */
export type ProductCliTask =
  | {
    readonly kind: 'download'
    readonly requestId: PluginInstallRequestId
    readonly phase: ProductCliProgress['phase']
    readonly receivedBytes: number
    /** Expected bytes; 0 until the Host reports a size. */
    readonly totalBytes: number
    /** A cancellation was asked for and the Host has not settled the download yet. */
    readonly cancelling: boolean
  }
  | { readonly kind: 'remove' }
  | { readonly kind: 'failed'; readonly action: 'download' | 'remove'; readonly failure: ProductCliFailure }

/** What the product CLI sections render. */
export interface ProductCliState {
  /** `idle` until a page asks; `error` keeps the last statuses. */
  readonly status: 'idle' | 'loading' | 'ready' | 'error'
  readonly clis: readonly ProductCliStatus[]
  readonly tasks: Readonly<Partial<Record<ProductCliId, ProductCliTask>>>
}

const IDLE: ProductCliState = { status: 'idle', clis: [], tasks: {} }

function failureOf(failure: RemoteFailure): ProductCliFailure {
  if (failure.code === 'plugin-manager/product-cli-download-failed') return failure.details.reason
  return failure.code === 'plugin-manager/product-cli-download-cancelled' ? 'cancelled' : 'other'
}

/**
 * How far a download got, in whole percent.
 * @param task - the running download.
 * @returns 0–100, or undefined while the Host has not reported a size.
 */
export function downloadPercent(task: Extract<ProductCliTask, { kind: 'download' }>): number | undefined {
  if (task.totalBytes <= 0) return undefined
  return Math.min(100, Math.floor(task.receivedBytes * 100 / task.totalBytes))
}

/** Reads product CLI statuses and runs the downloads and removals a person asks for. */
export class ProductCliController {
  /** Statuses and actions published to the page. */
  readonly store: SnapshotStore<ProductCliState> = createSnapshotStore<ProductCliState>(IDLE)
  private sequence = 0
  private disposed = false

  /**
   * @param ctx - the page plugin's context, whose `remote.pluginManager` namespace answers.
   */
  constructor(private readonly ctx: ClientContext) {}

  /** Read the statuses once a page first shows one. */
  ensure(): void {
    if (this.store.getSnapshot().status === 'idle') void this.load()
  }

  /** Read the statuses again after a Host change, unless no page has asked yet. */
  refresh(): void {
    if (this.store.getSnapshot().status !== 'idle') void this.load()
  }

  /**
   * Read every status; an older read's answer is dropped.
   * @returns once the read settled.
   */
  async load(): Promise<void> {
    const read = ++this.sequence
    const current = this.store.getSnapshot()
    if (current.status !== 'ready') this.patch({ status: 'loading' })
    const answer = await this.ctx.remote.pluginManager.listProductClis()
    if (this.disposed || read !== this.sequence) return
    this.patch(answer.ok ? { status: 'ready', clis: answer.value } : { status: 'error' })
  }

  /**
   * Download a product CLI; only a person's click calls this.
   * @param id - the product CLI to fetch.
   * @returns once the download settled and the statuses were read again.
   */
  async download(id: ProductCliId): Promise<void> {
    const running = this.store.getSnapshot().tasks[id]
    if (running?.kind === 'download' || running?.kind === 'remove') return
    const requestId = randomUUID() as PluginInstallRequestId
    this.setTask(id, { kind: 'download', requestId, phase: 'downloading', receivedBytes: 0, totalBytes: 0, cancelling: false })
    const answer = await this.ctx.remote.pluginManager.downloadProductCli(id, requestId)
    if (this.disposed) return
    if (!answer.ok) {
      this.setTask(id, { kind: 'failed', action: 'download', failure: failureOf(answer.error) })
      return
    }
    this.settle(id, answer.value)
    await this.load()
  }

  /**
   * Fold one Host progress event into the download this page started; other requests are ignored.
   * @param progress - the Host's `plugin-manager/product-cli-state` payload.
   */
  progress(progress: ProductCliProgress): void {
    const task = this.store.getSnapshot().tasks[progress.id]
    if (task?.kind !== 'download' || task.requestId !== progress.requestId) return
    this.setTask(progress.id, {
      ...task, phase: progress.phase, receivedBytes: progress.receivedBytes, totalBytes: progress.totalBytes,
    })
  }

  /**
   * Ask the Host to stop a running download; the download's own answer then reports `cancelled`.
   * @param id - the product CLI whose download stops.
   * @returns once the Host answered.
   */
  async cancel(id: ProductCliId): Promise<void> {
    const task = this.store.getSnapshot().tasks[id]
    if (task?.kind !== 'download' || task.cancelling) return
    this.setTask(id, { ...task, cancelling: true })
    const answer = await this.ctx.remote.pluginManager.cancelProductCliDownload(task.requestId)
    if (this.disposed || (answer.ok && answer.value)) return
    // Nothing stopped: the download finished first or the request was lost, so its own answer settles the task.
    const current = this.store.getSnapshot().tasks[id]
    if (current?.kind === 'download' && current.requestId === task.requestId) this.setTask(id, { ...current, cancelling: false })
  }

  /**
   * Delete the copy Stitch downloaded; a person's own install stays.
   * @param id - the product CLI whose download goes.
   * @returns once the removal settled and the statuses were read again.
   */
  async remove(id: ProductCliId): Promise<void> {
    const running = this.store.getSnapshot().tasks[id]
    if (running?.kind === 'download' || running?.kind === 'remove') return
    this.setTask(id, { kind: 'remove' })
    const answer = await this.ctx.remote.pluginManager.removeProductCli(id)
    if (this.disposed) return
    if (!answer.ok) {
      this.setTask(id, { kind: 'failed', action: 'remove', failure: 'other' })
      return
    }
    this.settle(id, answer.value)
    await this.load()
  }

  /** Stop publishing late settlements. */
  dispose(): void {
    this.disposed = true
  }

  /** Publish the Host's answer for one CLI and clear its task. */
  private settle(id: ProductCliId, status: ProductCliStatus): void {
    const { clis, tasks } = this.store.getSnapshot()
    const { [id]: _done, ...rest } = tasks
    this.patch({
      clis: clis.some(cli => cli.id === id) ? clis.map(cli => cli.id === id ? status : cli) : [...clis, status],
      tasks: rest,
    })
  }

  private setTask(id: ProductCliId, task: ProductCliTask): void {
    this.patch({ tasks: { ...this.store.getSnapshot().tasks, [id]: task } })
  }

  private patch(next: Partial<ProductCliState>): void {
    if (!this.disposed) this.store.set({ ...this.store.getSnapshot(), ...next })
  }
}
