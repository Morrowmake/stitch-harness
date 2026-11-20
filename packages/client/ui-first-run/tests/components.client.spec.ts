/**
 * Component selection rules (sets, prerequisite ticks, changed bundles), first-run visibility, and the plugin's
 * registrations: the overlay, the Plugins menu item, and the Models footer entry share one open state, and closing
 * the automatic first run stores its completion.
 */
import { describe, expect, it, vi } from 'vitest'
import {
  bundleChanges, currentSelection, presetSelection, selectionPreset, toggleComponent, type ComponentEntry,
} from '../src/client/components.ts'
import { ChooseComponentsMenuItem, SetUpProviderEntry } from '../src/client/EntryPoints.tsx'
import { FirstRunOverlay, stepsOf } from '../src/client/FirstRunOverlay.tsx'
import { createFlowStore, visibleEntry } from '../src/client/flow.ts'
import { apply, inject } from '../src/client/index.ts'
import { de, en, es, fr, ja, NS, pt, ru, zh } from '../src/client/locales.ts'
import type { FirstRunEntryInjected, FirstRunOverlayInjected, FirstRunUi } from '../src/client/types.ts'
import { FIRST_RUN_SETTINGS_NAMESPACE, FIRST_RUN_VERSION, WELCOME_SETTINGS_NAMESPACE } from '../src/settings.ts'

function entry(id: string, sets: { standard: boolean }, enabled: boolean, requires: string[] = []): ComponentEntry {
  return { id, bundle: `pkg-${id}`, title: id, description: '', requires, enabled, ...sets }
}

const LIST = [
  entry('files', { standard: true }, true),
  entry('web', { standard: true }, true),
  entry('subagents', { standard: true }, true),
  entry('agent-teams', { standard: true }, true, ['subagents']),
  entry('workflows', { standard: true }, true, ['subagents']),
  entry('short-prompt', { standard: false }, false),
]

describe('component selection', () => {
  it('names the Standard set and the current state', () => {
    expect([...presetSelection(LIST, 'standard')]).toEqual(['files', 'web', 'subagents', 'agent-teams', 'workflows'])
    expect(selectionPreset(LIST, currentSelection(LIST))).toBe('standard')
    expect(selectionPreset(LIST, new Set(['files']))).toBe('custom')
    expect(selectionPreset(LIST, new Set())).toBe('custom')
  })

  it('ticks prerequisites with a dependent and unticks dependents with a prerequisite', () => {
    expect([...toggleComponent(LIST, new Set(), 'agent-teams', true)].sort()).toEqual(['agent-teams', 'subagents'])
    const standard = presetSelection(LIST, 'standard')
    expect([...toggleComponent(LIST, standard, 'subagents', false)]).toEqual(['files', 'web'])
    expect([...toggleComponent(LIST, standard, 'workflows', false)]).toEqual(['files', 'web', 'subagents', 'agent-teams'])
    expect([...toggleComponent(LIST, new Set(['files']), 'files', false)]).toEqual([])
    expect([...toggleComponent(LIST, new Set(), 'missing', false)]).toEqual([])
  })

  it('switches only the bundles a selection changes', () => {
    expect(bundleChanges(LIST, presetSelection(LIST, 'standard'))).toEqual({})
    expect(bundleChanges(LIST, new Set(['short-prompt']))).toEqual({
      'pkg-files': false, 'pkg-web': false, 'pkg-subagents': false, 'pkg-agent-teams': false, 'pkg-workflows': false, 'pkg-short-prompt': true,
    })
  })
})

describe('flow', () => {
  it('opens the first run once while pending, and the on-demand entries whenever asked', () => {
    expect(visibleEntry({ entry: null, dismissed: false }, true)).toBe('first-run')
    expect(visibleEntry({ entry: null, dismissed: true }, true)).toBeNull()
    expect(visibleEntry({ entry: null, dismissed: false }, false)).toBeNull()
    expect(visibleEntry({ entry: 'components', dismissed: true }, false)).toBe('components')
    expect(stepsOf('first-run')).toEqual(['provider', 'model', 'components', 'done'])
    expect(stepsOf('provider')).toEqual(['provider', 'model', 'done'])
    expect(stepsOf('components')).toEqual(['components', 'done'])
    expect(createFlowStore().getSnapshot()).toEqual({ entry: null, dismissed: false })
  })
})

