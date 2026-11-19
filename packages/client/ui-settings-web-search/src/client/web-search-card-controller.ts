/**
 * The web search and fetch page's staged form over two settings namespaces:
 * `web`, whose `searchProvider` and `fetchProvider` the two provider menus
 * write, and `web-search-keyless`, whose `searxngUrl` points keyless search at
 * a SearXNG instance.
 *
 * A selection equal to the deployment's composed value clears the override
 * instead of storing a copy of it, and while the deployment composes no
 * provider for a capability its menu also offers automatic selection, which
 * clears the override. The menus offer the providers the Host reports through
 * `web/listProviders`, the built-in ones first and the rest in registration
 * order, plus a selected id the Host no longer registers. A failed read is
 * reported on the page with a retry.
 */

import type { Context as ClientContext } from '@deepseek-ai/cordis'
// Type-only: pulls the ctx.remote merge into this program.
import type {} from '@deepseek-ai/dsh-api-remotes/client'
import type { WebProviderInfo, WebProviderList as ProviderList } from '@deepseek-ai/dsh-web/types'
import { createSnapshotStore, type SnapshotStore } from '@deepseek-ai/dsh-client-store'
import {
  SettingsFormModel, settingsTextField,
  type SettingsFieldState, type SettingsFormActions, type SettingsFormShell, type SettingsFormScope,
} from '@deepseek-ai/dsh-client-ui-primitives'

/**
 * Namespaces this page edits. Spelled here rather than imported: a client
 * package must not depend on a Host package.
 */
export const WEB_KEYLESS_NS = 'web-search-keyless'
/** Namespace of the web service's provider selection. */
export const WEB_NS = 'web'

/** Provider ids of the built-in providers this page describes. */
export const PROVIDER_IDS = {
  keylessSearch: 'keyless',
  httpFetch: 'http',
} as const

/**
 * The built-in providers each menu lists first while the Host registers them;
 * the Host's own list stays in registration order.
 */
const MENU_ORDER = {
  search: [PROVIDER_IDS.keylessSearch],
  fetch: [PROVIDER_IDS.httpFetch],
} as const satisfies Record<keyof ProviderList, readonly string[]>

/** Settings-section fields the face edits as text. */
export type WebSearchCardField = 'searxngUrl'

/** The web service's provider selection. */
export interface WebProviderSelection {
  /** Search provider id. */
  searchProvider?: string
  /** Fetch provider id. */
  fetchProvider?: string
}

/** The keyless search fields this page edits. */
export interface WebKeylessSettings {
  /** Base URL of a SearXNG instance; blank searches DuckDuckGo, then Marginalia. */
  searxngUrl?: string
}

/** One entry of a provider menu. */
export interface WebProviderOption {
  /** Provider id, written into the selection. */
  id: string
  /** Title the provider registered with, if any. */
  title?: string
  /** Description the provider registered with, if any; the page shows it under the menu while the provider is selected. */
  description?: WebProviderInfo['description']
  /** True for a selected id the Host does not currently register. */
  missing: boolean
}

/** What the Search section shows for its selected provider. */
export type WebSearchKind = 'keyless' | 'plugin' | 'none'
/** What the Fetch section shows for its selected provider. */
export type WebFetchKind = 'http' | 'plugin' | 'none'

/** One provider section: its menu and the controls its selection shows. */
export interface WebProviderSectionState<K extends string> {
  /** Id of the selected provider, or the empty string when the selection names none. */
  selected: string
  /** Menu entries: the registered providers, plus a selected id that is not registered. */
  options: readonly WebProviderOption[]
  /** Which provider-specific controls the section shows. */
  kind: K
  /** Whether the menu offers automatic selection, because the deployment composes no provider for this capability. */
  auto: boolean
}

/** What the web search and fetch page renders. */
export interface WebSearchCardState extends SettingsFormShell {
  /** Invalid edits or failed saves that changing providers must keep visible. */
  selectionBlocked: boolean
  /**
   * Whether the latest provider list read failed. The menus keep the last list
   * read, or before any list arrives only the selected ids, so they may be
   * incomplete.
   */
  providersFailed: boolean
  /** The Search section. */
  search: WebProviderSectionState<WebSearchKind>
  /** The Fetch section. */
  fetch: WebProviderSectionState<WebFetchKind>
  /** SearXNG base URL, shown in the Search section while it selects keyless search. */
  searxngUrl: SettingsFieldState
  /** Whether the saved keyless settings name a SearXNG instance, which replaces DuckDuckGo and Marginalia. */
  searxngActive: boolean
}

