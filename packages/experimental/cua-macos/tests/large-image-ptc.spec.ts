/** Valid large PNG admission through Loader, Harness tool rendering, disk attachments and a real Node PTC process. */
import * as PtcToolExecutor from '@deepseek-ai/dsh-tool-executor-ptc'
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'
import { Context } from '@deepseek-ai/cordis'
import Loader from '@deepseek-ai/cordis-plugin-loader'
import Include from '@deepseek-ai/cordis-plugin-include'
import AgentRegistry from '@deepseek-ai/dsh-agent'
import AgentLoop from '@deepseek-ai/dsh-agent-loop'
import type { AddressInfo } from 'node:net'
import { createServer } from 'node:http'
import type { ImageAttachmentRef } from '@deepseek-ai/dsh-attachment'
import LocalAttachmentStore from '@deepseek-ai/dsh-attachment-local'
import ComputerUseRegistry from '@deepseek-ai/dsh-computer-use'
import FileSystem from '@deepseek-ai/dsh-fs-local'
import { brandString } from '@deepseek-ai/dsh-brand'
import LlmRuntime, { LlmAdapter, type ToolCallId, createUserMessage } from '@deepseek-ai/dsh-llm'
import type { GenerateOptions, LlmResolvedModelInfo, StreamChunk } from '@deepseek-ai/dsh-llm'
import * as LlmPiAi from '@deepseek-ai/dsh-llm-pi-ai'
import NodePtcRuntime from '@deepseek-ai/dsh-ptc-runtime-node'
import Sandbox from '@deepseek-ai/dsh-sandbox-local'
import SandboxPolicy from '@deepseek-ai/dsh-sandbox-policy'
import SessionStore, { type SessionId } from '@deepseek-ai/dsh-session'
import SessionProjectionRegistry from '@deepseek-ai/dsh-session-projection'
import SubprocessLocal from '@deepseek-ai/dsh-subprocess-local'
import SystemPrompt from '@deepseek-ai/dsh-system-prompt'
import ToolRuntime from '@deepseek-ai/dsh-tools'
import WorkingDirectory from '@deepseek-ai/dsh-working-directory'
import sharp from 'sharp'
import { expect, it, onTestFinished, vi } from 'vitest'
import * as NativeProvider from '../src/index.ts'
import { installNativeFixture, startFixtureHost } from './native-fixture.ts'

const WIDTH = 2048
const HEIGHT = 1024
const MODEL = 'large-image-vision-fixture'

/** Anthropic Messages content block as captured on the wire. */
interface WireBlock {
  type: string
  content?: string | WireBlock[]
  source?: { type: string; data?: string }
}

/** Captured Anthropic Messages request body. */
interface WireRequest {
  messages: { content: string | WireBlock[] }[]
}

