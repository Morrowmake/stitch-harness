import { describe, expect, it, vi } from 'vitest'
import type { SettingsPathOpView } from '@deepseek-ai/dsh-api-remotes/client'
import { RemoteError, stubConfigForm, type StubConfigForm } from '@deepseek-ai/dsh-client-test-runtime'
import {
  WebSearchCardController, type WebKeylessSettings, type WebProviderSelection,
} from '../src/client/web-search-card-controller.ts'

/** Make the stub behave like a Host that accepts every write. */
function acceptWrites<T>(host: StubConfigForm<T>): void {
  host.mutate.mockImplementation((ops: readonly SettingsPathOpView[]) => {
    const value: Record<string, unknown> = { ...host.scope.getSnapshot().value as object }
    const user: Record<string, unknown> = { ...host.scope.getSnapshot().user as object }
    for (const op of ops) {
      const field = op.path[0]!
      if (op.op === 'set') {
        value[field] = op.value
        user[field] = op.value
      } else {
        Reflect.deleteProperty(user, field)
        value[field] = (host.scope.getSnapshot().base as Record<string, unknown> | undefined)?.[field]
      }
    }
    host.publish({ value: value as T, user })
    return Promise.resolve(true)
  })
}

/** Providers the shipped composition registers, in registration order. */
const SHIPPED_PROVIDERS = { search: [{ id: 'keyless' }], fetch: [{ id: 'http' }] }

/** The shipped selection: keyless search and anonymous HTTP fetch. */
const SHIPPED_SELECTION = { searchProvider: 'keyless', fetchProvider: 'http' }

type ProviderEntry = { id: string; title?: string }
type ProviderResponse = { ok: true; value: { search: ProviderEntry[]; fetch: ProviderEntry[] } } | { ok: false; error: RemoteError }

/**
 * Mount the controller over two stub scopes.
 * @param accept - whether each Host accepts writes.
 * @returns the scopes, the controller, its face, and a state reader.
 */
function bench(accept = false) {
  const web = stubConfigForm<WebProviderSelection>()
  const keyless = stubConfigForm<WebKeylessSettings>()
  if (accept) {
    acceptWrites(web)
    acceptWrites(keyless)
  }
  const listProviders = vi.fn((): Promise<ProviderResponse> => Promise.resolve({ ok: true, value: SHIPPED_PROVIDERS }))
  const resolveText = vi.fn(() => 'resolved')
  const ctx = { remote: { web: { listProviders } }, locale: { resolveText } } as never
  const controller = new WebSearchCardController({ web: web.scope, keyless: keyless.scope }, ctx)
  const face = controller.inject()
  return { web, keyless, listProviders, resolveText, controller, face, state: () => face.hooks.webSearchCard.getSnapshot() }
}

/** Serve both sections, the shipped selection unless one is given, and `keyless` as the keyless section. */
function serve(b: ReturnType<typeof bench>, selection: Partial<{ value: WebProviderSelection; base: WebProviderSelection }> = {},
  keyless: WebKeylessSettings = {}): void {
  b.web.publish({ status: 'ready', writable: true, value: SHIPPED_SELECTION, base: SHIPPED_SELECTION, user: {}, ...selection })
  b.keyless.publish({ status: 'ready', writable: true, value: keyless, base: keyless, user: {} })
}

async function served(keyless: WebKeylessSettings = {}) {
  const b = bench(true)
  serve(b, {}, keyless)
  await vi.waitFor(() => { expect(b.state().search.options).toHaveLength(1) })
  return b
}

