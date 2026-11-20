/**
 * Download and removal of the pinned native product CLI package. A download
 * contacts only the npm registries it is given, verifies the tarball against
 * the pinned sha512 integrity before unpacking, unpacks into a temporary
 * sibling directory, and renames it into place, so a partial download is
 * never resolved.
 *
 * @module @deepseek-ai/dsh-product-cli/download
 */

import { createHash, randomUUID } from 'node:crypto'
import { createWriteStream } from 'node:fs'
import { chmod, mkdir, readdir, rename, rm, stat } from 'node:fs/promises'
import { join } from 'node:path'
import { Readable, Transform } from 'node:stream'
import { pipeline } from 'node:stream/promises'
import type { ReadableStream as WebReadableStream } from 'node:stream/web'
import { x as extractTar } from 'tar'
import { PRODUCT_CLIS, productCliPackage, type ProductCliPlatformPackage } from './catalog.ts'
import type { ProductCliId } from './types.ts'
import { downloadedProductCliPath, productCliInstallDir, productCliRoot, type ProductCliStoreOptions } from './store.ts'

/** The registry a download asks when the caller names none. */
export const DEFAULT_PRODUCT_CLI_REGISTRY = 'https://registry.npmjs.org/'

/** Why a download did not install the CLI. */
export type ProductCliDownloadFailureReason = 'network' | 'integrity' | 'unsupported-platform' | 'filesystem' | 'busy' | 'cancelled'

/** A download that left no new copy behind; `reason` selects the user-facing message. */
export class ProductCliDownloadError extends Error {
  /**
   * @param reason - failure class.
   * @param message - diagnostic naming the package and the failing step.
   * @param options - standard `cause` chaining.
   */
  constructor(readonly reason: ProductCliDownloadFailureReason, message: string, options?: ErrorOptions) {
    super(message, options)
    this.name = 'ProductCliDownloadError'
  }
}

/** Download progress; `totalBytes` is the compressed size the registry announced, or 0 when unknown. */
export interface ProductCliDownloadProgress {
  readonly phase: 'downloading' | 'verifying' | 'installing'
  readonly receivedBytes: number
  readonly totalBytes: number
}

/** Inputs of {@link downloadProductCli}. */
export interface ProductCliDownloadOptions extends ProductCliStoreOptions {
  /** Registry base URLs asked in order; a network failure moves to the next. */
  readonly registries?: readonly string[]
  readonly platform?: NodeJS.Platform
  readonly arch?: string
  readonly fetch?: typeof fetch
  readonly signal?: AbortSignal
  readonly onProgress?: (progress: ProductCliDownloadProgress) => void
  /** Package to fetch instead of the catalog pin for this platform; tests use it to serve a local tarball. */
  readonly package?: ProductCliPlatformPackage
}

const running = new Set<ProductCliId>()

/**
 * The tarball URL of a package version on one registry.
 * @param registry - registry base URL.
 * @param pinned - package and version.
 * @returns `<registry>/<name>/-/<unscoped name>-<version>.tgz`.
 */
export function productCliTarballUrl(registry: string, pinned: ProductCliPlatformPackage): string {
  const base = registry.endsWith('/') ? registry : `${registry}/`
  const unscoped = pinned.name.slice(pinned.name.lastIndexOf('/') + 1)
  return `${base}${pinned.name}/-/${unscoped}-${pinned.version}.tgz`
}

function aborted(signal: AbortSignal | undefined, error: unknown): boolean {
  return signal?.aborted === true || (error instanceof Error && error.name === 'AbortError')
}

/** Stream one tarball to `file`, hashing it on the way. */
async function fetchTarball(
  url: string, file: string, options: ProductCliDownloadOptions,
): Promise<string> {
  let response: Response
  try {
    response = await (options.fetch ?? fetch)(url, { ...options.signal === undefined ? {} : { signal: options.signal } })
  } catch (error) {
    if (aborted(options.signal, error)) throw error
    throw new ProductCliDownloadError('network', `GET ${url} failed`, { cause: error })
  }
  if (!response.ok || response.body === null) {
    throw new ProductCliDownloadError('network', `GET ${url} answered HTTP ${response.status}`)
  }
  const totalBytes = Number(response.headers.get('content-length')) || 0
  const hash = createHash('sha512')
  let receivedBytes = 0
  let reported = 0
  options.onProgress?.({ phase: 'downloading', receivedBytes, totalBytes })
  const meter = new Transform({
    transform(chunk: Buffer, _encoding, callback) {
      hash.update(chunk)
      receivedBytes += chunk.length
      // Report about every 1 MB rather than per chunk.
      if (receivedBytes - reported >= 1 << 20) {
        reported = receivedBytes
        options.onProgress?.({ phase: 'downloading', receivedBytes, totalBytes })
      }
      callback(null, chunk)
    },
  })
  const body = Readable.fromWeb(response.body as WebReadableStream<Uint8Array>)
  try {
    // The fetch signal also ends the body stream on cancellation.
    await pipeline(body, meter, createWriteStream(file))
  } catch (error) {
    if (aborted(options.signal, error)) throw error
    throw new ProductCliDownloadError('network', `Reading ${url} failed`, { cause: error })
  }
  options.onProgress?.({ phase: 'verifying', receivedBytes, totalBytes })
  return `sha512-${hash.digest('base64')}`
}

