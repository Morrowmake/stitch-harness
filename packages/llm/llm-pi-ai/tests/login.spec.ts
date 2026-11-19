import { describe, expect, it } from 'vitest'
import type { AuthorizationNotice, AuthorizationPrompt, AuthorizationSession } from '@deepseek-ai/dsh-authorization'
import type { AuthEvent, AuthPrompt } from '@earendil-works/pi-ai'
import { catalogProvider } from '../src/catalog.ts'
import { loginMethods, relay, restate } from '../src/login.ts'

/** A session recording every notice relayed to it. */
function session(): AuthorizationSession & { notices: AuthorizationNotice[] } {
  const notices: AuthorizationNotice[] = []
  return {
    notices,
    method: 'oauth',
    signal: new AbortController().signal,
    commit: () => Promise.resolve(),
    notify: (notice: AuthorizationNotice) => { notices.push(notice) },
    prompt: (_prompt: AuthorizationPrompt) => Promise.resolve(''),
  }
}

describe('pi-ai login helpers', () => {
  it('offers the methods each installed provider ships, OpenAI sign-in included', () => {
    const ids = (provider: string): string[] => loginMethods(catalogProvider(provider)).map(method => method.id)

    // The OAuth-only provider is exactly the case sign-in exists for.
    expect(loginMethods(catalogProvider('openai-codex')))
      .toEqual([{ id: 'oauth', label: expect.stringContaining('ChatGPT') as string }])
    // Both, the subscription login first.
    expect(ids('anthropic')).toEqual(['oauth', 'api-key'])
    // Sign in with ChatGPT is offered: its device id is per account (in that account's record).
    expect(catalogProvider('openai')?.auth.oauth?.loginLabel).toBe('Sign in with ChatGPT')
    expect(ids('openai')).toEqual(['oauth', 'api-key'])
    // A key-only provider keeps its interactive key login.
    expect(ids('groq')).toEqual(['api-key'])
    expect(loginMethods(undefined)).toEqual([])
  })

  it('restates every pi-ai login event in the neutral vocabulary', () => {
    const ui = session()
    const events: AuthEvent[] = [
      { type: 'info', message: 'Read this first', links: [{ url: 'https://help.example' }] },
      { type: 'info', message: 'Nothing to open' },
      { type: 'auth_url', url: 'https://auth.example/start', instructions: 'Approve in the tab' },
      { type: 'auth_url', url: 'https://auth.example/plain' },
      { type: 'device_code', userCode: 'WXYZ-1234', verificationUri: 'https://device.example' },
      { type: 'progress', message: 'Exchanging the code' },
      // pi-ai's event union is open; an unrecognised member still shows progress.
      { type: 'quantum-handshake' } as unknown as AuthEvent,
    ]
    for (const event of events) relay(event, ui)

    expect(ui.notices).toEqual([
      { message: 'Read this first', url: 'https://help.example' },
      { message: 'Nothing to open' },
      { message: 'Approve in the tab', url: 'https://auth.example/start' },
      { message: 'Open this page to continue signing in.', url: 'https://auth.example/plain' },
      {
        message: 'Enter this code on the verification page to finish signing in.',
        url: 'https://device.example',
        code: 'WXYZ-1234',
      },
      { message: 'Exchanging the code' },
      { message: 'Signing in…' },
    ])
  })

  it('restates every pi-ai prompt, carrying the per-prompt withdrawal signal', () => {
    const withdraw = new AbortController()
    const prompts: AuthPrompt[] = [
      { type: 'text', message: 'Your workspace', placeholder: 'acme' },
      { type: 'secret', message: 'Paste the key' },
      { type: 'secret', message: 'Paste the token', placeholder: 'sk-…' },
      { type: 'select', message: 'Which account?', options: [{ id: 'a', label: 'Work' }] },
      { type: 'manual_code', message: 'Paste the code', signal: withdraw.signal },
    ]

    expect(prompts.map(restate)).toEqual([
      { kind: 'text', message: 'Your workspace', placeholder: 'acme' },
      { kind: 'secret', message: 'Paste the key' },
      { kind: 'secret', message: 'Paste the token', placeholder: 'sk-…' },
      { kind: 'select', message: 'Which account?', options: [{ id: 'a', label: 'Work' }] },
      { kind: 'text', message: 'Paste the code', signal: withdraw.signal },
    ])
  })
})
