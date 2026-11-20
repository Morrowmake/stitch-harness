/** Agent controls use the same manager methods as the Web and bound inventory reads. */
import { executeToolFixture } from '@deepseek-ai/dsh-tool-testkit'
import * as NativeToolExecutor from '@deepseek-ai/dsh-tool-executor-native'
import { setSandboxMode } from '@deepseek-ai/dsh-sandbox-policy'
import { Context } from '@deepseek-ai/cordis'
import SystemPrompt from '@deepseek-ai/dsh-system-prompt'
import ToolRuntime, { type ToolExecutionResult } from '@deepseek-ai/dsh-tools'
import { brandString } from '@deepseek-ai/dsh-brand'
import type { ToolCallId } from '@deepseek-ai/dsh-llm/types'
import type { Agent } from '@deepseek-ai/dsh-agent'
import SandboxPolicy from '@deepseek-ai/dsh-sandbox-policy'
import { Session, type SessionId, SESSION_FORMAT_VERSION } from '@deepseek-ai/dsh-session'
import SessionProjections from '@deepseek-ai/dsh-session-projection'
import ApprovalService, { type ApprovalAnswer, type ApprovalOutcome } from '@deepseek-ai/dsh-user-approval'
import type { ApprovalRequestEvent } from '@deepseek-ai/dsh-user-approval/types'
import { expect, it, onTestFinished, vi } from 'vitest'
import type PluginManager from '../src/index.ts'
import type { BundleInfo } from '../src/types.ts'
import * as tool from '../src/tools.ts'
import { installSubject } from '../src/approval-text.ts'
import { PluginManagerError } from '../src/error.ts'
import { FileLockError } from '@deepseek-ai/dsh-atomic-write'

function resultText(result: ToolExecutionResult): string {
  if (typeof result.value !== 'string') throw new Error('Expected a serialized manager result')
  return result.value
}

async function fixture(mode: 'read-only' | 'workspace-write' | 'danger-full-access' = 'danger-full-access', approval?: 'ask' | 'never') {
  const ctx = new Context()
  onTestFinished(() => ctx.fiber.dispose())
  const manager = {
    listPlugins: vi.fn(async () => Array.from({ length: 30 }, (_, i) => ({ entryId: `include:${i}`, enabled: true }))),
    listBundles: vi.fn(async () => [{ name: 'bundle', enabled: true }]),
    setPluginEnabled: vi.fn(async () => ({ changed: true, application: 'applied' })),
    setBundleEnabled: vi.fn(async () => ({ changed: true, application: 'applied' })),
    installBundle: vi.fn(async () => ({ changed: true, application: 'restart-required' })),
    removeBundle: vi.fn(async () => ({ changed: false, application: 'failed' })),
    listVersionExemptions: vi.fn(() => ({ exemptions: { 'example@1.2.3': ['0.1.7-alpha.1'] }, warnings: [] })),
    setVersionExemption: vi.fn(async () => ({ changed: true, application: 'applied' })),
  }
  ctx.provide('pluginManager', manager as unknown as PluginManager)
  await ctx.plugin(SystemPrompt)
  await ctx.plugin(ToolRuntime)
  await ctx.plugin(NativeToolExecutor)
  await ctx.plugin(SessionProjections)
  await ctx.plugin(SandboxPolicy, { mode })
  if (approval !== undefined) await ctx.plugin(ApprovalService, { policy: approval })
  const fiber = await ctx.plugin(tool)
  const call = (args: unknown, agent?: Agent, signal = new AbortController().signal) => executeToolFixture(ctx, { name: 'plugin_manager', arguments: args,
    ...agent === undefined ? {} : { agent },
    callId: brandString<ToolCallId>('manager-call'), signal })
  return { ctx, manager, call, fiber }
}

const CHANGES = ['set_plugin', 'set_bundle', 'install_bundle', 'remove_bundle', 'set_version_exemption'] as const
const MUTATIONS = ['setPluginEnabled', 'setBundleEnabled', 'installBundle', 'removeBundle', 'setVersionExemption'] as const

