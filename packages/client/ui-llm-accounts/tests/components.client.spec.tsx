// @vitest-environment jsdom
/**
 * The account surfaces: row actions call the matching Remote operation, the sign-in dialog renders links, device codes,
 * and prompts, the allowlist editor writes follow-all / explicit / none, and the badge follows the serving account and
 * subscribes only while the document is visible.
 */
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { makeTranslate } from '@deepseek-ai/dsh-client-test-runtime'
import type { AccountsSnapshot, SignInAttemptView } from '@deepseek-ai/dsh-api-remotes/client'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { AccountsSection } from '../src/client/AccountsSection.tsx'
import { en } from '../src/client/locales.ts'
import { ModelsDialog } from '../src/client/ModelsDialog.tsx'
import { SignInDialog } from '../src/client/SignInDialog.tsx'
import type { AccountsState } from '../src/client/store.ts'
import { MODE_STORAGE_KEY, UsageBadge } from '../src/client/UsageBadge.tsx'
import { account, ATTEMPT, operations, provider, snapshot, usage } from './fixtures.client.ts'

afterEach(() => {
  cleanup()
  localStorage.clear()
})

const t = makeTranslate(en)
const click = async (element: HTMLElement) => { await act(async () => { fireEvent.click(element) }) }

function useStore<S>(value: S) {
  return <R,>(selector: (state: S) => R): R => selector(value)
}

function section(state: AccountsState, ops = operations()) {
  const release = vi.fn()
  const acquire = vi.fn(() => release)
  const props = {
    provider: { provider: 'openai-codex' } as never,
    useAccounts: useStore(state), acquire, operations: ops, t,
  }
  return { props, ops, acquire, release }
}

