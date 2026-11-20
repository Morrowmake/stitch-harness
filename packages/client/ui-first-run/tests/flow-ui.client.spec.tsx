// @vitest-environment jsdom
/**
 * The first-run dialog as a user walks it: it waits for the preview notice, Skip never claims a provider is set up,
 * Back returns to the previous step, no default model is preselected and older models fold away, a typed
 * `host:port` reaches the server as an http `/v1` address with errors that tell an unreachable host from a server
 * that is not OpenAI-compatible or needs a key, a key the provider rejects keeps the form open, and a blank answer
 * to a free-text sign-in question can be submitted.
 */
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react'
import { makeTranslate } from '@deepseek-ai/dsh-client-test-runtime'
import type { SignInAttemptView } from '@deepseek-ai/dsh-api-remotes/client'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { FirstRunOverlay, type FirstRunOverlayProps } from '../src/client/FirstRunOverlay.tsx'
import type { FlowState } from '../src/client/flow.ts'
import { en } from '../src/client/locales.ts'
import { ModelStep } from '../src/client/ModelStep.tsx'
import type { FirstRunOperations, Outcome } from '../src/client/operations.ts'
import { ProviderStep, serverAddress } from '../src/client/ProviderStep.tsx'
import { SignInPanel } from '../src/client/SignInPanel.tsx'
import type { ComponentOperations } from '../src/client/types.ts'
import { FIRST_RUN_COMPLETED_FIELD } from '../src/settings.ts'

afterEach(() => { cleanup() })

const t = makeTranslate(en)
const click = async (element: HTMLElement) => { await act(async () => { fireEvent.click(element) }) }
const settle = async () => { await act(async () => { await Promise.resolve() }) }
const ok = <T,>(value: T): Outcome<T> => ({ ok: true, value })

function operations(overrides: Partial<FirstRunOperations> = {}): FirstRunOperations {
  return {
    configuredProviders: vi.fn(async () => ok([])),
    hostedProviders: vi.fn(async () => ok([])),
    probeLocal: vi.fn(async () => ok([])),
    discoverModels: vi.fn(async () => ok(['llama3.2'])),
    addOpenAICompatible: vi.fn(async () => ok(undefined)),
    addApiKeyAccount: vi.fn(async () => ok({ verified: true })),
    beginSignIn: vi.fn(),
    watchSignIn: vi.fn(),
    answerSignInPrompt: vi.fn(async () => ok(undefined)),
    cancelSignIn: vi.fn(async () => ok(undefined)),
    providerModels: vi.fn(async () => ok([])),
    saveDefaultModel: vi.fn(async () => ok(undefined)),
    ...overrides,
  }
}

const components: ComponentOperations = { list: vi.fn(async () => ok([])), apply: vi.fn(async () => ok({ restartRequired: false })) }

function useStore<S>(value: S) {
  return <R,>(selector: (state: S) => R): R => selector(value)
}

function overlay(options: { flow?: FlowState; welcome?: unknown; welcomeGate?: boolean; ops?: FirstRunOperations } = {}) {
  const close = vi.fn()
  const props = {
    useFlow: useStore(options.flow ?? { entry: null, dismissed: false }),
    useFirstRun: useStore({ status: 'ready', writable: true, value: {} }),
    useWelcome: useStore(options.welcome ?? { status: 'ready', writable: true, value: { welcomeNoticeVersion: '1' } }),
    welcomeGate: options.welcomeGate ?? true,
    operations: options.ops ?? operations(),
    components,
    close,
    t,
  }
  // The fake hooks and translator stand in for the renderer-bound props.
  const overlayProps = props as unknown as FirstRunOverlayProps
  return { props: overlayProps, close }
}