// The external native substitute is a POSIX executable; it never accesses the desktop.
it.skipIf(process.platform === 'win32')('delivers a valid PNG larger than 4 MiB through disk storage and Node PTC into the next model image request', async () => {
  const root = await mkdtemp(join(tmpdir(), 'dsh-cua-large-image-'))
  const context = new Context()
  const fixture: { close?: () => Promise<void> } = {}
  onTestFinished(async () => {
    try { await context.fiber.dispose() } finally {
      try { await fixture.close?.() } finally { await rm(root, { recursive: true, force: true }) }
    }
  })
  // Uncompressed encoding makes the size deterministic without private screenshots
  // or random pixels. The attachment store still uses its ordinary normalization policy.
  const source = await sharp({ create: { width: WIDTH, height: HEIGHT, channels: 3, background: '#4488cc' } })
    .png({ compressionLevel: 0, adaptiveFiltering: false, palette: false }).toBuffer()
  expect(source.byteLength).toBeGreaterThan(4 * 1024 * 1024)
  const decodedSource = await sharp(source).raw().toBuffer({ resolveWithObject: true })
  expect(decodedSource.info).toMatchObject({ width: WIDTH, height: HEIGHT, channels: 3 })
  expect(decodedSource.data.subarray(0, 3)).toEqual(Buffer.from([0x44, 0x88, 0xcc]))
  const sourcePath = join(root, 'generated-screenshot.png')
  await writeFile(sourcePath, source)

  const helperPath = await installNativeFixture(root)
  fixture.close = await startFixtureHost(helperPath)
  await writeFile(join(root, 'fixture-screenshot.json'), JSON.stringify({
    file: './generated-screenshot.png', pixelWidth: WIDTH, pixelHeight: HEIGHT,
    bounds: { x: 0, y: 0, width: 1024, height: 512 },
  }))
  // A local Anthropic Messages endpoint records the real pi-ai request body and refuses it.
  const captured: WireRequest[] = []
  const capture = createServer((request, response) => {
    const chunks: Buffer[] = []
    request.on('data', (chunk: Buffer) => { chunks.push(chunk) })
    request.on('end', () => {
      captured.push(JSON.parse(Buffer.concat(chunks).toString('utf8')) as WireRequest)
      response.writeHead(401, { 'content-type': 'application/json' })
      response.end(JSON.stringify({ type: 'error', error: { type: 'authentication_error', message: 'capture only' } }))
    })
  })
  const listening = Promise.withResolvers<undefined>()
  capture.listen(0, '127.0.0.1', () => { listening.resolve(undefined) })
  await listening.promise
  onTestFinished(() => {
    const closed = Promise.withResolvers<undefined>()
    capture.close(() => { closed.resolve(undefined) })
    return closed.promise
  })
  vi.stubEnv('CAPTURE_API_KEY', 'capture-key')
  const modules = {
    llm: LlmRuntime, session: SessionStore, projection: SessionProjectionRegistry,
    systemPrompt: SystemPrompt, tools: ToolRuntime, toolExecutor: PtcToolExecutor, agents: AgentRegistry, agentLoop: AgentLoop,
    attachments: LocalAttachmentStore, fs: FileSystem, subprocess: SubprocessLocal,
    sandbox: Sandbox, sandboxPolicy: SandboxPolicy, ptc: NodePtcRuntime,
    computerUse: ComputerUseRegistry, cua: NativeProvider, workingDirectory: WorkingDirectory, piAi: LlmPiAi,
  }
  const configPath = join(root, 'cordis.yml')
  const configs: Record<string, object> = {
    attachments: { dshHome: join(root, 'home') }, workingDirectory: { defaultDirectory: root },
    fs: { cwd: root }, sandboxPolicy: { mode: 'danger-full-access', workspaceRoot: root }, cua: { agentPreset: false, helperPath, allowedApps: [{ 'id': 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa', 'name': 'Fixture', 'executablePath': '/fixture/app' }] },
    piAi: { providers: { capture: {
      api: 'anthropic-messages', baseURL: `http://127.0.0.1:${(capture.address() as AddressInfo).port}`,
      apiKeyEnv: 'CAPTURE_API_KEY', cacheRetention: 'none', models: [{ id: MODEL, input: ['text', 'image'] }],
      // Below the screenshot's 2048x1024 so the route target downsizes it.
      requestImagePixelBudget: 1024 * 1024,
    } } },
  }
  await writeFile(configPath, Object.keys(modules).flatMap(name => [
    `- name: 'cordis:${name}'`, ...configs[name] === undefined ? [] : [`  config: ${JSON.stringify(configs[name])}`],
  ]).join('\n') + '\n')
  context.baseUrl = pathToFileURL(root).href + '/'
  await context.plugin(Loader)
  Object.assign(context.loader.builtins, modules, { include: Include })
  await context.loader.create({ name: 'cordis:include', config: { path: pathToFileURL(configPath).href } })
  await context.loader.await()
  for (const entry of context.loader.entries()) await entry.fiber?.await()

  class VisionModel extends LlmAdapter {
    readonly requests: GenerateOptions[] = []
    readonly requestImages: Buffer[] = []

    override imageRequestTarget(_provider: string, _model: string, image: ImageAttachmentRef) {
      return context.llm.imageRequestTarget('capture', MODEL, image)
    }

    override resolveModel(provider: string, model: string): Promise<LlmResolvedModelInfo> {
      return Promise.resolve({ provider, id: model, name: model, inputModalities: ['text', 'image'] })
    }

    async * stream(options: GenerateOptions): AsyncIterable<StreamChunk> {
      this.requests.push(options)
      if (this.requests.length === 1) {
        const code = 'const app = await tools.cua({ method: "getApp", params: { selector: "9" } }); '
          + 'const result = await tools.cua({ method: "screenshot", params: { appHandle: app.appHandle, windowId: "7" } }); '
          + 'inspect({ path: result.path, width: result.width, height: result.height }, result);'
        const call = { type: 'tool-call' as const, id: brandString<ToolCallId>('large-image-ptc'), name: 'run_code',
          arguments: JSON.stringify({ code, description: 'Inspect the generated large screenshot' }),
        }
        yield { type: 'block-start', index: 0, blockType: 'tool-call' }
        yield { type: 'block-end', index: 0, block: call }
        yield { type: 'finish', reason: { kind: 'tool-calls' } }
        return
      }
      // Send the real next AgentLoop request through the pi-ai image reader and
      // Anthropic Messages serializer to the local capture endpoint.
      const before = captured.length
      for await (const chunk of context.llm.stream({ ...options, provider: 'capture' })) void chunk
      const body = captured[before]
      if (body === undefined) throw new Error('The capture route received no request')
      const blocks = body.messages.flatMap(message => typeof message.content === 'string' ? [] : message.content)
        .flatMap(block => block.type === 'tool_result' && Array.isArray(block.content) ? block.content : [block])
      for (const block of blocks) {
        if (block.type !== 'image') continue
        if (block.source?.type !== 'base64' || block.source.data === undefined) throw new Error('Expected inline request image bytes')
        this.requestImages.push(Buffer.from(block.source.data, 'base64'))
      }
      yield { type: 'block-start', index: 0, blockType: 'text' }
      yield { type: 'block-end', index: 0, block: { type: 'text', text: 'Received the screenshot through PTC.' } }
      yield { type: 'finish', reason: { kind: 'stop' } }
    }
  }
  const saveImages = vi.spyOn(context.attachments, 'saveImages')
  const model = new VisionModel()
  context.llm.registerAdapter(['large-image-fixture'], model)
  const handle = await context.agents.create({ sessionId: brandString<SessionId>('large-image-ptc'), meta: { cwd: root },
    agentOptions: { provider: 'large-image-fixture', model: MODEL },
  })
  const idle: PromiseWithResolvers<void> = Promise.withResolvers()
  const stop = context.on('agent/status', ({ agent, status }) => {
    if (agent === handle.agent && status === 'idle') idle.resolve()
  })
  onTestFinished(() => { stop() })
  handle.agent.followup(createUserMessage({ source: { kind: 'user' }, content: [{ type: 'text', text: 'Inspect the generated screenshot.' }] }))
  await idle.promise
  stop()

  expect(saveImages).toHaveBeenCalledTimes(1)
  expect(model.requests).toHaveLength(2)
  expect(model.requests[0]?.tools?.map(tool => tool.name)).toEqual(['run_code'])
  const messages = handle.agent.session.deriveMessages()
  const result = messages.find(message => message.role === 'tool' && message.toolCallId === 'large-image-ptc')
  if (result?.role !== 'tool') throw new Error('The PTC result was not recorded')
  expect(result.isError, JSON.stringify(result.content)).toBe(false)
  const nextImages = model.requests[1]?.messages.flatMap(message => message.content).filter(block => block.type === 'image')
  expect(nextImages).toHaveLength(1)
  const image = nextImages?.[0]
  if (image === undefined) throw new Error('The next model request is missing the PTC screenshot')
  expect(image.attachment.width).toBeGreaterThan(0)
  expect(image.attachment.width).toBeLessThan(WIDTH)
  expect(result.content.filter(block => block.type === 'text').map(block => block.text).join('\n'))
    .toContain(`width: ${image.attachment.width}`)
  const stored = await context.attachments.readImage(image.attachment)
  const path = context.attachments.imageHostPath(image.attachment)
  if (path === undefined) throw new Error('The real local attachment has no disk path')
  expect(await readFile(path)).toEqual(Buffer.from(stored.data))
  expect(stored.data.byteLength).toBe(image.attachment.bytes)
  const decodedStored = await sharp(stored.data).raw().toBuffer({ resolveWithObject: true })
  expect(decodedStored.info).toMatchObject({ width: image.attachment.width, height: image.attachment.height, channels: 3 })
  const dispatches = handle.agent.session.snapshotEvents().filter(event => event.type === 'tool/ptc-dispatch')
  expect(dispatches).toHaveLength(2)
  expect(dispatches.every(event => event.data.name === 'cua' && !event.data.isError)).toBe(true)
  expect(dispatches[1]?.data.content.find(block => block.type === 'image')?.attachment).toEqual(image.attachment)
  expect(result.content).toContainEqual({ type: 'image', attachment: image.attachment })
  expect(JSON.stringify(model.requests[1]?.messages)).not.toContain(source.toString('base64'))

  expect(model.requestImages).toHaveLength(1)
  const requestImage = model.requestImages[0]
  if (requestImage === undefined) throw new Error('The provider request is missing inline image bytes')
  const requestRaster = await sharp(requestImage).raw().toBuffer({ resolveWithObject: true })
  expect(requestRaster.info.width).toBeGreaterThan(0)
  expect(requestRaster.info.height).toBeGreaterThan(0)
  expect(requestRaster.data.byteLength).toBe(requestRaster.info.width * requestRaster.info.height * requestRaster.info.channels)
  const { dominant } = await sharp(requestImage).stats()
  for (const [actual, expected] of [[dominant.r, 0x44], [dominant.g, 0x88], [dominant.b, 0xcc]]) {
    if (actual === undefined || expected === undefined) throw new Error('Missing generated image color channel')
    expect(Math.abs(actual - expected)).toBeLessThanOrEqual(4)
  }
})
