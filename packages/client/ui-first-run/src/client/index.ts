/**
 * First-run setup plugin, browser half: the `shell.overlay` dialog (provider,
 * default model, components) shown once per profile on the web and in the
 * desktop app, and its two on-demand entry points — "Choose components…" in
 * the Plugins page Add menu and "Set up a provider…" under Settings → Models.
 * Export discipline: packages/client/AGENTS.md.
 */
import type { Context } from '@deepseek-ai/cordis'
import type {} from '@deepseek-ai/dsh-api-remotes/client'
import type {} from '@deepseek-ai/dsh-client-locale/client'
import type {} from '@deepseek-ai/dsh-client-ui-renderer/client'
import type {} from '@deepseek-ai/dsh-client-ui-settings/client'
import type {} from '@deepseek-ai/dsh-client-ui-layout/client'
import type {} from '@deepseek-ai/dsh-client-ui-plugin-manager/client'
import type {} from '@deepseek-ai/dsh-client-ui-settings-models/client'
import { createComponentOperations } from './component-operations.ts'
import { ChooseComponentsMenuItem, SetUpProviderEntry } from './EntryPoints.tsx'
import { FirstRunOverlay } from './FirstRunOverlay.tsx'
import { createFlowStore, type FlowEntry } from './flow.ts'
import { de, en, es, fr, ja, NS, pt, ru, zh } from './locales.ts'
import { createFirstRunOperations } from './operations.ts'
import { FIRST_RUN_COMPLETED_FIELD, FIRST_RUN_SETTINGS_NAMESPACE, FIRST_RUN_VERSION } from '../settings.ts'
import type { FirstRunEntryInjected, FirstRunOverlayInjected, FirstRunSection } from './types.ts'

export type { FirstRunKey } from './locales.ts'
export type { FirstRunEntryInjected, FirstRunOverlayInjected } from './types.ts'

/** Required services: slots, copy, configuration forms, and the Remotes the steps call. */
export const inject = [
  'slots', 'locale', 'configForms', 'remote', 'remote.llm', 'remote.llmAccounts', 'remote.settings', 'remote.credentials',
  'remote.session', 'remote.pluginManager',
]

/**
 * Register the dictionaries, the overlay, and the two entry points.
 * @param ctx - client root context.
 */
export function apply(ctx: Context): void {
  ctx.effect(() => ctx.locale.register(NS, { zh, en, ja, es, fr, de, ru, pt }), 'ui-first-run: dictionaries')
  const flow = createFlowStore()
  const firstRun = ctx.configForms.get<FirstRunSection>(FIRST_RUN_SETTINGS_NAMESPACE)
  const open = (entry: FlowEntry): void => { flow.set({ entry, dismissed: flow.getSnapshot().dismissed }) }
  const overlay: FirstRunOverlayInjected = {
    hooks: { flow, firstRun },
    operations: createFirstRunOperations(ctx),
    components: createComponentOperations(ctx),
    close: (entry) => {
      flow.set({ entry: null, dismissed: true })
      if (entry !== 'first-run') return
      void firstRun.set(FIRST_RUN_COMPLETED_FIELD, FIRST_RUN_VERSION).catch((error: unknown) => {
        ctx.logger.warn('ui-first-run: the first-run completion was not stored: %s', error instanceof Error ? error.message : String(error))
      })
    },
  }
  const componentsEntry: FirstRunEntryInjected = { open: () => { open('components') } }
  const providerEntry: FirstRunEntryInjected = { open: () => { open('provider') } }

  ctx.slots.inject('shell.overlay', () => ctx.slots.register({
    name: 'shell.overlay', id: 'first-run', locale: NS, inject: () => overlay,
  }, FirstRunOverlay))
  ctx.slots.inject('plugins.add.actions', () => ctx.slots.register({
    name: 'plugins.add.actions', id: 'choose-components', locale: NS, inject: () => componentsEntry,
  }, ChooseComponentsMenuItem))
  ctx.slots.inject('settings.models.footer', () => ctx.slots.register({
    name: 'settings.models.footer', id: 'set-up-provider', locale: NS, inject: () => providerEntry,
  }, SetUpProviderEntry))
}