describe('first-run dialog', () => {
  it('waits for the preview notice in the browser, and opens at once where there is none', async () => {
    const unacknowledged = { status: 'ready', writable: true, value: {} }
    const first = render(<FirstRunOverlay {...overlay({ welcome: unacknowledged }).props} />)
    expect(screen.queryByRole('dialog')).toBeNull()
    first.unmount()
    render(<FirstRunOverlay {...overlay({ welcome: { status: 'loading' } }).props} />)
    expect(screen.queryByRole('dialog')).toBeNull()
    cleanup()
    render(<FirstRunOverlay {...overlay({ welcome: unacknowledged, welcomeGate: false }).props} />)
    await settle()
    expect(screen.getByRole('dialog', { name: en['provider.title'] })).toBeTruthy()
    cleanup()
    render(<FirstRunOverlay {...overlay().props} />)
    await settle()
    expect(screen.getByRole('dialog', { name: en['provider.title'] })).toBeTruthy()
    expect(FIRST_RUN_COMPLETED_FIELD).toBe('completedVersion')
  })

  it('skips without claiming a provider, renumbers the steps, and goes back', async () => {
    render(<FirstRunOverlay {...overlay().props} />)
    await settle()
    expect(screen.queryByRole('button', { name: en.back })).toBeNull()
    expect(screen.getByText('Step 1 of 3')).toBeTruthy()
    await click(screen.getByRole('button', { name: en.skip }))
    expect(screen.getByRole('dialog', { name: en['components.title'] })).toBeTruthy()
    expect(screen.getByText('Step 2 of 2')).toBeTruthy()
    await click(screen.getByRole('button', { name: en.back }))
    expect(screen.getByRole('dialog', { name: en['provider.title'] })).toBeTruthy()
    await click(screen.getByRole('button', { name: en.skip }))
    await settle()
    await click(screen.getByRole('button', { name: en['components.apply'] }))
    await settle()
    expect(screen.getByRole('dialog', { name: en['done.titleNoProvider'] })).toBeTruthy()
    expect(screen.queryByText(en['done.title'])).toBeNull()
    expect(screen.getByText(en['done.noProvider'])).toBeTruthy()
    await click(screen.getByRole('button', { name: en['done.setUp'] }))
    expect(screen.getByRole('dialog', { name: en['provider.title'] })).toBeTruthy()
  })

  it('skipping is all set when a provider already serves requests', async () => {
    const ops = operations({ configuredProviders: vi.fn(async () => ok([{ id: 'ollama', name: 'Ollama' }])) })
    render(<FirstRunOverlay {...overlay({ ops }).props} />)
    await settle()
    await click(screen.getByRole('button', { name: en.skip }))
    await settle()
    await click(screen.getByRole('button', { name: en['components.apply'] }))
    await settle()
    expect(screen.getByRole('dialog', { name: en['done.title'] })).toBeTruthy()
    expect(screen.queryByText(en['done.noProvider'])).toBeNull()
  })

  it('closes instead of skipping when opened from Settings', async () => {
    const { props, close } = overlay({ flow: { entry: 'provider', dismissed: true } })
    render(<FirstRunOverlay {...props} />)
    await settle()
    expect(screen.queryByRole('button', { name: en.skip })).toBeNull()
    const buttons = screen.getAllByRole('button', { name: en.close })
    await click(buttons.at(-1)!)
    expect(close).toHaveBeenCalledWith('provider')
  })
})

describe('default model step', () => {
  it('preselects nothing and folds older models', async () => {
    const saveDefaultModel = vi.fn(async (..._args: unknown[]) => ok(undefined))
    const ops = operations({
      saveDefaultModel,
      providerModels: vi.fn(async () => ok([
        { id: 'opus-5-5', name: 'Opus 5.5' },
        { id: 'sonnet-5-5', name: 'Sonnet 5.5' },
        { id: 'opus-4-5', name: 'Opus 4.5 (latest)', older: true },
      ])),
    })
    const onSaved = vi.fn()
    render(<ModelStep provider={{ id: 'anthropic', name: 'Anthropic' }} operations={ops} t={t} onSaved={onSaved} />)
    await settle()
    const use = screen.getByRole('button', { name: en['model.use'] })
    expect((use as HTMLButtonElement).disabled).toBe(true)
    expect(screen.getAllByRole('radio').map(radio => (radio as HTMLInputElement).checked)).toEqual([false, false])
    expect(screen.queryByText('Opus 4.5 (latest)')).toBeNull()
    await click(screen.getByRole('button', { name: 'Older models (1)' }))
    expect(screen.getByText('Opus 4.5 (latest)')).toBeTruthy()
    await click(screen.getByRole('radio', { name: /Sonnet 5\.5/ }))
    await click(use)
    expect(saveDefaultModel).toHaveBeenCalledWith('anthropic', 'sonnet-5-5')
    expect(onSaved).toHaveBeenCalledWith('Sonnet 5.5')
  })

  it('takes a lone model as the answer', async () => {
    const provider = { id: 'ollama', name: 'Ollama', models: ['llama3.2'] }
    render(<ModelStep provider={provider} operations={operations()} t={t} onSaved={vi.fn()} />)
    expect(screen.getByRole<HTMLInputElement>('radio').checked).toBe(true)
  })
})