describe('AccountsSection', () => {
  const rows = snapshot(provider([
    account('main', { alias: 'Personal', isDefault: true, usage: usage() }),
    account('k3j9x0a1bc', { kind: 'api-key', label: 'Key 2', health: { state: 'cooling', until: Date.now() + 12 * 60_000, reason: 'RATE_LIMIT', scope: 'account' } }),
    account('env', { kind: 'key-ref', label: 'OPENAI_API_KEY', removable: false }),
  ]))

  it('holds the usage subscription while mounted and renders nothing for routes without accounts', () => {
    const { props, acquire, release } = section({ snapshot: snapshot(), linked: true })
    const { container, unmount } = render(<AccountsSection {...props} />)
    expect(container.innerHTML).toBe('')
    expect(acquire).toHaveBeenCalledOnce()
    unmount()
    expect(release).toHaveBeenCalledOnce()
  })

  it('lists accounts and routes each row action to its Remote operation', async () => {
    const { props, ops } = section({ snapshot: rows, linked: true })
    render(<AccountsSection {...props} />)
    const main = screen.getByText('Personal').closest('li')!
    const key = screen.getByText('Key 2').closest('li')!
    const env = screen.getByText('OPENAI_API_KEY').closest('li')!
    expect(within(main).getByText('Default')).toBeTruthy()
    expect(within(main).getByText('Session')).toBeTruthy()
    expect(within(key).getByText(/Cooling down · recovers in 12m/)).toBeTruthy()
    expect(within(env).getByText('Uses the API key field above; edit it there.')).toBeTruthy()
    expect(within(env).queryByRole('button', { name: 'Remove' })).toBeNull()

    await click(within(key).getByRole('button', { name: 'Make default' }))
    expect(ops.setDefaultAccount).toHaveBeenCalledWith('openai-codex', 'k3j9x0a1bc')
    await click(within(key).getByRole('switch', { name: 'Use in pool' }))
    expect(ops.updateAccount).toHaveBeenLastCalledWith('openai-codex', 'k3j9x0a1bc', { pooled: false })
    await click(within(main).getByRole('switch', { name: 'Show in model picker' }))
    expect(ops.updateAccount).toHaveBeenLastCalledWith('openai-codex', 'main', { pinned: true })
    await click(within(key).getByRole('button', { name: 'Retry now' }))
    expect(ops.retryAccountNow).toHaveBeenCalledWith('openai-codex', 'k3j9x0a1bc')
    await click(within(main).getByRole('button', { name: 'Refresh usage' }))
    expect(ops.refreshUsage).toHaveBeenCalledWith('openai-codex', 'main')

    await click(within(key).getByRole('button', { name: 'Remove' }))
    await click(within(screen.getByRole('dialog')).getByRole('button', { name: 'Remove' }))
    expect(ops.removeAccount).toHaveBeenCalledWith('openai-codex', 'k3j9x0a1bc')

    await click(within(main).getByRole('button', { name: 'Rename' }))
    const input = within(screen.getByRole('dialog')).getByRole('textbox')
    fireEvent.change(input, { target: { value: '  ' } })
    await click(within(screen.getByRole('dialog')).getByRole('button', { name: 'Save' }))
    expect(ops.updateAccount).toHaveBeenLastCalledWith('openai-codex', 'main', { alias: null })
  })

  it('shows a failed sign-in refresh with the Sign in again action', async () => {
    const failed = snapshot(provider([
      account('main', { isDefault: true, health: { state: 'cooling', until: Date.now() + 60_000, reason: 'REFRESH_FAILED', scope: 'account' } }),
    ]))
    const { props, ops } = section({ snapshot: failed, linked: true })
    render(<AccountsSection {...props} />)
    expect(screen.getByText(en['health.refreshFailed'])).toBeTruthy()
    expect(screen.queryByText(/Cooling down/)).toBeNull()
    await click(screen.getByRole('button', { name: 'Sign in again' }))
    expect(ops.beginSignIn).toHaveBeenCalledWith('openai-codex', { method: 'oauth', accountId: 'main' })
  })

  it('shows the Host refusal of a failed action', async () => {
    const ops = operations()
    ops.setDefaultAccount.mockResolvedValue({ ok: false, reason: 'other', message: 'settings are read-only' })
    const { props } = section({ snapshot: rows, linked: true }, ops)
    render(<AccountsSection {...props} />)
    await click(screen.getAllByRole('button', { name: 'Make default' })[0]!)
    expect(screen.getByRole('alert').textContent).toBe('The action did not finish: settings are read-only')
  })

  it('adds a simple API key through addApiKeyAccount and an interactive one through a sign-in attempt', async () => {
    const { props, ops } = section({ snapshot: rows, linked: true })
    const { rerender } = render(<AccountsSection {...props} />)
    await click(screen.getByRole('button', { name: 'Add API key' }))
    const dialog = screen.getByRole('dialog')
    fireEvent.change(dialog.querySelector('input[type="password"]')!, { target: { value: ' sk-test ' } })
    await click(within(dialog).getByRole('button', { name: 'Add' }))
    expect(ops.addApiKeyAccount).toHaveBeenCalledWith('openai-codex', { key: 'sk-test' })
    await waitFor(() => { expect(screen.queryByRole('dialog')).toBeNull() })

    const interactive = snapshot(provider(rows.providers[0]!.accounts, { apiKey: { interactive: true } }))
    rerender(<AccountsSection {...props} useAccounts={useStore({ snapshot: interactive, linked: true })} />)
    await click(screen.getByRole('button', { name: 'Add API key' }))
    expect(ops.beginSignIn).toHaveBeenCalledWith('openai-codex', { method: 'api-key' })
  })

  it('starts OAuth sign-in for a new account and re-sign-in for an existing one', async () => {
    const { props, ops } = section({ snapshot: rows, linked: true })
    render(<AccountsSection {...props} />)
    await click(screen.getByRole('button', { name: 'Sign in with ChatGPT' }))
    expect(ops.beginSignIn).toHaveBeenLastCalledWith('openai-codex', { method: 'oauth' })
    await click(within(screen.getByRole('dialog')).getByRole('button', { name: 'Cancel' }))
    expect(ops.cancelSignIn).toHaveBeenCalledWith(ATTEMPT)
    await click(within(screen.getByText('Personal').closest('li')!).getByRole('button', { name: 'Sign in again' }))
    expect(ops.beginSignIn).toHaveBeenLastCalledWith('openai-codex', { method: 'oauth', accountId: 'main' })
  })
})

