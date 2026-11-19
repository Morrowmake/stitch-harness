// @vitest-environment jsdom
/** The web search and fetch page as the Plugins page renders it: two provider menus and keyless search's SearXNG address. */

import { act, cleanup, fireEvent, render, screen, within } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { bindSnapshotSelector } from '@deepseek-ai/dsh-client-test-runtime'
import { createSnapshotStore } from '@deepseek-ai/dsh-client-store'
import type { SettingsFieldState, SettingsFormShell } from '@deepseek-ai/dsh-client-ui-primitives'
import { WebSearchCard, type WebSearchCardProps } from '../src/client/WebSearchCard.tsx'
import type { WebSearchCardState } from '../src/client/web-search-card-controller.ts'
import { de, en, es, fr, ja, pt, ru, zh } from '../src/client/locales.ts'

afterEach(cleanup)

const t = ((key: keyof typeof en, params?: Record<string, unknown>) =>
  en[key].replace(/\{(\w+)\}/g, (match, name: string) => params !== undefined && name in params ? String(params[name]) : match)) as WebSearchCardProps['t']

const settled: SettingsFormShell = { available: true, writable: true, dirty: false, invalid: false, saving: false, failed: false }

function field(text: string, rest: Partial<SettingsFieldState> = {}): SettingsFieldState {
  return { text, overridden: false, invalid: false, ...rest }
}

/** The locale service's resolution, with English active. */
const resolveText = vi.fn((text: string | { en: string; [locale: string]: string }) => typeof text === 'string' ? text : text.en)

/** The shipped selection: keyless search with anonymous HTTP fetch. */
function shipped(): WebSearchCardState {
  return {
    ...settled,
    selectionBlocked: false,
    providersFailed: false,
    search: { selected: 'keyless', kind: 'keyless', auto: false,
      options: [{ id: 'keyless', description: { en: 'Keyless description.' }, missing: false }] },
    fetch: { selected: 'http', kind: 'http', auto: false, options: [{ id: 'http', missing: false }] },
    searxngUrl: field(''),
    searxngActive: false,
  }
}

function renderPage(state: WebSearchCardState = shipped(), view: 'page' | 'summary' = 'page') {
  const store = createSnapshotStore<WebSearchCardState>(state)
  const actions = { edit: vi.fn(), resetField: vi.fn(), selectProvider: vi.fn(), retryProviders: vi.fn(), save: vi.fn(), discard: vi.fn() }
  const props = { ...actions, view, t, resolveText, useWebSearchCard: bindSnapshotSelector(store) } as WebSearchCardProps
  render(<WebSearchCard {...props} />)
  return { actions, store }
}

const searchMenu = () => screen.getByRole('button', { name: new RegExp(`^${en.searchSection} `) })
const fetchMenu = () => screen.getByRole('button', { name: new RegExp(`^${en.fetchSection} `) })
const region = (name: string) => within(screen.getByRole('region', { name }))