describe('another server', () => {
  it('reads host:port as an http /v1 address', () => {
    expect(serverAddress('192.168.1.20:11434')).toEqual({ baseURL: 'http://192.168.1.20:11434/v1', hostname: '192.168.1.20', host: '192.168.1.20:11434' })
    expect(serverAddress(' gpu-box.tail1234.ts.net:8000/openai/v1/ ')?.baseURL).toBe('http://gpu-box.tail1234.ts.net:8000/openai/v1')
    expect(serverAddress('https://llm.example.com')?.baseURL).toBe('https://llm.example.com/v1')
    expect(serverAddress('http://[::1]:8000/v1')).toEqual({ baseURL: 'http://[::1]:8000/v1', hostname: '::1', host: '[::1]:8000' })
    expect(serverAddress('ftp://host/v1')).toBeUndefined()
    expect(serverAddress('')).toBeUndefined()
    expect(serverAddress('not a host')).toBeUndefined()
  })

  async function tryServer(reason: string, key = '') {
    const discoverModels = vi.fn(async (..._args: unknown[]) => (
      { ok: false as const, code: 'llm/model-discovery-rejected', message: 'raw', details: { reason } }
    ))
    const ops = operations({ discoverModels })
    render(<ProviderStep operations={ops} t={t} onReady={vi.fn()} />)
    await settle()
    await click(screen.getByRole('button', { name: en['custom.open'] }))
    fireEvent.change(screen.getByLabelText(en['custom.baseURL']), { target: { value: '10.0.0.5:11434' } })
    if (key !== '') fireEvent.change(screen.getByLabelText(en['custom.key']), { target: { value: key } })
    expect(screen.getByText('Will use http://10.0.0.5:11434/v1')).toBeTruthy()
    await click(screen.getByRole('button', { name: en['custom.discover'] }))
    expect(discoverModels).toHaveBeenCalledWith('http://10.0.0.5:11434/v1', key === '' ? undefined : key)
    return screen.getByRole('alert').textContent
  }

  it('tells an unreachable host from a server that is not OpenAI-compatible or needs a key', async () => {
    expect(await tryServer('unreachable')).toBe('Couldn’t reach 10.0.0.5:11434. Check that the machine is on and the server is running on that port.')
    cleanup()
    expect(await tryServer('not-compatible')).toContain('Reached 10.0.0.5:11434, but it didn’t answer like an OpenAI-compatible server')
    cleanup()
    expect(await tryServer('unauthorized')).toBe('10.0.0.5:11434 needs an API key. Enter the server’s key and try again.')
    cleanup()
    expect(await tryServer('unauthorized', 'sk-1')).toBe('10.0.0.5:11434 rejected the API key. Check it and try again.')
  })
})

describe('API key step', () => {
  async function saveKey(ops: FirstRunOperations) {
    const onReady = vi.fn()
    render(<ProviderStep operations={ops} t={t} onReady={onReady} />)
    await settle()
    await click(screen.getByRole('button', { name: en['hosted.apiKey'] }))
    fireEvent.change(screen.getByLabelText('OpenAI API key'), { target: { value: 'sk-wrong' } })
    await click(screen.getByRole('button', { name: en['hosted.save'] }))
    return onReady
  }
  const hosted = vi.fn(async () => ok([{ provider: 'openai', displayName: 'OpenAI', simpleKey: true }]))

  it('keeps the form open with the provider’s rejection', async () => {
    const onReady = await saveKey(operations({
      hostedProviders: hosted,
      addApiKeyAccount: vi.fn(async () => ({ ok: false as const, code: 'llm-accounts/key-rejected', message: 'raw' })),
    }))
    expect(onReady).not.toHaveBeenCalled()
    expect(screen.getByRole('alert').textContent).toBe('OpenAI rejected this key. Check it and paste it again.')
  })

  it('continues at once with a verified key, and says so when the key could not be checked', async () => {
    expect(await saveKey(operations({ hostedProviders: hosted }))).toHaveBeenCalledOnce()
    cleanup()
    const onReady = await saveKey(operations({ hostedProviders: hosted, addApiKeyAccount: vi.fn(async () => ok({ verified: false })) }))
    expect(onReady).not.toHaveBeenCalled()
    expect(screen.getByRole('status').textContent).toContain('couldn’t check it with OpenAI')
    await click(screen.getByRole('button', { name: en['hosted.continue'] }))
    expect(onReady).toHaveBeenCalledOnce()
  })
})

describe('sign-in prompts', () => {
  it('submit a blank answer to a free-text question (GitHub Copilot: blank means github.com)', async () => {
    const view: SignInAttemptView = {
      id: 'a1' as never, provider: 'github-copilot', accountId: 'x', phase: 'running', notices: [],
      prompt: { id: 'p1', kind: 'text', message: 'GitHub Enterprise URL/domain (blank for github.com)' },
    }
    const answerSignInPrompt = vi.fn(async (..._args: unknown[]) => ok(undefined))
    const ops = operations({
      answerSignInPrompt,
      beginSignIn: vi.fn(async () => ok(view)),
      watchSignIn: vi.fn(async function* () { /* the attempt waits on the prompt */ }),
    })
    render(<SignInPanel provider="github-copilot" request={{ method: 'oauth' }} operations={ops} t={t} onAuthorized={vi.fn()} onCancel={vi.fn()} />)
    await settle()
    const submit = screen.getByRole('button', { name: en['signin.submit'] })
    expect((submit as HTMLButtonElement).disabled).toBe(false)
    await click(submit)
    expect(answerSignInPrompt).toHaveBeenCalledWith('a1', 'p1', { value: '' })
  })
})