/** The registration-side face the page's slot entry injects. */
export interface WebSearchCardFace extends Pick<SettingsFormActions, 'save' | 'discard'> {
  hooks: {
    /** Page snapshot bound by the renderer as useWebSearchCard. */
    webSearchCard: SnapshotStore<WebSearchCardState>
  }
  /** Stage draft text for one control. */
  edit: (field: WebSearchCardField, text: string) => void
  /** Stage a clear for one section field. */
  resetField: (field: WebSearchCardField) => void
  /** Stage one provider selection; the empty id stages automatic selection. */
  selectProvider: (field: keyof WebProviderSelection, id: string) => void
  /** Re-read the registered providers after a failed read. */
  retryProviders: () => void
  /** Resolve a provider description to the active language. */
  resolveText: (text: NonNullable<WebProviderOption['description']>) => string
}

/** Settings scopes for the namespaces the page edits. */
export interface WebSearchCardScopes {
  /** The web service's provider selection. */
  web: SettingsFormScope<WebProviderSelection>
  /** Keyless search settings. */
  keyless: SettingsFormScope<WebKeylessSettings>
}

/** Whether `text` is an HTTP(S) URL without credentials, which SearXNG needs. */
function isSearxngUrl(text: string): boolean {
  try {
    const url = new URL(text)
    return (url.protocol === 'http:' || url.protocol === 'https:') && url.username === '' && url.password === ''
  } catch {
    return false
  }
}

/** Bridges the settings scopes and the provider lists onto the page. */
export class WebSearchCardController {
  private readonly selection: SettingsFormModel<WebProviderSelection>
  private readonly keyless: SettingsFormModel<WebKeylessSettings>
  private readonly store: SnapshotStore<WebSearchCardState>
  private readonly unsubscribe: (() => void)[]
  private providers: ProviderList | undefined
  private providersFailed = false
  private providerReadSequence = 0
  private selectionServed = false
  private disposed = false

  /**
   * @param scopes - the bound settings scopes for the page's namespaces.
   * @param ctx - the page plugin's context, whose `remote.web` namespace lists the registered providers.
   */
  constructor(
    private readonly scopes: WebSearchCardScopes,
    private readonly ctx: ClientContext,
  ) {
    this.selection = new SettingsFormModel(scopes.web, [
      settingsTextField('searchProvider'), settingsTextField('fetchProvider'),
    ])
    this.keyless = new SettingsFormModel(scopes.keyless, [{
      ...settingsTextField('searxngUrl'),
      parse: (text) => {
        const trimmed = text.trim()
        if (trimmed === '') return { kind: 'clear' }
        return isSearxngUrl(trimmed) ? { kind: 'set', value: trimmed } : undefined
      },
    }])
    this.selectionServed = this.selection.shell().available
    this.store = createSnapshotStore(this.projection())
    this.unsubscribe = [
      ...[this.selection, this.keyless].map(form => form.bind(() => form.shell()).subscribe(() => { this.store.set(this.projection()) })),
      scopes.web.subscribe(() => {
        // The provider list comes from the web service; a Host that starts
        // serving it registers providers this page has not read.
        const served = this.selection.shell().available
        if (served && !this.selectionServed) this.refreshProviders()
        this.selectionServed = served
      }),
    ]
    this.refreshProviders()
  }

  /** The provider id a selection field stages. */
  private selected(field: keyof WebProviderSelection): string {
    return this.selection.field(field).text
  }

  /**
   * Menu entries for one capability: the registered built-in providers in
   * {@link MENU_ORDER}, then every other registered provider in Host order,
   * and the selected id when the Host does not register it. Before the list
   * arrives, the menu holds only the selected id.
   */
  private options(capability: keyof ProviderList, selected: string): WebProviderOption[] {
    const registered = this.providers?.[capability]
    if (registered === undefined) return selected === '' ? [] : [{ id: selected, missing: false }]
    const first: readonly string[] = MENU_ORDER[capability]
    const ordered = [
      ...first.flatMap(id => registered.filter(info => info.id === id)),
      ...registered.filter(info => !first.includes(info.id)),
    ]
    const options = ordered.map(info => ({
      id: info.id,
      ...info.title === undefined ? {} : { title: info.title },
      ...info.description === undefined ? {} : { description: info.description },
      missing: false,
    }))
    if (selected !== '' && !registered.some(info => info.id === selected)) options.push({ id: selected, missing: true })
    return options
  }

  /** Whether the Host reports `id` as registered, or has not answered yet. */
  private registered(capability: keyof ProviderList, id: string): boolean {
    return this.providers === undefined || this.providers[capability].some(info => info.id === id)
  }

