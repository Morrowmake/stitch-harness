/**
 * The component step's Host calls: the official component list joined with
 * each bundle's display meta and selection state from `pluginManager`, and
 * one batched switch of every changed bundle.
 */
import type { Context } from '@deepseek-ai/cordis'
import { COMPONENTS } from '@deepseek-ai/dsh-official-bundles'
import type { ComponentEntry } from './components.ts'
import { outcomeOf } from './operations.ts'
import type { ComponentOperations } from './types.ts'

/**
 * Bind the component operations to the plugin's `pluginManager` namespace.
 * @param ctx - the plugin context, which declares `remote.pluginManager` and `locale` in its `inject`.
 * @returns the callbacks the component step is injected with.
 */
export function createComponentOperations(ctx: Context): ComponentOperations {
  const manager = ctx.remote.pluginManager
  return {
    list: async () => {
      const response = outcomeOf(await manager.listBundles())
      if (!response.ok) return response
      const bundles = new Map(response.value.map(bundle => [bundle.name, bundle]))
      const byId = new Map(COMPONENTS.map(component => [component.id, component]))
      const entries: ComponentEntry[] = []
      for (const component of COMPONENTS) {
        const bundle = bundles.get(component.packageName)
        // A component the installation does not ship cannot be switched; the picker leaves it out.
        if (bundle === undefined || bundle.availability === 'missing') continue
        const meta = bundle.meta
        entries.push({
          id: component.id,
          bundle: component.packageName,
          title: meta?.title === undefined ? component.id : ctx.locale.resolveText(meta.title),
          description: meta?.description === undefined ? '' : ctx.locale.resolveText(meta.description),
          ...meta?.icon === undefined ? {} : { icon: meta.icon },
          requires: component.requires.filter(id => byId.has(id)),
          standard: component.standard,
          enabled: bundle.enabled,
        })
      }
      return { ok: true, value: entries }
    },
    apply: async (changes) => {
      const response = outcomeOf(await manager.setBundlesEnabled({ ...changes }))
      if (!response.ok) return response
      const result = response.value
      if (result.application === 'failed' || result.application === 'cancelled' || result.application === 'overridden') {
        // `refusalText` localizes the management code (or the outcome) and falls back to the Host's diagnostic.
        return { ok: false, code: `plugin-manager/${result.error?.code ?? result.application}`, message: result.error?.diagnostic ?? '' }
      }
      return { ok: true, value: { restartRequired: result.application === 'restart-required' } }
    },
  }
}
