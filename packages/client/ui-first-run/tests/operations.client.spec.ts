/**
 * The first-run operations call the Remotes the steps need and translate their answers: hosted providers are the
 * pi-ai catalog routes, a local or custom route stores its key before its profile, the default model writes the
 * complete selection, and the component list joins the official components with the bundles' meta and selection.
 */
import type { Context } from '@deepseek-ai/cordis'
import { RemoteError } from '@deepseek-ai/dsh-client-test-runtime'
import type { RemoteErrorCode, RemoteErrorDetailsMap } from '@deepseek-ai/dsh-api-remotes/client'
import { RemoteMock, ok } from '@deepseek-ai/dsh-remote-mock'
import { COMPONENTS } from '@deepseek-ai/dsh-official-bundles'
import { afterEach, describe, expect, it } from 'vitest'
import { createComponentOperations } from '../src/client/component-operations.ts'
import { createFirstRunOperations, deriveKeyRef, outcomeOf } from '../src/client/operations.ts'

let mock: RemoteMock

afterEach(() => { mock.assertNoUnmatched() })

function contextFor(remote: unknown): Context {
  return {
    remote,
    locale: { resolveText: (text: unknown) => typeof text === 'string' ? text : (text as { en: string }).en },
  } as never
}

/** A Remote refusal as the generated client delivers it. */
function refused<Code extends RemoteErrorCode>(code: Code, message: string, details: RemoteErrorDetailsMap[Code]) {
  return { ok: false as const, error: new RemoteError(code, message, details) }
}

