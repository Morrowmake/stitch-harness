import { createHash, randomBytes } from 'node:crypto'
import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs'
import { createServer, type Server, type ServerResponse } from 'node:http'
import type { AddressInfo } from 'node:net'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { c as createTar } from 'tar'
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest'
import {
  downloadProductCli,
  ProductCliDownloadError,
  productCliRoot,
  productCliTarballUrl,
  removeProductCli,
  type ProductCliDownloadProgress,
  type ProductCliPlatformPackage,
} from '../src/index.ts'

let root: string
let dshHome: string
let tarball: Buffer
let integrity: string
let server: Server
let registry: string
let routes: Map<string, (response: ServerResponse) => void>

beforeAll(async () => {
  const source = mkdtempSync(join(tmpdir(), 'product-cli-package-'))
  mkdirSync(join(source, 'package', 'vendor', 'bin'), { recursive: true })
  writeFileSync(join(source, 'package', 'package.json'), '{"name":"@test/cli","version":"1.0.0"}')
  writeFileSync(join(source, 'package', 'vendor', 'bin', 'tool'), '#!/bin/sh\necho 1.0.0\n', { mode: 0o644 })
  const file = join(source, 'package.tgz')
  await createTar({ gzip: true, file, cwd: source, portable: true }, ['package'])
  tarball = readFileSync(file)
  integrity = `sha512-${createHash('sha512').update(tarball).digest('base64')}`
  rmSync(source, { recursive: true, force: true })
  routes = new Map()
  server = createServer((request, response) => {
    const route = routes.get(request.url ?? '')
    if (route === undefined) {
      response.writeHead(404).end()
      return
    }
    route(response)
  })
  await new Promise<void>((resolve) => { server.listen(0, '127.0.0.1', resolve) })
  registry = `http://127.0.0.1:${(server.address() as AddressInfo).port}/`
})

afterAll(async () => {
  await new Promise<void>((resolve) => { server.close(() => { resolve() }) })
})

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), 'product-cli-download-'))
  dshHome = join(root, 'stitch-home')
  routes.clear()
})

afterEach(() => {
  rmSync(root, { recursive: true, force: true })
})

function testPackage(overrides: Partial<ProductCliPlatformPackage> = {}): ProductCliPlatformPackage {
  return { name: '@test/cli-darwin-arm64', version: '1.0.0', integrity, unpackedSize: 100, entry: 'vendor/bin/tool', ...overrides }
}

function serve(pinned: ProductCliPlatformPackage, body: Buffer = tarball): void {
  routes.set(new URL(productCliTarballUrl(registry, pinned)).pathname, (response) => {
    response.writeHead(200, { 'content-length': String(body.length) })
    response.end(body)
  })
}

/** Files left in the Stitch download root, ignoring the installed CLI directories. */
function leftovers(): string[] {
  const directory = productCliRoot({ dshHome })
  return existsSync(directory) ? readdirSync(directory).filter(entry => entry.startsWith('.')) : []
}