  private searchKind(): WebSearchKind {
    const id = this.selected('searchProvider')
    if (id === '' || !this.registered('search', id)) return 'none'
    if (id === PROVIDER_IDS.keylessSearch) return this.keyless.shell().available ? 'keyless' : 'none'
    return this.providers === undefined ? 'none' : 'plugin'
  }

  private fetchKind(): WebFetchKind {
    const id = this.selected('fetchProvider')
    if (id === '' || !this.registered('fetch', id)) return 'none'
    if (id === PROVIDER_IDS.httpFetch) return 'http'
    return this.providers === undefined ? 'none' : 'plugin'
  }

  private projection(): WebSearchCardState {
    const primary = this.selection.shell()
    const served = [primary, this.keyless.shell()].filter(item => item.available)
    const shell: SettingsFormShell = {
      available: primary.available,
      writable: served.every(item => item.writable),
      dirty: served.some(item => item.dirty),
      invalid: served.some(item => item.invalid),
      saving: served.some(item => item.saving),
      failed: served.some(item => item.failed),
    }
    const searchSelected = this.selected('searchProvider')
    const fetchSelected = this.selected('fetchProvider')
    const base = this.scopes.web.getSnapshot().base as WebProviderSelection | undefined
    return {
      ...shell,
      selectionBlocked: shell.invalid || shell.failed,
      providersFailed: this.providersFailed,
      search: {
        selected: searchSelected,
        options: this.options('search', searchSelected),
        kind: this.searchKind(),
        auto: base?.searchProvider === undefined,
      },
      fetch: {
        selected: fetchSelected,
        options: this.options('fetch', fetchSelected),
        kind: this.fetchKind(),
        auto: base?.fetchProvider === undefined,
      },
      searxngUrl: this.keyless.field('searxngUrl'),
      searxngActive: (this.scopes.keyless.getSnapshot().value?.searxngUrl ?? '') !== '',
    }
  }

  /**
   * Re-read the registered providers. Only the latest read publishes; a failed
   * read keeps the previous list and marks the page's provider list as failed
   * until a later read succeeds.
   */
  refreshProviders(): void {
    void this.readProviders()
  }

  private async readProviders(): Promise<void> {
    if (this.disposed) return
    const sequence = ++this.providerReadSequence
    const response = await this.ctx.remote.web.listProviders()
    // oxlint-disable-next-line typescript/no-unnecessary-condition -- dispose() can run during the await.
    if (this.disposed || sequence !== this.providerReadSequence) return
    if (response.ok) this.providers = response.value
    this.providersFailed = !response.ok
    this.store.set(this.projection())
  }

  /**
   * Build the face the page's slot registration injects.
   * @returns the page's snapshot and its form actions.
   */
  inject(): WebSearchCardFace {
    return {
      hooks: { webSearchCard: this.store },
      edit: (field, text) => { this.keyless.actions().edit(field, text) },
      resetField: (field) => { this.keyless.actions().resetField(field) },
      selectProvider: (field, id) => { this.select(field, id) },
      retryProviders: () => { this.refreshProviders() },
      resolveText: text => this.ctx.locale.resolveText(text),
      save: () => { void this.save() },
      discard: () => {
        for (const form of [this.selection, this.keyless]) form.actions().discard()
      },
    }
  }

  /**
   * Stage one provider selection. Automatic selection and a target equal to
   * the composed value clear the override, so the deployment default keeps
   * applying.
   * @param field - the selection field.
   * @param id - the provider id to select, or the empty string for automatic selection.
   */
  private select(field: keyof WebProviderSelection, id: string): void {
    const composed = (this.scopes.web.getSnapshot().base as WebProviderSelection | undefined)?.[field]
    if (id === '' || composed === id) this.selection.actions().resetField(field)
    else this.selection.actions().edit(field, id)
  }

  /**
   * Save the keyless section before the selection, so a selection takes
   * effect only after the settings it uses have landed. A refused section
   * stops the selection from saving and keeps every remaining draft for
   * correction.
   * @returns settlement after every attempted write.
   */
  private async save(): Promise<void> {
    const state = this.projection()
    if (!state.available || state.invalid || state.saving) return
    if (this.keyless.shell().available && this.keyless.shell().dirty) {
      await this.keyless.save()
      if (this.keyless.shell().failed) return
    }
    if (!this.selection.shell().dirty) return
    await this.selection.save()
  }

  /** Release subscriptions and prevent late answers from publishing. */
  dispose(): void {
    this.disposed = true
    for (const off of this.unsubscribe) off()
    for (const form of [this.selection, this.keyless]) form.dispose()
  }
}