describe('SignInDialog', () => {
  function attempt(extra: Partial<SignInAttemptView>): SignInAttemptView {
    return { id: ATTEMPT, provider: 'openai', accountId: 'k3j9x0a1bc', phase: 'running', notices: [], ...extra }
  }

  it('opens the provider link once, shows the device code, answers the prompt, and closes when authorized', async () => {
    const open = vi.spyOn(window, 'open').mockReturnValue(null)
    const ops = operations()
    let push!: (view: SignInAttemptView) => void
    let finish!: () => void
    ops.watchSignIn.mockImplementation(() => ({
      async *[Symbol.asyncIterator]() {
        for (;;) {
          const { promise, resolve } = Promise.withResolvers<SignInAttemptView | undefined>()
          push = resolve
          finish = () => { resolve(undefined) }
          const next = await promise
          if (next === undefined) return
          yield next
        }
      },
    }))
    const notice = { message: 'Enter the code on the page', url: 'https://auth.openai.com/device', code: 'ABCD-1234' }
    ops.beginSignIn.mockResolvedValue({ ok: true, value: attempt({ notices: [notice] }) })
    const onClose = vi.fn()
    render(<SignInDialog provider="openai" displayName="OpenAI" request={{ method: 'oauth' }} operations={ops} t={t} onClose={onClose} />)
    await waitFor(() => { expect(screen.getByText('ABCD-1234')).toBeTruthy() })
    expect(open).toHaveBeenCalledExactlyOnceWith('https://auth.openai.com/device', '_blank', 'noopener,noreferrer')

    await act(async () => {
      push(attempt({ notices: [notice], prompt: { id: 'p1', kind: 'manual_code', message: 'Paste the redirect URL' } }))
    })
    expect(open).toHaveBeenCalledOnce()
    fireEvent.change(screen.getByRole('textbox'), { target: { value: 'http://127.0.0.1:1455/cb?code=x' } })
    await click(screen.getByRole('button', { name: 'Submit' }))
    expect(ops.answerSignInPrompt).toHaveBeenCalledWith(ATTEMPT, 'p1', { value: 'http://127.0.0.1:1455/cb?code=x' })

    await act(async () => { push(attempt({ phase: 'authorized' })) })
    expect(onClose).toHaveBeenCalled()
    finish()
    open.mockRestore()
  })

  it('shows a busy refusal and a failed attempt', async () => {
    const ops = operations()
    ops.beginSignIn.mockResolvedValueOnce({ ok: false, reason: 'busy', message: 'busy' })
    const { unmount } = render(<SignInDialog provider="openai" displayName="OpenAI" request={{ method: 'oauth' }} operations={ops} t={t} onClose={vi.fn()} />)
    await waitFor(() => { expect(screen.getByRole('alert').textContent).toBe(en['signin.busy']) })
    unmount()
    ops.beginSignIn.mockResolvedValueOnce({ ok: true, value: attempt({ phase: 'failed', error: 'EADDRINUSE 127.0.0.1:1455' }) })
    render(<SignInDialog provider="openai" displayName="OpenAI" request={{ method: 'oauth' }} operations={ops} t={t} onClose={vi.fn()} />)
    await waitFor(() => { expect(screen.getByRole('alert').textContent).toBe('Sign-in failed: EADDRINUSE 127.0.0.1:1455') })
  })
})