describe('WebSearchCardController keyless search', () => {
  it('shows the SearXNG field while keyless search is selected, and reports whether one is saved', async () => {
    const b = await served()
    try {
      expect(b.state().search).toMatchObject({ selected: 'keyless', kind: 'keyless', auto: false })
      expect(b.state().fetch).toMatchObject({ selected: 'http', kind: 'http' })
      expect(b.state().searxngUrl).toMatchObject({ text: '', overridden: false, invalid: false })
      expect(b.state().searxngActive).toBe(false)
    } finally { b.controller.dispose() }
  })

  it('saves a trimmed SearXNG URL into the keyless section and clears it again', async () => {
    const b = await served()
    try {
      b.face.edit('searxngUrl', '  https://search.example.org/  ')
      expect(b.state().dirty).toBe(true)
      b.face.save()
      await vi.waitFor(() => {
        expect(b.keyless.mutate).toHaveBeenCalledWith([{ op: 'set', path: ['searxngUrl'], value: 'https://search.example.org/' }], undefined)
      })
      await vi.waitFor(() => { expect(b.state().searxngActive).toBe(true) })
      expect(b.web.mutate).not.toHaveBeenCalled()
      b.face.resetField('searxngUrl')
      b.face.save()
      await vi.waitFor(() => { expect(b.keyless.mutate).toHaveBeenLastCalledWith([{ op: 'unset', path: ['searxngUrl'] }], undefined) })
      await vi.waitFor(() => { expect(b.state().searxngActive).toBe(false) })
    } finally { b.controller.dispose() }
  })

  it.each(['not a url', 'ftp://search.example.org/', 'https://user:secret@search.example.org/'])(
    'rejects %s and blocks saving and provider changes', async (text) => {
      const b = await served()
      try {
        b.face.edit('searxngUrl', text)
        expect(b.state().searxngUrl.invalid).toBe(true)
        expect(b.state().selectionBlocked).toBe(true)
        b.face.save()
        await Promise.resolve()
        expect(b.keyless.mutate).not.toHaveBeenCalled()
      } finally { b.controller.dispose() }
    })

  it('hides the SearXNG field while the keyless section is not served', async () => {
    const b = bench()
    try {
      b.web.publish({ status: 'ready', writable: true, value: SHIPPED_SELECTION, base: SHIPPED_SELECTION, user: {} })
      await vi.waitFor(() => { expect(b.listProviders).toHaveBeenCalled() })
      expect(b.state().search.kind).toBe('none')
    } finally { b.controller.dispose() }
  })

  it('keeps the selection staged when the keyless section refuses its save', async () => {
    const b = await served()
    try {
      b.keyless.mutate.mockResolvedValue(false)
      b.face.selectProvider('fetchProvider', 'jina')
      b.face.edit('searxngUrl', 'https://search.example.org/')
      b.face.save()
      await vi.waitFor(() => { expect(b.keyless.mutate).toHaveBeenCalled() })
      await Promise.resolve()
      expect(b.web.mutate).not.toHaveBeenCalled()
      expect(b.state().fetch.selected).toBe('jina')
    } finally { b.controller.dispose() }
  })
})

describe('WebSearchCardController providers', () => {
  it('lists the built-in providers first and plugin providers after them in Host order', async () => {
    const b = bench()
    try {
      b.listProviders.mockResolvedValue({
        ok: true, value: { search: [{ id: 'exa' }, { id: 'keyless' }], fetch: [{ id: 'jina' }, { id: 'http' }] },
      })
      b.controller.refreshProviders()
      serve(b, { value: { searchProvider: 'perplexity', fetchProvider: 'http' } })
      await vi.waitFor(() => { expect(b.state().search.options).toHaveLength(3) })
      expect(b.state().search.options).toEqual([
        { id: 'keyless', missing: false }, { id: 'exa', missing: false }, { id: 'perplexity', missing: true },
      ])
      expect(b.state().search.kind).toBe('none')
      expect(b.state().fetch.options.map(option => option.id)).toEqual(['http', 'jina'])
    } finally { b.controller.dispose() }
  })

  it('shows a plugin selection with no settings of its own', async () => {
    const b = bench()
    try {
      b.listProviders.mockResolvedValue({ ok: true, value: { search: [{ id: 'exa', title: 'Exa' }], fetch: [{ id: 'jina' }] } })
      b.controller.refreshProviders()
      serve(b, { value: { searchProvider: 'exa', fetchProvider: 'jina' } })
      await vi.waitFor(() => { expect(b.state().search.kind).toBe('plugin') })
      expect(b.state().search.options).toEqual([{ id: 'exa', title: 'Exa', missing: false }])
      expect(b.state().fetch.kind).toBe('plugin')
    } finally { b.controller.dispose() }
  })

  it('renders an unread list as the selected id alone', () => {
    const b = bench()
    try {
      b.listProviders.mockReturnValue(new Promise(() => {}))
      b.controller.refreshProviders()
      serve(b)
      expect(b.state().search.options).toEqual([{ id: 'keyless', missing: false }])
      expect(b.state().fetch.kind).toBe('http')
    } finally { b.controller.dispose() }
  })

  it('keeps the last list when a read fails and recovers on retry', async () => {
    const b = await served()
    try {
      b.listProviders.mockResolvedValueOnce({ ok: false, error: new RemoteError('gateway/internal', 'down', {}) })
      b.face.retryProviders()
      await vi.waitFor(() => { expect(b.state().providersFailed).toBe(true) })
      expect(b.state().search.options).toEqual([{ id: 'keyless', missing: false }])
      b.face.retryProviders()
      await vi.waitFor(() => { expect(b.state().providersFailed).toBe(false) })
    } finally { b.controller.dispose() }
  })

  it('publishes only the latest provider read', async () => {
    const b = bench()
    try {
      const first = Promise.withResolvers<ProviderResponse>()
      b.listProviders.mockReturnValueOnce(first.promise)
      b.controller.refreshProviders()
      serve(b)
      await vi.waitFor(() => { expect(b.state().search.options).toEqual([{ id: 'keyless', missing: false }]) })
      first.resolve({ ok: true, value: { search: [{ id: 'stale' }], fetch: [] } })
      await Promise.resolve()
      expect(b.state().search.options.map(option => option.id)).toEqual(['keyless'])
    } finally { b.controller.dispose() }
  })

  it('re-reads the providers when the Host starts serving the selection', async () => {
    const b = bench()
    try {
      await vi.waitFor(() => { expect(b.listProviders).toHaveBeenCalledTimes(1) })
      serve(b)
      await vi.waitFor(() => { expect(b.listProviders).toHaveBeenCalledTimes(2) })
    } finally { b.controller.dispose() }
  })

  it('resolves a provider description through the locale service', () => {
    const b = bench()
    try {
      const description = { en: 'English.', zh: '中文' }
      expect(b.face.resolveText(description)).toBe('resolved')
      expect(b.resolveText).toHaveBeenCalledExactlyOnceWith(description)
    } finally { b.controller.dispose() }
  })
})

