/** Wire fixtures shared by the client specs. */
import { vi, type Mock } from 'vitest'
import type {
  AccountView, AccountsSnapshot, ProviderAccountsView, SignInAttemptId, UsageSnapshotView,
} from '@deepseek-ai/dsh-api-remotes/client'
import type { AccountsOperations } from '../src/client/operations.ts'

export const HOUR = 3_600_000

export function usage(extra: Partial<UsageSnapshotView> = {}): UsageSnapshotView {
  return {
    supported: true, source: 'endpoint', fetchedAt: Date.now(),
    windows: [
      { kind: 'session', usedPercent: 42, durationMs: 5 * HOUR, resetsAt: Date.now() + 2 * HOUR + 5 * 60_000 },
      { kind: 'weekly', usedPercent: 12 },
    ],
    ...extra,
  }
}

export function account(id: string, extra: Partial<AccountView> = {}): AccountView {
  return {
    id, provider: 'openai-codex', kind: 'oauth', label: `Account ${id}`, isDefault: false,
    pooled: true, pinned: false, removable: true, health: { state: 'ok' }, ...extra,
  }
}

export function provider(accounts: readonly AccountView[], extra: Partial<ProviderAccountsView> = {}): ProviderAccountsView {
  return {
    // The Host passes the adapter's login label through as-is, which already reads "Sign in with …".
    provider: 'openai-codex', displayName: 'ChatGPT', oauth: { label: 'Sign in with ChatGPT' }, apiKey: { interactive: false },
    accounts, ...extra,
  }
}

export function snapshot(...providers: ProviderAccountsView[]): AccountsSnapshot {
  return { revision: 1, providers }
}

export const ATTEMPT = 'attempt-1' as SignInAttemptId

/** Operations whose every call succeeds unless a test overrides it. */
export function operations(): { [K in keyof AccountsOperations]: Mock<AccountsOperations[K]> } {
  const done = async () => ({ ok: true as const, value: undefined })
  return {
    beginSignIn: vi.fn(async (provider: string) => ({
      ok: true as const, value: { id: ATTEMPT, provider, accountId: 'k3j9x0a1bc', phase: 'running' as const, notices: [] },
    })),
    watchSignIn: vi.fn(() => ({ async *[Symbol.asyncIterator]() {} })),
    answerSignInPrompt: vi.fn(done),
    cancelSignIn: vi.fn(done),
    addApiKeyAccount: vi.fn(async (provider: string) => ({
      ok: true as const,
      value: { account: account('newkey123', { provider, kind: 'api-key' }), check: { status: 'verified' as const } },
    })),
    updateAccount: vi.fn(async (provider: string, id: string) => ({ ok: true as const, value: account(id, { provider }) })),
    setDefaultAccount: vi.fn(done),
    removeAccount: vi.fn(done),
    retryAccountNow: vi.fn(async () => ({ ok: true as const, value: { status: 'cleared' as const } })),
    refreshUsage: vi.fn(async () => ({ ok: true as const, value: usage() })),
    catalogModels: vi.fn(async () => ({ ok: true as const, value: [{ id: 'gpt-5.1', name: 'GPT-5.1' }, { id: 'gpt-5.1-mini', name: 'GPT-5.1 mini' }] })),
  }
}
