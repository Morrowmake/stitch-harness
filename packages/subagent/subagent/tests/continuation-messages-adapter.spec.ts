import { mountWorkingDirectoryFixture } from './working-directory-fixture.ts'
import { mkdtempSync, rmSync } from 'node:fs'
import { createServer } from 'node:http'
import type { AddressInfo } from 'node:net'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { expect, it, vi } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import AgentLoop from '@deepseek-ai/dsh-agent-loop'
import { mountAgentLoopTestDependencies } from '@deepseek-ai/dsh-agent-loop-testkit'
import { createUserMessage } from '@deepseek-ai/dsh-llm'
import * as LlmPiAi from '@deepseek-ai/dsh-llm-pi-ai'
import type { SessionId } from '@deepseek-ai/dsh-session'
import * as JsonlSessionPersistence from '@deepseek-ai/dsh-session-persistence-jsonl'
import * as SubagentSpawn from '@deepseek-ai/dsh-subagent-spawn-in-process'
import SubagentRuntime, { type SubagentRunEndInfo } from '../src/index.ts'
import { loadStoredSession } from './persistence-helpers.ts'
import { brandString } from '@deepseek-ai/dsh-brand'

const MODEL = 'messages-model'

/** One Anthropic Messages SSE response carrying `blocks` as complete content blocks. */
function messagesResponse(blocks: Record<string, unknown>[]): string {
  const events = [
    { type: 'message_start', message: { id: 'msg_1', model: MODEL, usage: { input_tokens: 12, output_tokens: 1 } } },
    ...blocks.flatMap((content_block, index) => [
      { type: 'content_block_start', index, content_block },
      { type: 'content_block_stop', index },
    ]),
    { type: 'message_delta', delta: { stop_reason: 'end_turn' }, usage: { output_tokens: 5 } },
    { type: 'message_stop' },
  ]
  return events.map(event => `event: ${event.type}\ndata: ${JSON.stringify(event)}\n\n`).join('')
}

it('continues the parent through default Messages after a reasoning-bearing continuable child settles', async () => {
  const root = mkdtempSync(join(tmpdir(), 'dsh-settlement-messages-'))
  const ctx = new Context()
  const requests: { path: string; body: unknown }[] = []
  const http = createServer((request, response) => {
    const parts: Buffer[] = []
    request.on('data', (part: Buffer) => { parts.push(part) })
    request.on('end', () => {
      requests.push({ path: new URL(request.url ?? '/', 'http://loopback.invalid').pathname, body: JSON.parse(Buffer.concat(parts).toString('utf8')) })
      response.setHeader('content-type', 'text/event-stream')
      response.end(messagesResponse(requests.length === 1
        ? [{ type: 'thinking', thinking: 'child reasoning' }, { type: 'text', text: 'child answer' }]
        : [{ type: 'text', text: 'parent answer' }]))
    })
  })
  try {
    const listening = Promise.withResolvers<undefined>()
    http.listen(0, '127.0.0.1', () => { listening.resolve(undefined) })
    await listening.promise
    vi.stubEnv('MESSAGES_API_KEY', 'test-key')
    await mountAgentLoopTestDependencies(ctx, { workingDirectory: true })
    await ctx.plugin(JsonlSessionPersistence, { root })
    await ctx.plugin(AgentLoop, { agents: [] })
    await mountWorkingDirectoryFixture(ctx)
    await ctx.plugin(SubagentRuntime)
    await ctx.plugin(SubagentSpawn, { providerName: 'spawn' })
    await ctx.plugin(LlmPiAi, { providers: { mock: {
      api: 'anthropic-messages', baseURL: `http://127.0.0.1:${(http.address() as AddressInfo).port}`,
      apiKeyEnv: 'MESSAGES_API_KEY', cacheRetention: 'none', models: [{ id: MODEL }],
    } } })
    const parent = await ctx.agentLoop.create(brandString<SessionId>('parent'), { provider: 'mock', model: MODEL })
    const ends: SubagentRunEndInfo[] = []
    const settled = Promise.withResolvers<undefined>()
    ctx.on('subagent/end', (info) => {
      ends.push(info)
      settled.resolve(undefined)
    })

    const started = await ctx.subagents.startActivation({
      delivery: 'parent',
      provider: 'spawn',
      label: 'child task',
      parent, prompt: [{ type: 'text', text: 'child task' }],
      signal: new AbortController().signal,
    })
    await settled.promise
    await parent.whenIdle()

    const output = [{ type: 'reasoning', text: 'child reasoning' }, { type: 'text', text: 'child answer' }]
    expect(ends).toHaveLength(1)
    expect(ends[0]?.lastAssistantMessage).toEqual(output)
    const child = await loadStoredSession(ctx.sessionPersistence, started.childId)
    expect(child.events.filter(event => event.type === 'assistant/message').at(-1))
      .toMatchObject({ data: { message: { content: output } } })
    expect(parent.session.snapshotEvents().at(-1))
      .toMatchObject({ type: 'turn/end', data: { reason: { kind: 'completed' } } })
    expect(requests).toHaveLength(2)
    expect(requests.map(request => request.path)).toEqual(['/v1/messages', '/v1/messages'])
    const notice = parent.session.deriveMessages().find(message => message.source.kind === 'subagent-settled')
    const closingContent = [
      { type: 'text', text: 'Background subagent agent-1 finished and will do no further work unless you send it more.' },
      { type: 'text', text: 'Its closing message:' },
      { type: 'text', text: 'child answer' },
    ]
    expect(notice?.content).toEqual(closingContent)
    expect(notice?.source).toMatchObject({
      stopReason: 'completed', senderSessionId: started.childId,
    })
    const noticeWithContext = [
      { role: 'user', content: closingContent.map(block => block.text).join('') },
      {
        role: 'user',
        content: '<system-reminder>\nThe following information describes your current session:\n\n'
          + `Current working directory: ${JSON.stringify(process.cwd())}.\n</system-reminder>`,
      },
    ]
    expect(requests[1]?.body).toMatchObject({ messages: noticeWithContext })

    parent.followup(createUserMessage({ source: { kind: 'user' }, content: [{ type: 'text', text: 'continue' }] }))
    await parent.whenIdle()
    expect(parent.session.snapshotEvents().filter(event => event.type === 'turn/end'))
      .toMatchObject([{ data: { reason: { kind: 'completed' } } }, { data: { reason: { kind: 'completed' } } }])
    expect(requests).toHaveLength(3)
    expect(requests[2]?.body).toMatchObject({ messages: [
      ...noticeWithContext,
      { role: 'assistant', content: [{ type: 'text', text: 'parent answer' }] },
      { role: 'user', content: 'continue' },
    ] })
  } finally {
    try {
      await ctx.fiber.dispose()
    } finally {
      try {
        const closed = Promise.withResolvers<undefined>()
        http.close(() => { closed.resolve(undefined) })
        http.closeAllConnections()
        await closed.promise
      } finally {
        vi.unstubAllEnvs()
        rmSync(root, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 })
      }
    }
  }
})