describe('WebSearchCardController provider selection', () => {
  it('selects Search and Fetch independently and clears a selection back to the composed default', async () => {
    const b = await served()
    try {
      b.face.selectProvider('fetchProvider', 'jina')
      b.face.save()
      await vi.waitFor(() => { expect(b.web.mutate).toHaveBeenCalledWith([{ op: 'set', path: ['fetchProvider'], value: 'jina' }], undefined) })
      b.face.selectProvider('fetchProvider', 'http')
      b.face.save()
      await vi.waitFor(() => { expect(b.web.mutate).toHaveBeenLastCalledWith([{ op: 'unset', path: ['fetchProvider'] }], undefined) })
    } finally { b.controller.dispose() }
  })

  it('offers automatic selection only where the deployment composes no provider, and returns to it', async () => {
    const b = bench(true)
    try {
      serve(b, { base: { fetchProvider: 'http' }, value: { fetchProvider: 'http' } })
      await vi.waitFor(() => { expect(b.state().search.options).toHaveLength(0) })
      expect(b.state().search.auto).toBe(true)
      expect(b.state().fetch.auto).toBe(false)
      b.face.selectProvider('searchProvider', 'keyless')
      expect(b.state().search.selected).toBe('keyless')
      b.face.selectProvider('searchProvider', '')
      expect(b.state().search.selected).toBe('')
    } finally { b.controller.dispose() }
  })

  it('discards every staged draft', async () => {
    const b = await served()
    try {
      b.face.selectProvider('fetchProvider', 'jina')
      b.face.edit('searxngUrl', 'https://search.example.org/')
      b.face.discard()
      expect(b.state().dirty).toBe(false)
      expect(b.state().fetch.selected).toBe('http')
    } finally { b.controller.dispose() }
  })

  it('saves nothing before the selection is served', () => {
    const b = bench(true)
    try {
      b.face.save()
      expect(b.web.mutate).not.toHaveBeenCalled()
      expect(b.keyless.mutate).not.toHaveBeenCalled()
    } finally { b.controller.dispose() }
  })

  it('releases every subscription on dispose and ignores a late provider answer', async () => {
    const b = bench()
    const pending = Promise.withResolvers<ProviderResponse>()
    b.listProviders.mockReturnValueOnce(pending.promise)
    b.controller.refreshProviders()
    b.controller.dispose()
    expect(b.web.listenerCount()).toBe(0)
    expect(b.keyless.listenerCount()).toBe(0)
    const before = b.state()
    pending.resolve({ ok: true, value: SHIPPED_PROVIDERS })
    await Promise.resolve()
    expect(b.state()).toBe(before)
    b.controller.refreshProviders()
    expect(b.listProviders).toHaveBeenCalledTimes(2)
  })
})