describe('provider operations', () => {
  it('list configured routes and the hosted pi-ai catalog routes with their sign-in methods', async () => {
    mock = RemoteMock.create()
    const ops = createFirstRunOperations(contextFor(mock.remote))
    mock.remote.llm.listProviders.mockResolvedValue(ok([{ id: 'ollama', name: 'Ollama' }]))
    mock.remote.llm.listConfigurableProviders.mockResolvedValue(ok([
      { provider: 'anthropic', displayName: 'Anthropic (Claude)', settingsNs: 'llm-pi-ai', settingsPath: ['providers', 'anthropic'], declared: false, nativeAuth: { env: ['ANTHROPIC_API_KEY'], oauth: true, oauthName: 'Claude Pro/Max (Anthropic)' } },
      { provider: 'github-copilot', displayName: 'GitHub Copilot', settingsNs: 'llm-pi-ai', settingsPath: [], declared: false, nativeAuth: { env: ['COPILOT_GITHUB_TOKEN'], oauth: true } },
      { provider: 'amazon-bedrock', displayName: 'amazon-bedrock', settingsNs: 'llm-pi-ai', settingsPath: [], declared: false, nativeAuth: { env: ['AWS_PROFILE'], oauth: false } },
      { provider: 'ollama', displayName: 'Ollama', settingsNs: 'llm-pi-ai', settingsPath: [], declared: true },
      { provider: 'broken', displayName: 'broken', settingsNs: 'llm-pi-ai', settingsPath: [], declared: false, error: 'bad' },
      { provider: 'other', displayName: 'other', settingsNs: 'llm-other', settingsPath: [], declared: false },
    ]))
    expect(await ops.configuredProviders()).toEqual({ ok: true, value: [{ id: 'ollama', name: 'Ollama' }] })
    expect(await ops.hostedProviders()).toEqual({
      ok: true,
      value: [
        { provider: 'anthropic', displayName: 'Anthropic (Claude)', planName: 'Claude Pro/Max (Anthropic)', simpleKey: true },
        { provider: 'github-copilot', displayName: 'GitHub Copilot', planName: 'GitHub Copilot', simpleKey: false },
        { provider: 'amazon-bedrock', displayName: 'amazon-bedrock', simpleKey: false },
      ],
    })
    mock.remote.llm.listConfigurableProviders.mockResolvedValue(refused('gateway/internal', 'down', {}))
    expect(await ops.hostedProviders()).toEqual({ ok: false, code: 'gateway/internal', message: 'down' })
  })

  it('probe local servers through the Host and discover OpenAI-compatible models with a one-off key', async () => {
    mock = RemoteMock.create()
    const ops = createFirstRunOperations(contextFor(mock.remote))
    const views = [{ id: 'ollama' as const, displayName: 'Ollama', baseURL: 'http://localhost:11434/v1', running: true, models: ['llama3.2'] }]
    mock.remote.llmAccounts.probeLocalProviders.mockResolvedValue(ok(views))
    const signal = new AbortController().signal
    expect(await ops.probeLocal(signal)).toEqual({ ok: true, value: views })
    mock.remote.llm.discoverModels.mockResolvedValue(ok([{ id: 'qwen' }, { id: 'llama', name: 'Llama' }]))
    expect(await ops.discoverModels('http://gpu:8000/v1', 'sk-1')).toEqual({ ok: true, value: ['qwen', 'llama'] })
    await ops.discoverModels('http://gpu:8000/v1', undefined)
    expect(mock.remote.llm.discoverModels.mock.calls.map(call => call.slice(0, 2))).toEqual([
      ['llm-pi-ai', { api: 'openai-completions', baseURL: 'http://gpu:8000/v1', apiKey: 'sk-1' }],
      ['llm-pi-ai', { api: 'openai-completions', baseURL: 'http://gpu:8000/v1' }],
    ])
    mock.remote.llm.discoverModels.mockResolvedValue(refused('llm/model-discovery-rejected', 'unreachable', { settingsNs: 'llm-pi-ai', reason: 'unreachable' } as never))
    expect(await ops.discoverModels('http://gpu:8000/v1', undefined)).toMatchObject({
      ok: false, code: 'llm/model-discovery-rejected', message: 'unreachable', details: { reason: 'unreachable' },
    })
  })

  it('declare an OpenAI-compatible route after storing its key, and stop when the key is refused', async () => {
    mock = RemoteMock.create()
    const ops = createFirstRunOperations(contextFor(mock.remote))
    mock.remote.credentials.set.mockResolvedValue(ok(undefined))
    mock.remote.settings.mutate.mockResolvedValue(ok({} as never))
    const route = { route: 'lmstudio', displayName: 'LM Studio', baseURL: 'http://localhost:1234/v1', apiKey: 'lm-studio', models: ['qwen3'] }
    expect(await ops.addOpenAICompatible(route)).toEqual({ ok: true, value: undefined })
    expect(mock.remote.credentials.set).toHaveBeenCalledWith('LMSTUDIO_API_KEY', 'lm-studio')
    expect(mock.remote.settings.mutate.mock.calls[0]?.slice(0, 3)).toEqual(['llm-pi-ai', [{
      op: 'set',
      path: ['providers', 'lmstudio'],
      value: { displayName: 'LM Studio', apiKeyEnv: 'LMSTUDIO_API_KEY', api: 'openai-completions', baseURL: 'http://localhost:1234/v1', models: [{ id: 'qwen3' }] },
    }], undefined])
    mock.remote.credentials.set.mockResolvedValue(refused('gateway/bad-request', 'locked', {}))
    expect(await ops.addOpenAICompatible(route)).toEqual({ ok: false, code: 'gateway/bad-request', message: 'locked' })
    expect(mock.remote.settings.mutate).toHaveBeenCalledTimes(1)
    mock.remote.credentials.set.mockResolvedValue(ok(undefined))
    mock.remote.settings.mutate.mockResolvedValue(refused('settings/rejected', 'invalid', { ns: 'llm-pi-ai' }))
    expect(await ops.addOpenAICompatible(route)).toEqual({ ok: false, code: 'settings/rejected', message: 'invalid' })
    expect(deriveKeyRef('my-gpu.box')).toBe('MY_GPU_BOX_API_KEY')
  })

  it('add key accounts and run sign-in attempts through llmAccounts', async () => {
    mock = RemoteMock.create()
    const ops = createFirstRunOperations(contextFor(mock.remote))
    mock.remote.llmAccounts.addApiKeyAccount.mockResolvedValue(ok({ account: {}, check: { status: 'verified' } } as never))
    expect(await ops.addApiKeyAccount('anthropic', 'sk-ant')).toEqual({ ok: true, value: { verified: true } })
    expect(mock.remote.llmAccounts.addApiKeyAccount).toHaveBeenCalledWith('anthropic', { key: 'sk-ant' })
    mock.remote.llmAccounts.addApiKeyAccount.mockResolvedValue(ok({ account: {}, check: { status: 'unverified', reason: 'unreachable' } } as never))
    expect(await ops.addApiKeyAccount('anthropic', 'sk-ant')).toEqual({ ok: true, value: { verified: false } })
    mock.remote.llmAccounts.addApiKeyAccount.mockResolvedValue(refused('llm-accounts/invalid-key', 'bad', {}))
    expect(await ops.addApiKeyAccount('anthropic', 'x')).toMatchObject({ ok: false, code: 'llm-accounts/invalid-key', message: 'bad' })
    mock.remote.llmAccounts.beginSignIn.mockResolvedValue(refused('llm-accounts/attempt-busy', 'busy', { provider: 'anthropic' }))
    expect(await ops.beginSignIn('anthropic', { method: 'oauth' })).toEqual({ ok: false, code: 'llm-accounts/attempt-busy', message: 'busy' })
    mock.remote.llmAccounts.answerSignInPrompt.mockResolvedValue(ok(undefined))
    mock.remote.llmAccounts.cancelSignIn.mockResolvedValue(ok(undefined))
    expect(await ops.answerSignInPrompt('a' as never, 'p', { value: 'v' })).toEqual({ ok: true, value: undefined })
    expect(await ops.cancelSignIn('a' as never)).toEqual({ ok: true, value: undefined })
    mock.remote.llmAccounts.watchSignIn.mockReturnValue('stream' as never)
    expect(ops.watchSignIn('a' as never, new AbortController().signal)).toBe('stream')
  })

  it('read a route’s models from the catalog and save the complete default selection', async () => {
    mock = RemoteMock.create()
    const ops = createFirstRunOperations(contextFor(mock.remote))
    mock.remote.session.modelCatalog.mockResolvedValue(ok({
      routableProviders: [], failures: [],
      groups: [{ id: 'anthropic', name: 'Anthropic', models: [{ id: 'claude', name: 'Claude' }, { id: '~acct:k3j9x0a1bc:claude', name: 'Claude' }] }],
    }))
    expect(await ops.providerModels('anthropic')).toEqual({ ok: true, value: [{ id: 'claude', name: 'Claude' }] })
    expect(await ops.providerModels('groq')).toEqual({ ok: true, value: [] })
    mock.remote.session.modelCatalog.mockResolvedValue(refused('gateway/internal', 'no catalog', {}))
    expect(await ops.providerModels('anthropic')).toMatchObject({ ok: false, message: 'no catalog' })
    mock.remote.settings.mutate.mockResolvedValue(ok({} as never))
    expect(await ops.saveDefaultModel('ollama', 'llama3.2')).toEqual({ ok: true, value: undefined })
    expect(mock.remote.settings.mutate.mock.calls[0]?.slice(0, 3)).toEqual(['agent-default-model', [
      { op: 'set', path: ['provider'], value: 'ollama' },
      { op: 'set', path: ['model'], value: 'llama3.2' },
      { op: 'unset', path: ['reasoningEffort'] },
    ], undefined])
    mock.remote.settings.mutate.mockResolvedValue(refused('settings/rejected', 'no', { ns: 'agent-default-model' }))
    expect(await ops.saveDefaultModel('ollama', 'x')).toMatchObject({ ok: false, message: 'no' })
  })

  it('maps refusal codes', () => {
    expect(outcomeOf({ ok: false, error: { code: 'x', message: 'm' } })).toEqual({ ok: false, code: 'x', message: 'm' })
  })
})