it.each(['read-only', 'workspace-write'] as const)('lists without approval but denies every change in %s before it reaches the manager', async (mode) => {
  const { call, manager } = await fixture(mode)
  for (const action of ['list_plugins', 'list_bundles', 'list_version_exemptions']) {
    expect((await call({ action })).isError).toBe(false)
  }
  for (const action of CHANGES) {
    const result = await call({ action, target: 'bundle', enabled: true, runtimeVersion: '0.1.7-alpha.1' })
    expect(result.isError).toBe(true)
    expect(JSON.stringify(result.content)).toContain('requires approval, but no approval service is composed')
  }
  for (const method of MUTATIONS) expect(manager[method]).not.toHaveBeenCalled()
})

it('preserves selected bundle load errors in the agent list result', async () => {
  const { manager, call } = await fixture()
  const bundles = [{
    name: 'bundle', enabled: true,
    error: { code: 'operation-error', diagnostic: 'bundle patch is unreadable' }, rows: [], overrides: [],
  }]
  manager.listBundles.mockResolvedValue(bundles)
  expect(JSON.parse(resultText(await call({ action: 'list_bundles' })))).toMatchInlineSnapshot(`
    {
      "entries": [
        {
          "enabled": true,
          "error": {
            "code": "operation-error",
            "diagnostic": "bundle patch is unreadable",
          },
          "name": "bundle",
          "overrides": [],
          "rows": [],
        },
      ],
      "nextOffset": null,
      "total": 1,
    }
  `)
})

it('lists an absent Official bundle without display metadata', async () => {
  const { manager, call } = await fixture()
  const offered: BundleInfo = {
    name: '@deepseek-ai/dsh-subagent-codex', official: true, availability: 'missing',
    installed: false, enabled: false, optional: false, removable: false, rows: [], overrides: [],
    meta: { title: 'Codex subagent' },
  }
  manager.listBundles.mockResolvedValue([offered])
  expect(JSON.parse(resultText(await call({ action: 'list_bundles' })))).toMatchInlineSnapshot(`
    {
      "entries": [
        {
          "availability": "missing",
          "enabled": false,
          "installed": false,
          "name": "@deepseek-ai/dsh-subagent-codex",
          "official": true,
          "optional": false,
          "overrides": [],
          "removable": false,
          "rows": [],
        },
      ],
      "nextOffset": null,
      "total": 1,
    }
  `)
})

it('checks the calling session on each change, including after permission is revoked', async () => {
  const { call, manager } = await fixture()
  const id = brandString<SessionId>('manager-permissions')
  const session = Session.create(id, undefined, { version: SESSION_FORMAT_VERSION, id, createdAt: 0, isSeeded: false })
  const agent = { session } as unknown as Agent
  const change = { action: 'set_plugin', target: 'include:1', enabled: false }
  setSandboxMode(session, 'workspace-write')
  expect((await call(change, agent)).isError).toBe(true)
  expect(manager.setPluginEnabled).not.toHaveBeenCalled()
  setSandboxMode(session, 'danger-full-access')
  expect((await call(change, agent)).isError).toBe(false)
  setSandboxMode(session, 'read-only')
  expect((await call(change, agent)).isError).toBe(true)
  expect(manager.setPluginEnabled).toHaveBeenCalledTimes(1)
})

function activeAgent(sessionId = 'manager-approval'): Agent {
  const id = brandString<SessionId>(sessionId)
  const session = Session.create(id, undefined, { version: SESSION_FORMAT_VERSION, id, createdAt: 0, isSeeded: false })
  session.append('turn/start', { turn: 1 })
  return { session } as unknown as Agent
}

