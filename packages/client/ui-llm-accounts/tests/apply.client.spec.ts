/**
 * The plugin registers the Accounts section under the pi-ai provider-card key and, with the model-selection service,
 * one composer badge whose per-Session face is stable for the Session's directory.
 */
import { expect, it, vi } from 'vitest'
import { AccountsSection } from '../src/client/AccountsSection.tsx'
import { apply, inject, PI_AI_SETTINGS_NS } from '../src/client/index.ts'
import { NS } from '../src/client/locales.ts'
import { UsageBadge } from '../src/client/UsageBadge.tsx'

interface Registration {
  readonly options: { name: string; key?: string; id?: string; locale?: string; inject: (sessionId?: string) => unknown }
  readonly component: unknown
}

function fakeContext() {
  const registrations: Registration[] = []
  const directories = new Map<string, { store: object }>()
  const ctx = {
    effect: (body: () => unknown) => { body() },
    locale: { register: vi.fn(() => () => {}) },
    remote: { llmAccounts: { watch: vi.fn() }, session: {} },
    slots: {
      inject: (_name: string, body: () => unknown) => body(),
      register: (options: Registration['options'], component: unknown) => { registrations.push({ options, component }); return () => {} },
    },
    modelDirectories: {
      directoryFor: (sessionId: string) => {
        let directory = directories.get(sessionId)
        if (directory === undefined) directories.set(sessionId, directory = { store: { sessionId } })
        return directory
      },
    },
    inject: (_deps: string[], body: (scope: unknown) => void) => { body(ctx) },
  }
  return { ctx, registrations }
}

it('declares the Remotes it calls', () => {
  expect(inject).toEqual(['slots', 'locale', 'remote', 'remote.llmAccounts', 'remote.session'])
})

it('registers the provider-card section and the composer badge', () => {
  const { ctx, registrations } = fakeContext()
  apply(ctx as never)
  expect(ctx.locale.register).toHaveBeenCalledWith(
    NS,
    expect.objectContaining({ en: expect.any(Object) as object, zh: expect.any(Object) as object }),
  )
  const [card, badge] = registrations
  expect(card?.options).toMatchObject({ name: 'settings.models.provider-card', key: PI_AI_SETTINGS_NS, locale: NS })
  expect(card?.component).toBe(AccountsSection)
  expect(badge?.options).toMatchObject({ name: 'conversation.composer.dock', id: 'llm-accounts.usage', locale: NS })
  expect(badge?.component).toBe(UsageBadge)
  const first = badge!.options.inject('s1') as { hooks: { selection: object } }
  expect(badge!.options.inject('s1')).toBe(first)
  expect(first.hooks.selection).toEqual({ sessionId: 's1' })
  expect(badge!.options.inject('s2')).not.toBe(first)
})