describe('component operations', () => {
  const bundle = (name: string, enabled: boolean, extra: object = {}) => ({
    name, official: true, availability: 'installation' as const, enabled, installed: true, optional: true, removable: false, rows: [], overrides: [], ...extra,
  })

  it('join the official components with bundle meta and selection, leaving out what is not shipped', async () => {
    mock = RemoteMock.create()
    const ops = createComponentOperations(contextFor(mock.remote))
    const [files, subagents, teams] = ['files', 'subagents', 'agent-teams'].map(id => COMPONENTS.find(component => component.id === id)!)
    mock.remote.pluginManager.listBundles.mockResolvedValue(ok([
      bundle(files!.packageName, true, { meta: { title: { en: 'Files & preview' }, description: 'Tree', icon: 'data:image/svg+xml;base64,AA' } }),
      bundle(subagents!.packageName, false),
      bundle(teams!.packageName, false, { availability: 'missing' }),
      bundle('@deepseek-ai/dsh-unrelated', true),
    ] as never))
    const listed = await ops.list()
    expect(listed).toEqual({
      ok: true,
      value: [
        { id: 'files', bundle: files!.packageName, title: 'Files & preview', description: 'Tree', icon: 'data:image/svg+xml;base64,AA', requires: [], standard: files!.standard, enabled: true },
        { id: 'subagents', bundle: subagents!.packageName, title: 'subagents', description: '', requires: [], standard: true, enabled: false },
      ],
    })
    mock.remote.pluginManager.listBundles.mockResolvedValue(refused('gateway/internal', 'no profile', {}))
    expect(await ops.list()).toMatchObject({ ok: false, message: 'no profile' })
  })

  it('apply changes in one batched call and report restarts and failures', async () => {
    mock = RemoteMock.create()
    const ops = createComponentOperations(contextFor(mock.remote))
    const setMany = mock.remote.pluginManager.setBundlesEnabled
    setMany.mockResolvedValueOnce(ok({ changed: true, application: 'applied', stage: 'enable', target: 'bundles' }))
    expect(await ops.apply({ a: true })).toEqual({ ok: true, value: { restartRequired: false } })
    expect(setMany).toHaveBeenCalledWith({ a: true })
    setMany.mockResolvedValueOnce(ok({ changed: true, application: 'restart-required', stage: 'enable', target: 'bundles' }))
    expect(await ops.apply({ a: false })).toEqual({ ok: true, value: { restartRequired: true } })
    setMany.mockResolvedValueOnce(ok({ changed: false, application: 'failed', stage: 'enable', target: 'bundles', error: { code: 'operation-error', diagnostic: 'locked' } }))
    expect(await ops.apply({ a: false })).toEqual({ ok: false, code: 'plugin-manager/operation-error', message: 'locked' })
    setMany.mockResolvedValueOnce(ok({ changed: false, application: 'failed', stage: 'enable', target: 'bundles', error: { code: 'bundle-in-use' } }))
    expect(await ops.apply({ a: false })).toEqual({ ok: false, code: 'plugin-manager/bundle-in-use', message: '' })
    setMany.mockResolvedValueOnce(ok({ changed: false, application: 'cancelled', stage: 'enable', target: 'bundles' }))
    expect(await ops.apply({ a: false })).toEqual({ ok: false, code: 'plugin-manager/cancelled', message: '' })
    setMany.mockResolvedValueOnce(ok({ changed: false, application: 'overridden', stage: 'enable', target: 'bundles' }))
    expect(await ops.apply({ a: false })).toEqual({ ok: false, code: 'plugin-manager/overridden', message: '' })
    setMany.mockResolvedValueOnce(refused('plugin-manager/unknown-bundle', 'no such bundle', { name: 'a' }))
    expect(await ops.apply({ a: false })).toEqual({ ok: false, code: 'plugin-manager/unknown-bundle', message: 'no such bundle' })
  })
})