describe('WebSearchCard', () => {
  it('renders its one-liner alone in the summary view', () => {
    renderPage(shipped(), 'summary')
    expect(document.body.textContent).toBe(en.description)
  })

  it('names the active keyless provider and anonymous HTTP fetch', () => {
    renderPage()
    expect(searchMenu().textContent).toBe('Keyless (DuckDuckGo → Marginalia)')
    expect(fetchMenu().textContent).toBe(en.providerHttp)
    expect(region(en.searchSection).getByText('Keyless description.')).toBeTruthy()
  })

  it('renames keyless search once a SearXNG instance is saved', () => {
    renderPage({ ...shipped(), searxngActive: true })
    expect(searchMenu().textContent).toBe(en.providerKeylessSearxng)
  })

  it('edits and resets the SearXNG address, explains it, and links the SearXNG documentation', () => {
    const { actions } = renderPage({ ...shipped(), searxngUrl: field('https://search.example.org/', { overridden: true }) })
    const input = screen.getByLabelText(en.searxngUrl)
    expect(input).toHaveProperty('value', 'https://search.example.org/')
    expect(region(en.searchSection).getByText(en.searxngUrlHint)).toBeTruthy()
    fireEvent.change(input, { target: { value: 'https://other.example.org/' } })
    expect(actions.edit).toHaveBeenCalledWith('searxngUrl', 'https://other.example.org/')
    fireEvent.click(screen.getByRole('button', { name: en.reset }))
    expect(actions.resetField).toHaveBeenCalledWith('searxngUrl')
    const link = screen.getByRole('link', { name: en.searxngGuide })
    expect(link.getAttribute('href')).toBe('https://docs.searxng.org/')
    expect(link.getAttribute('rel')).toBe('noopener noreferrer')
  })

  it('reports an invalid SearXNG address', () => {
    renderPage({ ...shipped(), invalid: true, searxngUrl: field('ftp://x', { invalid: true }) })
    expect(screen.getByText(en.invalidSearxngUrl)).toBeTruthy()
  })

  it('shows no SearXNG panel for a plugin provider, and points to its own settings', () => {
    renderPage({ ...shipped(), search: { selected: 'exa', kind: 'plugin', auto: false, options: [{ id: 'exa', title: 'Exa', missing: false }] } })
    expect(screen.queryByLabelText(en.searxngUrl)).toBeNull()
    expect(searchMenu().textContent).toBe('Exa')
    expect(region(en.searchSection).getByText(en.pluginProviderHint)).toBeTruthy()
  })

  it('selects a provider from the menu and leaves the current one alone', () => {
    const { actions } = renderPage({ ...shipped(), fetch: { ...shipped().fetch, options: [{ id: 'http', missing: false }, { id: 'jina', missing: false }] } })
    fireEvent.click(fetchMenu())
    fireEvent.click(screen.getByRole('menuitem', { name: en.providerHttp }))
    expect(actions.selectProvider).not.toHaveBeenCalled()
    fireEvent.click(fetchMenu())
    fireEvent.click(screen.getByRole('menuitem', { name: 'jina' }))
    expect(actions.selectProvider).toHaveBeenCalledExactlyOnceWith('fetchProvider', 'jina')
  })

  it('marks a selection the Host does not register and offers automatic selection where composed none', () => {
    renderPage({ ...shipped(), search: { selected: 'gone', kind: 'none', auto: true, options: [{ id: 'gone', missing: true }] } })
    expect(searchMenu().textContent).toBe('gone (not loaded)')
    fireEvent.click(searchMenu())
    expect(screen.getByRole('menuitem', { name: en.providerAuto })).toBeTruthy()
  })

  it('reports a failed provider list read in each section and retries it', () => {
    const { actions } = renderPage({ ...shipped(), providersFailed: true })
    const retries = screen.getAllByRole('button', { name: en.retry })
    expect(retries).toHaveLength(2)
    fireEvent.click(retries[0]!)
    expect(actions.retryProviders).toHaveBeenCalledOnce()
  })

  it('locks the menus and the address while saving', () => {
    const { store } = renderPage()
    act(() => { store.set({ ...shipped(), saving: true }) })
    expect(searchMenu()).toHaveProperty('disabled', true)
    expect(screen.getByLabelText(en.searxngUrl)).toHaveProperty('disabled', true)
  })

  it('translates the keyless copy in every locale', () => {
    for (const dictionary of [zh, ja, es, fr, de, ru, pt]) {
      expect(Object.keys(dictionary).sort()).toEqual(Object.keys(en).sort())
      expect(dictionary.providerKeyless).toContain('DuckDuckGo → Marginalia')
      expect(dictionary.searxngUrlHint).not.toBe(en.searxngUrlHint)
    }
    expect(JSON.stringify([en, zh, ja, es, fr, de, ru, pt])).not.toMatch(/deepseek/i)
  })
})