async function removeOtherVersions(directory: string, keep: string): Promise<void> {
  const entries = await readdir(directory)
  await Promise.all(entries.filter(entry => entry !== keep && !entry.startsWith('.'))
    .map(entry => rm(join(directory, entry), { recursive: true, force: true })))
}

/**
 * Download, verify, and install the pinned native CLI for this platform. Concurrent
 * downloads of the same CLI in one process are refused with `busy`.
 * @param id - product CLI.
 * @param options - Stitch home, registries, platform, fetch, cancellation, and progress.
 * @returns the installed executable path.
 * @throws {ProductCliDownloadError} with the failure class; nothing partial is left in the install directory.
 */
export async function downloadProductCli(id: ProductCliId, options: ProductCliDownloadOptions = {}): Promise<string> {
  const platform = options.platform ?? process.platform
  const arch = options.arch ?? process.arch
  const pinned = options.package ?? productCliPackage(id, platform, arch)
  if (pinned === undefined) {
    throw new ProductCliDownloadError('unsupported-platform', `${PRODUCT_CLIS[id].displayName} has no download for ${platform}-${arch}`)
  }
  if (running.has(id)) throw new ProductCliDownloadError('busy', `${PRODUCT_CLIS[id].displayName} is already downloading`)
  running.add(id)
  const root = productCliRoot(options)
  let created = false
  const token = randomUUID()
  const archive = join(root, `.download-${token}.tgz`)
  const staging = join(root, `.staging-${token}`)
  try {
    try {
      await mkdir(root, { recursive: true })
      created = true
    } catch (error) {
      throw new ProductCliDownloadError('filesystem', `Cannot create ${root}`, { cause: error })
    }
    const registries = options.registries === undefined || options.registries.length === 0
      ? [DEFAULT_PRODUCT_CLI_REGISTRY]
      : options.registries
    let integrity = ''
    for (const [index, registry] of registries.entries()) {
      try {
        integrity = await fetchTarball(productCliTarballUrl(registry, pinned), archive, options)
        break
      } catch (error) {
        if (aborted(options.signal, error) || index === registries.length - 1) throw error
      }
    }
    if (integrity !== pinned.integrity) {
      throw new ProductCliDownloadError('integrity',
        `${pinned.name}@${pinned.version} does not match its pinned integrity (expected ${pinned.integrity}, received ${integrity})`)
    }
    const target = productCliInstallDir(id, pinned, options)
    try {
      await mkdir(staging, { recursive: true })
      // npm tarballs hold one top-level `package/` directory.
      await extractTar({ file: archive, cwd: staging, strip: 1 })
      const entry = join(staging, ...pinned.entry.split('/'))
      if (!(await stat(entry)).isFile()) throw new Error(`${pinned.entry} is not a file`)
      if (platform !== 'win32') await chmod(entry, 0o755)
      await mkdir(join(root, id), { recursive: true })
    } catch (error) {
      throw new ProductCliDownloadError('filesystem', `Cannot unpack ${pinned.name}@${pinned.version} into ${root}`, { cause: error })
    }
    options.onProgress?.({ phase: 'installing', receivedBytes: 0, totalBytes: 0 })
    try {
      await rename(staging, target)
    } catch (error) {
      // Another process finished the same version first (EPERM on Windows); its copy is complete.
      if (!['ENOTEMPTY', 'EEXIST', 'EPERM'].includes(String((error as NodeJS.ErrnoException).code))) {
        throw new ProductCliDownloadError('filesystem', `Cannot move the download into ${target}`, { cause: error })
      }
    }
    await removeOtherVersions(join(root, id), pinned.version)
    return downloadedProductCliPath(id, pinned, options)
  } catch (error) {
    if (aborted(options.signal, error)) {
      throw new ProductCliDownloadError('cancelled', `${PRODUCT_CLIS[id].displayName} download was cancelled`, { cause: error })
    }
    throw error
  } finally {
    running.delete(id)
    // Cleanup only runs inside a root this call created; an unusable root already failed above.
    if (created) await Promise.all([rm(archive, { force: true }), rm(staging, { recursive: true, force: true })])
  }
}

/**
 * Delete every Stitch-downloaded copy of one CLI; a user's own install is never touched.
 * @param id - product CLI.
 * @param options - Stitch home override.
 * @throws when a download of the same CLI is running.
 */
export async function removeProductCli(id: ProductCliId, options: ProductCliStoreOptions = {}): Promise<void> {
  if (running.has(id)) throw new ProductCliDownloadError('busy', `${PRODUCT_CLIS[id].displayName} is downloading`)
  await rm(join(productCliRoot(options), id), { recursive: true, force: true })
}