it.each(['read-only', 'workspace-write'] as const)('asks once per change in %s without changing session permissions, never for listing', async (mode) => {
  const { ctx, call, manager } = await fixture(mode, 'ask')
  const agent = activeAgent()
  const prompted = vi.fn(async () => 'allowed-once' as const)
  const dispose = ctx.on('approval/request', prompted)
  for (const action of ['list_plugins', 'list_bundles', 'list_version_exemptions', ...CHANGES]) {
    expect((await call({ action, target: 'bundle@1.0.0', enabled: true, runtimeVersion: '0.1.7-alpha.1', acceptRisk: true }, agent)).isError).toBe(false)
  }
  expect(prompted).toHaveBeenCalledTimes(CHANGES.length)
  for (const method of MUTATIONS) expect(manager[method]).toHaveBeenCalledTimes(1)
  expect(ctx.sandboxPolicy.resolve({ session: agent.session }).mode).toBe(mode)
  const audit = agent.session.snapshotEvents().filter(event => event.type.startsWith('approval/'))
  expect(audit).toHaveLength(CHANGES.length * 2)
  expect(audit[0]).toMatchObject({ type: 'approval/asked', data: {
    toolName: 'plugin_manager', callId: 'manager-call', grant: 'enable',
  } })
  const request = audit[0]
  if (request?.type !== 'approval/asked') throw new Error('Expected an approval request')
  expect(request.data.reason).toContain('"action":"set_plugin"')
  expect(audit[1]).toMatchObject({ type: 'approval/decided', data: { outcome: 'allowed-once' } })
  dispose()
  expect((await call({ action: 'remove_bundle', target: 'bundle' }, agent)).isError).toBe(true)
  expect(manager.removeBundle).toHaveBeenCalledTimes(1)
})