describe('downloadProductCli', () => {
  it('installs a verified package atomically, reports progress, and replaces older versions', async () => {
    const pinned = testPackage()
    serve(pinned)
    const stale = join(productCliRoot({ dshHome }), 'codex', '0.0.1')
    mkdirSync(stale, { recursive: true })
    const progress: ProductCliDownloadProgress[] = []
    const executable = await downloadProductCli('codex', { dshHome, registries: [registry], package: pinned, onProgress: (event) => { progress.push(event) } })
    expect(executable).toBe(join(productCliRoot({ dshHome }), 'codex', '1.0.0', 'vendor', 'bin', 'tool'))
    expect(statSync(executable).mode & 0o111).not.toBe(0)
    expect(progress.map(event => event.phase)).toEqual(['downloading', 'verifying', 'installing'])
    expect(progress[1]).toEqual({ phase: 'verifying', receivedBytes: tarball.length, totalBytes: tarball.length })
    expect(existsSync(stale)).toBe(false)
    expect(leftovers()).toEqual([])
  })

  it('refuses a tarball whose sha512 differs from the pin and installs nothing', async () => {
    const pinned = testPackage()
    serve(pinned, Buffer.concat([tarball, Buffer.from('tampered')]))
    const failure = await downloadProductCli('codex', { dshHome, registries: [registry], package: pinned }).catch((error: unknown) => error)
    expect(failure).toBeInstanceOf(ProductCliDownloadError)
    expect(failure).toMatchObject({ reason: 'integrity' })
    expect(existsSync(join(productCliRoot({ dshHome }), 'codex'))).toBe(false)
    expect(leftovers()).toEqual([])
  })

  it('moves to the next registry after a network failure', async () => {
    const pinned = testPackage()
    serve(pinned)
    const executable = await downloadProductCli('codex', {
      dshHome, registries: ['http://127.0.0.1:1/', `${registry}missing/`, registry], package: pinned,
    })
    expect(existsSync(executable)).toBe(true)
  })

  it('reports a network failure when no registry has the tarball', async () => {
    const failure = downloadProductCli('codex', { dshHome, registries: [registry], package: testPackage() })
    await expect(failure).rejects.toMatchObject({ reason: 'network' })
    await expect(failure).rejects.toThrow('HTTP 404')
    expect(leftovers()).toEqual([])
  })

  it('reports a filesystem failure when the package lacks its executable', async () => {
    const pinned = testPackage({ entry: 'vendor/bin/absent' })
    serve(pinned)
    await expect(downloadProductCli('codex', { dshHome, registries: [registry], package: pinned }))
      .rejects.toMatchObject({ reason: 'filesystem' })
    expect(leftovers()).toEqual([])
  })

  it('reports a filesystem failure when the Stitch home cannot be created', async () => {
    const blocked = join(root, 'file')
    writeFileSync(blocked, '')
    await expect(downloadProductCli('codex', { dshHome: blocked, registries: [registry], package: testPackage() }))
      .rejects.toMatchObject({ reason: 'filesystem' })
  })

  it('cancels a download while its body streams, and before it starts', async () => {
    const pinned = testPackage()
    const controller = new AbortController()
    routes.set(new URL(productCliTarballUrl(registry, pinned)).pathname, (response) => {
      response.writeHead(200, { 'content-length': String(tarball.length) })
      response.write(tarball.subarray(0, 10))
    })
    await expect(downloadProductCli('codex', {
      dshHome, registries: [registry], package: pinned, signal: controller.signal, onProgress: () => { controller.abort() },
    })).rejects.toMatchObject({ reason: 'cancelled' })
    await expect(downloadProductCli('codex', { dshHome, registries: [registry], package: pinned, signal: AbortSignal.abort() }))
      .rejects.toMatchObject({ reason: 'cancelled' })
    expect(leftovers()).toEqual([])
  })

  it('reports progress about every megabyte without a content length', async () => {
    const source = mkdtempSync(join(tmpdir(), 'product-cli-large-'))
    mkdirSync(join(source, 'package'), { recursive: true })
    writeFileSync(join(source, 'package', 'tool'), randomBytes(3 << 20))
    await createTar({ gzip: true, file: join(source, 'large.tgz'), cwd: source }, ['package'])
    const large = readFileSync(join(source, 'large.tgz'))
    rmSync(source, { recursive: true, force: true })
    const pinned = testPackage({ integrity: `sha512-${createHash('sha512').update(large).digest('base64')}`, entry: 'tool' })
    routes.set(new URL(productCliTarballUrl(registry, pinned)).pathname, (response) => {
      response.writeHead(200)
      response.end(large)
    })
    const progress: ProductCliDownloadProgress[] = []
    await downloadProductCli('codex', { dshHome, registries: [registry], package: pinned, platform: 'win32', onProgress: (event) => { progress.push(event) } })
    const downloading = progress.filter(event => event.phase === 'downloading')
    expect(downloading.length).toBeGreaterThan(2)
    expect(downloading.every(event => event.totalBytes === 0)).toBe(true)
  })

  it('asks the npm registry when no registry is named', async () => {
    const asked: string[] = []
    await expect(downloadProductCli('codex', {
      dshHome, registries: [], package: testPackage(),
      fetch: (url) => {
        asked.push(url instanceof Request ? url.url : url.toString())
        return Promise.resolve(new Response(null, { status: 404 }))
      },
    })).rejects.toMatchObject({ reason: 'network' })
    expect(asked).toEqual(['https://registry.npmjs.org/@test/cli-darwin-arm64/-/cli-darwin-arm64-1.0.0.tgz'])
  })

  it('reports a network failure for an empty body or a connection that drops', async () => {
    const pinned = testPackage()
    await expect(downloadProductCli('codex', {
      dshHome, registries: [registry], package: pinned, fetch: () => Promise.resolve(new Response(null, { status: 200 })),
    })).rejects.toMatchObject({ reason: 'network' })
    routes.set(new URL(productCliTarballUrl(registry, pinned)).pathname, (response) => {
      response.writeHead(200, { 'content-length': String(tarball.length) })
      response.write(tarball.subarray(0, 10), () => { response.destroy() })
    })
    const dropped = downloadProductCli('codex', { dshHome, registries: [registry], package: pinned })
    await expect(dropped).rejects.toMatchObject({ reason: 'network' })
    await expect(dropped).rejects.toThrow('Reading')
    const refused = downloadProductCli('codex', { dshHome, registries: ['http://127.0.0.1:1/'], package: pinned })
    await expect(refused).rejects.toMatchObject({ reason: 'network' })
    await expect(refused).rejects.toThrow('failed')
    expect(leftovers()).toEqual([])
  })

  it('refuses a package whose entry is a directory', async () => {
    const pinned = testPackage({ entry: 'vendor/bin' })
    serve(pinned)
    await expect(downloadProductCli('codex', { dshHome, registries: [registry], package: pinned }))
      .rejects.toMatchObject({ reason: 'filesystem' })
  })

  it('keeps a copy another process finished first, and fails when the target cannot be replaced', async () => {
    const pinned = testPackage()
    serve(pinned)
    const target = join(productCliRoot({ dshHome }), 'codex', '1.0.0')
    mkdirSync(target, { recursive: true })
    writeFileSync(join(target, 'other'), '')
    await downloadProductCli('codex', { dshHome, registries: [registry], package: pinned })
    expect(readdirSync(target)).toEqual(['other'])
    rmSync(target, { recursive: true })
    writeFileSync(target, '')
    await expect(downloadProductCli('codex', { dshHome, registries: [registry], package: pinned }))
      .rejects.toMatchObject({ reason: 'filesystem' })
  })

  it('refuses a second concurrent download of the same CLI and removal while it runs', async () => {
    const pinned = testPackage()
    serve(pinned)
    const first = downloadProductCli('claude-code', { dshHome, registries: [registry], package: pinned })
    await expect(downloadProductCli('claude-code', { dshHome, registries: [registry], package: pinned })).rejects.toMatchObject({ reason: 'busy' })
    await expect(removeProductCli('claude-code', { dshHome })).rejects.toMatchObject({ reason: 'busy' })
    await first
  })

  it('refuses a platform without a download', async () => {
    await expect(downloadProductCli('codex', { dshHome, platform: 'freebsd', arch: 'x64' }))
      .rejects.toMatchObject({ reason: 'unsupported-platform' })
  })
})

describe('removeProductCli', () => {
  it('deletes every downloaded version of one CLI', async () => {
    const pinned = testPackage()
    serve(pinned)
    await downloadProductCli('codex', { dshHome, registries: [registry], package: pinned })
    await removeProductCli('codex', { dshHome })
    expect(existsSync(join(productCliRoot({ dshHome }), 'codex'))).toBe(false)
  })
})

describe('productCliTarballUrl', () => {
  it('forms npm registry tarball paths for scoped and aliased packages', () => {
    expect(productCliTarballUrl('https://registry.npmjs.org', testPackage({ name: '@openai/codex', version: '0.153.4-darwin-arm64' })))
      .toBe('https://registry.npmjs.org/@openai/codex/-/codex-0.153.4-darwin-arm64.tgz')
    expect(productCliTarballUrl('https://registry.npmmirror.com/', testPackage({ name: '@anthropic-ai/claude-agent-sdk-win32-x64', version: '0.3.263' })))
      .toBe('https://registry.npmmirror.com/@anthropic-ai/claude-agent-sdk-win32-x64/-/claude-agent-sdk-win32-x64-0.3.263.tgz')
  })
})