describe('locales', () => {
  it('translate every key in all eight languages', () => {
    for (const dictionary of [zh, ja, es, fr, de, ru, pt]) {
      expect(Object.keys(dictionary).sort()).toEqual(Object.keys(en).sort())
      for (const value of Object.values(dictionary)) expect(value.length).toBeGreaterThan(0)
    }
  })
})

interface Registration {
  readonly options: { name: string; id?: string; locale?: string; inject: () => unknown }
  readonly component: unknown
}

function fakeContext() {
  const registrations: Registration[] = []
  const formSet = vi.fn(async () => true)
  const provide = vi.fn()
  const ctx = {
    provide,
    effect: (body: () => unknown) => { body() },
    logger: { warn: vi.fn() },
    locale: { register: vi.fn(() => () => {}), resolveText: (text: string) => text },
    remote: { llmAccounts: {}, llm: {}, settings: {}, credentials: {}, session: {}, pluginManager: {} },
    configForms: { get: vi.fn(() => ({ getSnapshot: () => ({ status: 'loading' }), subscribe: () => () => {}, set: formSet })) },
    slots: {
      inject: (_name: string, body: () => unknown) => body(),
      register: (options: Registration['options'], component: unknown) => { registrations.push({ options, component }); return () => {} },
    },
  }
  return { ctx, registrations, formSet, provide }
}

describe('apply', () => {
  it('declares the services it uses', () => {
    expect(inject).toEqual([
      'slots', 'locale', 'configForms', 'remote', 'remote.llm', 'remote.llmAccounts', 'remote.settings', 'remote.credentials',
      'remote.session', 'remote.pluginManager',
    ])
  })

  it('registers the overlay and both entry points over one open state', () => {
    const { ctx, registrations, formSet, provide } = fakeContext()
    apply(ctx as never)
    expect(ctx.locale.register).toHaveBeenCalledWith(NS, expect.objectContaining({ en, zh }))
    expect(ctx.configForms.get).toHaveBeenCalledWith(FIRST_RUN_SETTINGS_NAMESPACE)
    expect(ctx.configForms.get).toHaveBeenCalledWith(WELCOME_SETTINGS_NAMESPACE)
    expect(registrations.map(({ options, component }) => [options.name, options.id, options.locale, component])).toEqual([
      ['shell.overlay', 'first-run', NS, FirstRunOverlay],
      ['plugins.add.actions', 'choose-components', NS, ChooseComponentsMenuItem],
      ['settings.models.footer', 'set-up-provider', NS, SetUpProviderEntry],
    ])
    const overlay = registrations[0]!.options.inject() as FirstRunOverlayInjected
    const components = registrations[1]!.options.inject() as FirstRunEntryInjected
    const provider = registrations[2]!.options.inject() as FirstRunEntryInjected
    components.open()
    expect(overlay.hooks.flow.getSnapshot()).toEqual({ entry: 'components', dismissed: false })
    overlay.close('components')
    expect(formSet).not.toHaveBeenCalled()
    provider.open()
    expect(overlay.hooks.flow.getSnapshot()).toEqual({ entry: 'provider', dismissed: true })
    overlay.close('first-run')
    expect(formSet).toHaveBeenCalledWith('completedVersion', FIRST_RUN_VERSION)
    expect(overlay.hooks.flow.getSnapshot()).toEqual({ entry: null, dismissed: true })
    expect(provide).toHaveBeenCalledWith('firstRunUi', expect.anything())
    ;(provide.mock.calls[0]![1] as FirstRunUi).openProvider()
    expect(overlay.hooks.flow.getSnapshot()).toEqual({ entry: 'provider', dismissed: true })
  })

  it('logs a completion that could not be stored', async () => {
    const { ctx, registrations, formSet } = fakeContext()
    formSet.mockRejectedValueOnce(new Error('offline'))
    apply(ctx as never)
    ;(registrations[0]!.options.inject() as FirstRunOverlayInjected).close('first-run')
    await vi.waitFor(() => { expect(ctx.logger.warn).toHaveBeenCalled() })
  })
})