it('describes each change in plain language with the raw arguments kept for the audit', async () => {
  const { ctx, call, manager } = await fixture('workspace-write', 'ask')
  const requests: ApprovalRequestEvent[] = []
  ctx.on('approval/request', async (request) => { requests.push(request); return 'allowed-once' })
  manager.listPlugins.mockResolvedValue([{ entryId: 'include:hello', enabled: false, meta: { title: { en: 'Hello command', zh: '你好命令' } } }] as never)
  manager.listBundles.mockResolvedValue([{ name: 'hello-bundle', enabled: true, meta: { title: 'Hello bundle' } }] as never)
  const agent = activeAgent()
  await call({ action: 'install_bundle', target: '/Users/me/project/hello-command' }, agent)
  await call({ action: 'install_bundle', target: '@scope/notes', enabled: false, approvedBuilds: ['esbuild'] }, agent)
  await call({ action: 'set_plugin', target: 'include:hello', enabled: true }, agent)
  await call({ action: 'set_bundle', target: 'hello-bundle', enabled: false }, agent)
  await call({ action: 'remove_bundle', target: 'unlisted-bundle' }, agent)
  await call({ action: 'set_version_exemption', target: 'old@1.0.0', runtimeVersion: '0.2.0', enabled: true, acceptRisk: true }, agent)
  expect(requests.map(request => [request.displayReason?.en, request.grant])).toEqual([
    ['Install the plugin “hello-command” from a folder on this computer into this profile. It will run with full access to your computer. The change applies to every chat in this profile.', 'install'],
    ['Install the plugin “@scope/notes” from the npm registry into this profile. It will run with full access to your computer. Its setup scripts will also run: esbuild. It stays turned off until you turn it on. The change applies to every chat in this profile.', undefined],
    ['Turn on the plugin “Hello command” in this profile. It will run with full access to your computer. The change applies to every chat in this profile.', 'enable'],
    ['Turn off the plugin “Hello bundle” in this profile. The change applies to every chat in this profile.', 'disable'],
    ['Remove the plugin “unlisted-bundle” from this profile. The change applies to every chat in this profile.', 'remove'],
    ['Let “old@1.0.0” run on Stitch 0.2.0 although it does not declare support for that version. It may crash or lose data. The change applies to every chat in this profile.', undefined],
  ])
  expect(requests[2]?.displayReason?.['zh']).toBe('在当前 profile 中开启插件“你好命令”。它将拥有对这台电脑的完全访问权限。此更改对当前 profile 中的所有对话生效。')
  for (const request of requests) {
    expect(Object.keys(request.displayReason ?? {}).sort()).toEqual(['de', 'en', 'es', 'fr', 'ja', 'pt', 'ru', 'zh'])
    expect(request.reason).toMatch(/^escalate sandbox to danger-full-access: plugin_manager \{"action":/)
  }
})

it('lets the user allow one kind of change for the rest of the chat', async () => {
  const { ctx, call, manager } = await fixture('workspace-write', 'ask')
  const prompted = vi.fn(async (): Promise<ApprovalAnswer> => 'allowed-for-session')
  ctx.on('approval/request', prompted)
  const agent = activeAgent()
  for (let attempt = 0; attempt < 3; attempt++) {
    expect((await call({ action: 'set_plugin', target: `include:${attempt}`, enabled: true }, agent)).isError).toBe(false)
  }
  expect(prompted).toHaveBeenCalledTimes(1)
  expect(manager.setPluginEnabled).toHaveBeenCalledTimes(3)
  // Turning plugins off, installing, and version exemptions remain separate questions.
  await call({ action: 'set_plugin', target: 'include:0', enabled: false }, agent)
  await call({ action: 'install_bundle', target: 'bundle' }, agent)
  await call({ action: 'set_version_exemption', target: 'old@1.0.0', runtimeVersion: '0.2.0', enabled: true, acceptRisk: true }, agent)
  await call({ action: 'set_version_exemption', target: 'old@1.0.0', runtimeVersion: '0.2.0', enabled: true, acceptRisk: true }, agent)
  expect(prompted).toHaveBeenCalledTimes(5)
  // A new chat asks again.
  const other = activeAgent('manager-approval-other')
  await call({ action: 'set_plugin', target: 'include:1', enabled: true }, other)
  expect(prompted).toHaveBeenCalledTimes(6)
})

it.each([
  ['/Users/me/plugins/hello-command', { name: 'hello-command', source: { kind: 'folder' } }],
  ['@scope/notes@^1.2.0', { name: '@scope/notes', source: { kind: 'registry' } }],
  ['github:me/stitch-hello#main', { name: 'stitch-hello', source: { kind: 'host', host: 'github.com' } }],
  ['git@gitlab.com:me/hello.git', { name: 'hello', source: { kind: 'host', host: 'gitlab.com' } }],
  ['https://example.com/dl/hello-1.0.0.tgz', { name: 'hello-1.0.0', source: { kind: 'host', host: 'example.com' } }],
  ['relative/path', { name: 'relative/path', source: { kind: 'unknown' } }],
])('names the installed plugin and its source for %s', (spec, subject) => {
  expect(installSubject(spec)).toEqual(subject)
})

it.each(['rejected', 'cancelled', 'unavailable'] as const)('does not mutate the profile when approval is %s', async (outcome) => {
  const { ctx, call, manager } = await fixture('workspace-write', 'ask')
  ctx.on('approval/request', async () => outcome)
  const agent = activeAgent()
  expect((await call({ action: 'install_bundle', target: 'bundle' }, agent)).isError).toBe(true)
  expect(manager.installBundle).not.toHaveBeenCalled()
  expect(agent.session.snapshotEvents().filter(event => event.type === 'approval/decided')
    .map(event => event.data.outcome)).toEqual([outcome])
})

it('rejects never policy without prompting and keeps full-access calls prompt-free', async () => {
  const { ctx, call, manager } = await fixture('workspace-write', 'never')
  const prompted = vi.fn(async () => 'allowed-once' as const)
  ctx.on('approval/request', prompted, { prepend: true })
  const agent = activeAgent()
  expect((await call({ action: 'set_plugin', target: 'include:demo', enabled: true }, agent)).isError).toBe(true)
  expect(manager.setPluginEnabled).not.toHaveBeenCalled()
  setSandboxMode(agent.session, 'danger-full-access')
  expect((await call({ action: 'set_plugin', target: 'include:demo', enabled: true }, agent)).isError).toBe(false)
  expect(manager.setPluginEnabled).toHaveBeenCalledTimes(1)
  expect(prompted).not.toHaveBeenCalled()
})

it('cancels an approval wait before any manager operation', async () => {
  const { ctx, call, manager } = await fixture('workspace-write', 'ask')
  const asked = Promise.withResolvers<undefined>()
  const answer = Promise.withResolvers<ApprovalOutcome>()
  ctx.on('approval/request', () => { asked.resolve(undefined); return answer.promise })
  const controller = new AbortController()
  const result = call({ action: 'install_bundle', target: 'bundle' }, activeAgent(), controller.signal)
  await asked.promise
  expect(manager.installBundle).not.toHaveBeenCalled()
  controller.abort()
  answer.resolve('allowed-once')
  expect((await result).isError).toBe(true)
  expect(manager.installBundle).not.toHaveBeenCalled()
})

it('does not apply a grant when the call was cancelled before dispatch', async () => {
  const { ctx, call, manager } = await fixture('workspace-write', 'ask')
  const controller = new AbortController()
  vi.spyOn(ctx.approval, 'request').mockImplementation(async () => {
    controller.abort()
    return 'allowed-once'
  })
  expect((await call({ action: 'install_bundle', target: 'bundle' }, activeAgent(), controller.signal)).isError).toBe(true)
  expect(manager.installBundle).not.toHaveBeenCalled()
})

it('paginates inventories with an explicit continuation and total', async () => {
  const { call } = await fixture()
  const first = await call({ action: 'list_plugins' })
  expect(first.isError).toBe(false)
  expect(JSON.stringify(first.content)).toContain('nextOffset')
  expect(JSON.parse(resultText(first))).toMatchObject({ nextOffset: 25, total: 30 })
  const last = await call({ action: 'list_plugins', offset: 25, limit: 10 })
  expect(JSON.parse(resultText(last))).toMatchObject({ nextOffset: null, total: 30 })
  expect(resultText(await call({ action: 'list_bundles' }))).toContain('"name":"bundle"')
})

it('keeps UI translation and listing metadata out of model-facing plugin and bundle lists', async () => {
  const { call, manager } = await fixture()
  const meta = { title: { en: 'Plugin', zh: '插件' }, error: 'UI-only diagnostic' }
  manager.listPlugins.mockImplementationOnce(async () => [{ entryId: 'include:plugin', enabled: true, meta }])
  expect(JSON.parse(resultText(await call({ action: 'list_plugins' })))).toEqual({
    entries: [{ entryId: 'include:plugin', enabled: true }], total: 1, nextOffset: null,
  })
  manager.listBundles.mockImplementationOnce(async () => [{
    name: 'bundle', source: 'bundle@^1.0.0', enabled: true, listedByDefault: false, meta, rows: [{ rowId: 'plugin', moduleName: 'plugin', meta }],
  }])
  expect(JSON.parse(resultText(await call({ action: 'list_bundles' })))).toEqual({
    entries: [{ name: 'bundle', source: 'bundle@^1.0.0', enabled: true, rows: [{ rowId: 'plugin', moduleName: 'plugin' }] }], total: 1, nextOffset: null,
  })
})

it('forwards all mutation actions and renders the returned outcome', async () => {
  const { call, manager } = await fixture()
  await call({ action: 'set_plugin', target: 'include:1', enabled: false })
  expect(manager.setPluginEnabled).toHaveBeenCalledWith('include:1', false)
  await call({ action: 'set_bundle', target: 'bundle', enabled: true })
  expect(manager.setBundleEnabled).toHaveBeenCalledWith('bundle', true)
  await call({ action: 'install_bundle', target: 'bundle' })
  expect(manager.installBundle).toHaveBeenLastCalledWith('bundle', {})
  await call({ action: 'install_bundle', target: 'bundle', enabled: false })
  expect(manager.installBundle).toHaveBeenLastCalledWith('bundle', { enabled: false })
  await call({ action: 'install_bundle', target: 'bundle', approvedBuilds: ['native'] })
  expect(manager.installBundle).toHaveBeenLastCalledWith('bundle', { approvedBuilds: ['native'] })
  await call({ action: 'install_bundle', target: 'bundle', registry: 'https://registry.npmmirror.com/' })
  expect(manager.installBundle).toHaveBeenLastCalledWith('bundle', { registry: 'https://registry.npmmirror.com/' })
  expect(resultText(await call({ action: 'remove_bundle', target: 'bundle' }))).toContain('"application":"failed"')
  expect(manager.removeBundle).toHaveBeenCalledWith('bundle')
})

it.each([
  { action: 'unknown_action' },
  { action: 'list_plugins', offset: -1 },
  { action: 'list_plugins', offset: 0.5 },
  { action: 'list_bundles', limit: 101 },
  { action: 'list_bundles', limit: 0 },
  { action: 'list_bundles', limit: 1.5 },
  { action: 'set_plugin', enabled: true },
  { action: 'set_bundle', target: 'bundle' },
  { action: 'install_bundle' }, { action: 'remove_bundle' },
  { action: 'set_version_exemption', enabled: true, runtimeVersion: '1.0.0' },
  { action: 'set_version_exemption', target: 'plugin@1.0.0', enabled: true },
  { action: 'set_version_exemption', target: 'plugin@1.0.0', runtimeVersion: '1.0.0' },
])('rejects incomplete or unbounded tool inputs: %j', async (args) => {
  const { call } = await fixture()
  const result = await call(args)
  expect(result.isError).toBe(true)
  expect(result.error?.info).toEqual({ name: 'ToolArgsError', code: 'INVALID_ARGS' })
})

it('reports profile read, lock, and disposal failures with their error codes', async () => {
  const { manager, call } = await fixture()
  manager.listBundles.mockRejectedValueOnce(new PluginManagerError('plugin-manager: failed to read the profile: bad JSON', 'PLUGIN_MANAGER_PROFILE_READ_FAILED'))
  manager.setBundleEnabled.mockRejectedValueOnce(new FileLockError('/profile/package.json.lock'))
  manager.removeBundle.mockRejectedValueOnce(new PluginManagerError('plugin-manager: the manager is disposed', 'PLUGIN_MANAGER_UNAVAILABLE'))
  expect((await call({ action: 'list_bundles' })).error?.info).toEqual({ name: 'PluginManagerError', code: 'PLUGIN_MANAGER_PROFILE_READ_FAILED' })
  expect((await call({ action: 'set_bundle', target: 'bundle', enabled: false })).error?.info).toEqual({ name: 'FileLockError', code: 'FILE_LOCK_TIMEOUT' })
  expect((await call({ action: 'remove_bundle', target: 'bundle' })).error?.info).toEqual({ name: 'PluginManagerError', code: 'PLUGIN_MANAGER_UNAVAILABLE' })
})

it('presents reads and changes distinctly and disposes its registration', async () => {
  const { ctx, fiber } = await fixture()
  const definition = ctx.tools.get('plugin_manager')!
  expect(definition.presentCall?.({ action: 'list_plugins' })).toMatchObject({ kind: 'read' })
  expect(definition.presentCall?.({ action: 'remove_bundle', target: 'bundle' })).toMatchObject({ kind: 'other' })
  await fiber.dispose()
  expect(ctx.tools.get('plugin_manager')).toBeUndefined()
})

it('tells the agent the next step for each change outcome it can act on', async () => {
  const { manager, call } = await fixture()
  const outcome = async (result: object): Promise<unknown> => {
    manager.setBundleEnabled.mockResolvedValueOnce(result as never)
    return (JSON.parse(resultText(await call({ action: 'set_bundle', target: 'bundle', enabled: true }))) as { nextStep?: string }).nextStep
  }
  expect(await outcome({ changed: true, application: 'applied' })).toBeUndefined()
  expect(await outcome({ changed: false, application: 'cancelled' })).toContain('nothing changed')
  expect(await outcome({ changed: true, application: 'overridden' })).toContain('higher-priority layer')
  expect(await outcome({ changed: true, application: 'restart-required', restartReason: 'host-module' }))
    .toBe('Tell the user to restart Stitch to apply this change: the change reaches modules Stitch itself loaded.')
  expect(await outcome({ changed: true, application: 'restart-required' })).toBe('Tell the user to restart Stitch to apply this change.')
  expect(await outcome({ changed: false, application: 'failed', packageResult: { kind: 'build-blocked' } })).toContain('approvedBuilds')
  // A refusal code is more specific than the package manager's failure kind.
  expect(await outcome({ changed: false, application: 'failed', packageResult: { kind: 'network' }, error: { code: 'stale-approval' } }))
    .toContain('without approvedBuilds')
  // A failure kind without its own step falls back to the refusal code.
  expect(await outcome({ changed: false, application: 'failed', packageResult: { kind: 'unknown' }, error: { code: 'operation-error' } }))
    .toContain('Report the diagnostic')
  expect(await outcome({ changed: false, application: 'failed' })).toContain('Report the diagnostic')
  expect(await outcome({ changed: false, application: 'failed', error: { code: 'unsupported-platform' } }))
    .toBe('This bundle cannot run on the current Host platform; ask the user to use a supported Host.')
})