describe('ModelsDialog', () => {
  const render3 = (models: readonly string[] | undefined) => {
    const ops = operations()
    const onClose = vi.fn()
    render(<ModelsDialog account={account('main', { ...models === undefined ? {} : { models } })} operations={ops} t={t} onClose={onClose} />)
    return { ops, onClose }
  }

  it('saves follow-all as a cleared list', async () => {
    const { ops } = render3(['gpt-5.1'])
    await click(screen.getByRole('tab', { name: en['models.follow'] }))
    await click(screen.getByRole('button', { name: 'Save' }))
    expect(ops.updateAccount).toHaveBeenCalledWith('openai-codex', 'main', { models: null })
  })

  it('saves an explicit selection and an empty one, keeping ids the catalog dropped', async () => {
    const { ops } = render3(['retired-model'])
    await waitFor(() => { expect(screen.getByText('GPT-5.1')).toBeTruthy() })
    expect(screen.getByText('retired-model')).toBeTruthy()
    await click(screen.getByRole('checkbox', { name: 'GPT-5.1' }))
    await click(screen.getByRole('button', { name: 'Save' }))
    expect(ops.updateAccount).toHaveBeenLastCalledWith('openai-codex', 'main', { models: ['retired-model', 'gpt-5.1'] })
    await click(screen.getByRole('checkbox', { name: 'GPT-5.1' }))
    await click(screen.getByRole('checkbox', { name: 'retired-model' }))
    await click(screen.getByRole('button', { name: 'Save' }))
    expect(ops.updateAccount).toHaveBeenLastCalledWith('openai-codex', 'main', { models: [] })
  })
})

describe('UsageBadge', () => {
  function badge(state: AccountsSnapshot | undefined, current = 'openai-codex') {
    const release = vi.fn()
    const acquire = vi.fn(() => release)
    const props = {
      useAccounts: useStore<AccountsState>({ snapshot: state, linked: true }),
      useSelection: useStore({ current: { provider: current, model: 'gpt-5.1' } } as never),
      acquire, operations: operations(), t,
    }
    return { props, acquire, release }
  }

  it('renders nothing without readings', () => {
    const { props } = badge(snapshot(provider([account('main')])))
    const { container } = render(<UsageBadge {...props} />)
    expect(container.innerHTML).toBe('')
  })

  it('shows the serving account window and switches to the left share from the dialog', async () => {
    const state = snapshot(provider([
      account('main', { isDefault: true, usage: usage({ windows: [{ kind: 'session', usedPercent: 10 }] }) }),
      account('k3j9x0a1bc', { usage: usage({ windows: [{ kind: 'weekly', usedPercent: 42 }] }) }),
    ], { serving: 'k3j9x0a1bc' }))
    const { props } = badge(state)
    render(<UsageBadge {...props} />)
    const pill = screen.getByRole('button', { name: 'ChatGPT · Weekly 42%' })
    await click(pill)
    await click(screen.getByRole('tab', { name: 'Left' }))
    expect(localStorage.getItem(MODE_STORAGE_KEY)).toBe('left')
    expect(screen.getByRole('button', { name: 'ChatGPT · Weekly 58%' })).toBeTruthy()
    expect(within(screen.getByRole('dialog')).getByText('In use')).toBeTruthy()
  })

  it('holds the subscription only while the document is visible', () => {
    const { props, acquire, release } = badge(undefined)
    let visibility = 'visible'
    const spy = vi.spyOn(document, 'visibilityState', 'get').mockImplementation(() => visibility as DocumentVisibilityState)
    const { unmount } = render(<UsageBadge {...props} />)
    expect(acquire).toHaveBeenCalledOnce()
    visibility = 'hidden'
    fireEvent(document, new Event('visibilitychange'))
    expect(release).toHaveBeenCalledOnce()
    visibility = 'visible'
    fireEvent(document, new Event('visibilitychange'))
    expect(acquire).toHaveBeenCalledTimes(2)
    unmount()
    expect(release).toHaveBeenCalledTimes(2)
    spy.mockRestore()
  })
})
