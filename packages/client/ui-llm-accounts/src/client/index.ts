/**
 * Provider accounts plugin, browser half: the Accounts section inside every pi-ai provider card on the Models page,
 * and the composer usage badge of each Session. Both read one reference-counted `llmAccounts.watch` subscription per
 * observer and write only through the `llmAccounts` Remote.
 * Export discipline: packages/client/AGENTS.md.
 */
import type { Context } from '@deepseek-ai/cordis'
import type {} from '@deepseek-ai/dsh-api-remotes/client'
import type {} from '@deepseek-ai/dsh-client-locale/client'
import type {} from '@deepseek-ai/dsh-client-ui-renderer/client'
import type {} from '@deepseek-ai/dsh-client-ui-settings-models/client'
import type {} from '@deepseek-ai/dsh-client-ui-conversation/client'
import type {} from '@deepseek-ai/dsh-client-ui-model-selection/client'
import { AccountsSection } from './AccountsSection.tsx'
import { de, en, es, fr, ja, NS, pt, ru, zh } from './locales.ts'
import { createAccountsOperations } from './operations.ts'
import { AccountsWatcher } from './store.ts'
import type { AccountsSectionInjected, UsageBadgeInjected } from './types.ts'
import { UsageBadge } from './UsageBadge.tsx'

export type { LlmAccountsKey } from './locales.ts'
export type { AccountsOperations, CatalogModel, Outcome } from './operations.ts'
export type { AccountsState } from './store.ts'
export type { AccountsSectionInjected, UsageBadgeInjected } from './types.ts'

/** Settings namespace of the pi-ai adapter family; the provider-card seat dispatches by it. */
export const PI_AI_SETTINGS_NS = 'llm-pi-ai'

/** Required services: the Remotes this plugin calls, the slot ledger, and the locale runtime. */
export const inject = ['slots', 'locale', 'remote', 'remote.llmAccounts', 'remote.session']

/**
 * Register the provider-card section and, when the model-selection service is present, the composer badge.
 * @param ctx - client root context.
 */
export function apply(ctx: Context): void {
  ctx.effect(() => ctx.locale.register(NS, { zh, en, ja, es, fr, de, ru, pt }), 'ui-llm-accounts: dictionaries')
  const operations = createAccountsOperations(ctx)
  const watcher = new AccountsWatcher(ctx, (opts, signal) => ctx.remote.llmAccounts.watch(opts, signal))
  ctx.effect(() => async () => { await watcher.dispose() }, 'ui-llm-accounts: streams')

  const section: AccountsSectionInjected = {
    hooks: { accounts: watcher.view() },
    acquire: () => watcher.acquire(),
    operations,
  }
  ctx.effect(() => ctx.slots.inject('settings.models.provider-card', () => ctx.slots.register({
    name: 'settings.models.provider-card', key: PI_AI_SETTINGS_NS, locale: NS, inject: () => section,
  }, AccountsSection)), 'ui-llm-accounts: provider card')

  ctx.inject(['modelDirectories'], (scope: Context) => {
    // Keyed by the Session's directory, which the model-selection service drops with the Session scope: a face is
    // stable while its Session lives (so the badge keeps one subscription) and is collected afterwards.
    const faces = new WeakMap<object, UsageBadgeInjected>()
    scope.effect(() => scope.slots.inject('conversation.composer.dock', () => scope.slots.register({
      name: 'conversation.composer.dock', id: 'llm-accounts.usage', order: 2, locale: NS,
      inject: (sessionId): UsageBadgeInjected => {
        const directory = scope.modelDirectories.directoryFor(sessionId)
        let face = faces.get(directory)
        if (face === undefined) {
          face = {
            hooks: { accounts: watcher.view(sessionId), selection: directory.store },
            acquire: () => watcher.acquire(sessionId),
            operations,
          }
          faces.set(directory, face)
        }
        return face
      },
    }, UsageBadge)), 'ui-llm-accounts: usage badge')
  })
}
