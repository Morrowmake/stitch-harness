/**
 * Step 1, the provider picker, local first: providers that already serve
 * requests; Local AI — the servers the Host finds on their default localhost
 * ports (probed only while this step is open) and any OpenAI-compatible
 * endpoint on this computer, the LAN, or a tailnet; then the hosted pi-ai
 * providers, split into subscriptions (sign in with an existing plan) and API
 * access (paste a key), in the Host's most-used-first order.
 */
import { useEffect, useMemo, useState, type ReactNode } from 'react'
import { Button, Checkbox, Input, StateDot } from '@deepseek-ai/dsh-client-ui-primitives'
import type { Translate } from '@deepseek-ai/dsh-client-ui-slots'
import type { LocalProviderProbeView, SignInRequest } from '@deepseek-ai/dsh-api-remotes/client'
import { TextSearchIndex } from '@deepseek-ai/dsh-util-text-search'
import type { FirstRunKey } from './locales.ts'
import type { ConfiguredProvider, FirstRunOperations, HostedProvider, Outcome } from './operations.ts'
import { refusalText } from './errors.ts'
import { hostedSections, type HostedEntry } from './provider-order.ts'
import { SignInPanel } from './SignInPanel.tsx'
import css from './first-run.module.css'

/** A provider ready to serve, handed to the default-model step. */
export interface ReadyProvider {
  readonly id: string
  readonly name: string
  /** Model ids the flow already knows (local servers, discovered endpoints); absent reads the model catalog. */
  readonly models?: readonly string[]
}

/** Placeholder keys for servers that ignore keys; the OpenAI protocol still sends one. */
const LOCAL_KEYS: Record<LocalProviderProbeView['id'], string> = { ollama: 'ollama', lmstudio: 'lm-studio' }
const KEYLESS_PLACEHOLDER = 'not-needed'

/** Route ids the pi-ai adapter accepts: lower-case words joined by single hyphens. */
const ROUTE_PATTERN = /^[a-z][a-z0-9]*(?:-[a-z0-9]+)*$/

/**
 * A stable, free route id for a custom endpoint, derived from its host name:
 * `gpu-box.tail1234.ts.net` gives `gpu-box-tail1234-ts-net`, an IP address
 * gives `host-192-168-1-20`, and a repeated host gets `-2`, `-3`, ….
 * @param host - the endpoint's host name.
 * @param taken - ids already in use.
 * @returns a valid, unused route id.
 */
export function routeIdFor(host: string, taken: ReadonlySet<string>): string {
  const slug = host.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '')
  const named = /^[0-9]/.test(slug) ? `host-${slug}` : slug
  const base = ROUTE_PATTERN.test(named) ? named : 'custom'
  let candidate = base
  for (let index = 2; taken.has(candidate); index += 1) candidate = `${base}-${String(index)}`
  return candidate
}

/** An OpenAI-compatible server address as the flow stores it, and the host name its route id derives from. */
export interface ServerAddress {
  /** The endpoint base, e.g. `http://192.168.1.20:11434/v1`. */
  readonly baseURL: string
  /** The host name without brackets, e.g. `192.168.1.20`. */
  readonly hostname: string
  /** Host and port as people type them, e.g. `192.168.1.20:11434`. */
  readonly host: string
}

/**
 * Read a typed server address. `192.168.1.20:11434` is read as plain HTTP, and
 * an address without a path gets `/v1`, where Ollama, LM Studio, vLLM,
 * llama.cpp, and LiteLLM serve their OpenAI-compatible API.
 * @param value - what the user typed.
 * @returns the address, or `undefined` when the text is not an http(s) address.
 */
export function serverAddress(value: string): ServerAddress | undefined {
  const text = value.trim()
  if (text === '') return undefined
  const withScheme = /^[a-z][a-z0-9+.-]*:\/\//i.test(text) ? text : `http://${text}`
  if (!URL.canParse(withScheme)) return undefined
  const url = new URL(withScheme)
  if ((url.protocol !== 'http:' && url.protocol !== 'https:') || url.hostname === '') return undefined
  if (url.pathname === '/') url.pathname = '/v1'
  return { baseURL: url.href.replace(/\/+$/, ''), hostname: url.hostname.replace(/^\[|\]$/g, ''), host: url.host }
}

/** Why a server did not list its models, as `llm/model-discovery-rejected` reports it. */
function discoveryReason(outcome: { readonly code: string; readonly details?: object }): string | undefined {
  if (outcome.code !== 'llm/model-discovery-rejected' || outcome.details === undefined || !('reason' in outcome.details)) return undefined
  return typeof outcome.details.reason === 'string' ? outcome.details.reason : undefined
}

/** Load state of one asynchronous list; a failed list shows its step's own localized sentence. */
type Loaded<T> = { readonly status: 'loading' } | { readonly status: 'ready'; readonly value: T } | { readonly status: 'error' }

/**
 * Follow one Host read: loading, then its value or refusal; rerun by bumping `generation`.
 * @param read - the read.
 * @param generation - rerun counter.
 * @returns the load state.
 */
function useLoaded<T>(read: (signal: AbortSignal) => Promise<Outcome<T>>, generation: number): Loaded<T> {
  const [state, setState] = useState<Loaded<T>>({ status: 'loading' })
  useEffect(() => {
    const abort = new AbortController()
    setState({ status: 'loading' })
    read(abort.signal).then((outcome) => {
      if (abort.signal.aborted) return
      setState(outcome.ok ? { status: 'ready', value: outcome.value } : { status: 'error' })
    }, () => {
      if (!abort.signal.aborted) setState({ status: 'error' })
    })
    return () => { abort.abort() }
    // The read is bound once by the step; only the generation reruns it.
  }, [generation])
  return state
}

/** Props of {@link ProviderStep}. */
export interface ProviderStepProps {
  readonly operations: FirstRunOperations
  readonly t: Translate<FirstRunKey>
  /** A provider is ready: continue with its default model. */
  readonly onReady: (provider: ReadyProvider) => void
}

/**
 * Render the provider picker.
 * @param props - operations, translator, and the ready callback.
 * @returns the step body.
 */
export function ProviderStep({ operations, t, onReady }: ProviderStepProps): ReactNode {
  const configured = useLoaded(() => operations.configuredProviders(), 0)
  const [hostedGeneration, setHostedGeneration] = useState(0)
  const hosted = useLoaded(() => operations.hostedProviders(), hostedGeneration)
  const configuredList = configured.status === 'ready' ? configured.value : []
  const hostedList = hosted.status === 'ready' ? hosted.value : []
  // Ids a new custom route must not take: configured routes, and catalog routes it would shadow.
  const taken = useMemo(
    () => new Set([...configuredList.map(provider => provider.id), ...hostedList.map(provider => provider.provider)]),
    [configuredList, hostedList],
  )
  const configuredIds = useMemo(() => new Set(configuredList.map(provider => provider.id)), [configuredList])
  return (
    <div className={css.step}>
      <p className={css.intro}>{t('provider.intro')}</p>
      {configuredList.length === 0 ? null : <ConfiguredGroup providers={configuredList} t={t} onReady={onReady} />}
      <LocalGroup operations={operations} t={t} configuredIds={configuredIds} taken={taken} onReady={onReady} />
      <HostedGroups hosted={hosted} retry={() => { setHostedGeneration(value => value + 1) }}
        operations={operations} t={t} onReady={onReady} />
    </div>
  )
}

function ConfiguredGroup({ providers, t, onReady }: {
  providers: readonly ConfiguredProvider[]
  t: Translate<FirstRunKey>
  onReady: (provider: ReadyProvider) => void
}): ReactNode {
  return (
    <section className={css.group} aria-label={t('configured.title')}>
      <div className={css.groupHead}><h3 className={css.groupTitle}>{t('configured.title')}</h3></div>
      <ul className={css.rows}>
        {providers.map(provider => (
          <li key={provider.id} className={css.row}>
            <div className={css.rowHead}>
              <StateDot state="done" />
              <span className={css.rowText}><span className={css.name}>{provider.name}</span></span>
              <div className={css.rowActions}>
                <Button variant="outline" size="sm" onClick={() => { onReady({ id: provider.id, name: provider.name }) }}>
                  {t('configured.use')}
                </Button>
              </div>
            </div>
          </li>
        ))}
      </ul>
    </section>
  )
}

/** Head of one picker section: title, one-line hint, and an optional action. */
function GroupHead({ title, hint, action }: { title: string; hint: string; action?: ReactNode }): ReactNode {
  return (
    <div className={css.groupHead}>
      <span className={css.rowText}>
        <h3 className={css.groupTitle}>{title}</h3>
        <span className={css.detail}>{hint}</span>
      </span>
      {action}
    </div>
  )
}

function LocalGroup({ operations, t, configuredIds, taken, onReady }: {
  operations: FirstRunOperations
  t: Translate<FirstRunKey>
  /** Routes already configured: a detected server among them is used as is. */
  configuredIds: ReadonlySet<string>
  /** Ids a custom endpoint's route must not take. */
  taken: ReadonlySet<string>
  onReady: (provider: ReadyProvider) => void
}): ReactNode {
  const [generation, setGeneration] = useState(0)
  const probe = useLoaded(signal => operations.probeLocal(signal), generation)
  const [busy, setBusy] = useState<string>()
  const [error, setError] = useState<string>()
  const use = (server: LocalProviderProbeView): void => {
    if (configuredIds.has(server.id)) {
      onReady({ id: server.id, name: server.displayName, models: server.models })
      return
    }
    setBusy(server.id)
    setError(undefined)
    void operations.addOpenAICompatible({
      route: server.id, displayName: server.displayName, baseURL: server.baseURL, apiKey: LOCAL_KEYS[server.id], models: server.models,
    }).then((outcome) => {
      if (outcome.ok) onReady({ id: server.id, name: server.displayName, models: server.models })
      else setError(refusalText(outcome, t))
    }).finally(() => { setBusy(undefined) })
  }
  return (
    <section className={css.group} aria-label={t('local.title')}>
      <GroupHead title={t('local.title')} hint={t('local.hint')} action={(
        <Button className={css.groupAction} variant="ghost" size="sm" disabled={probe.status === 'loading'}
          onClick={() => { setGeneration(value => value + 1) }}>
          {t('local.recheck')}
        </Button>
      )} />
      {probe.status === 'loading' ? <p className={css.muted}><StateDot state="ongoing" /> {t('local.checking')}</p> : null}
      {probe.status === 'error' ? <p className={css.error} role="alert">{t('error.probe')}</p> : null}
      <ul className={css.rows}>
        {probe.status !== 'ready' ? null : probe.value.map(server => (
          <li key={server.id} className={css.row} data-first-run-local={server.id}>
            <div className={css.rowHead}>
              <StateDot state={server.running ? 'done' : 'idle'} />
              <span className={css.rowText}>
                <span className={css.name}>{server.displayName}</span>
                <span className={css.detail}>
                  {!server.running
                    ? t('local.notRunning')
                    : server.models.length === 0 ? t('local.noModels') : t('local.running', { count: server.models.length })}
                </span>
              </span>
              <div className={css.rowActions}>
                <Button variant="outline" size="sm" disabled={!server.running || server.models.length === 0 || busy !== undefined}
                  onClick={() => { use(server) }}>
                  {t('local.use')}
                </Button>
              </div>
            </div>
          </li>
        ))}
        <CustomEndpointRow operations={operations} t={t} taken={taken} onReady={onReady} />
      </ul>
      {error === undefined ? null : <p className={css.error} role="alert">{error}</p>}
    </section>
  )
}

/** The Local AI row that declares any OpenAI-compatible endpoint: this computer, the LAN, or a tailnet. */
function CustomEndpointRow({ operations, t, taken, onReady }: {
  operations: FirstRunOperations
  t: Translate<FirstRunKey>
  taken: ReadonlySet<string>
  onReady: (provider: ReadyProvider) => void
}): ReactNode {
  const [open, setOpen] = useState(false)
  const [name, setName] = useState('')
  const [baseURL, setBaseURL] = useState('')
  const [key, setKey] = useState('')
  const [found, setFound] = useState<readonly string[]>()
  const [ticked, setTicked] = useState<ReadonlySet<string>>(new Set())
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string>()
  const address = serverAddress(baseURL)
  const urlInvalid = baseURL.trim().length > 0 && address === undefined

  const discover = (): void => {
    if (address === undefined) return
    const typedKey = key.trim()
    setBusy(true)
    setError(undefined)
    void operations.discoverModels(address.baseURL, typedKey === '' ? undefined : typedKey).then((outcome) => {
      if (outcome.ok) {
        setFound(outcome.value)
        setTicked(new Set(outcome.value))
        return
      }
      const reason = discoveryReason(outcome)
      setError(reason === 'unreachable'
        ? t('custom.unreachable', { host: address.host })
        : reason === 'not-compatible'
          ? t('custom.notCompatible', { host: address.host })
          : reason === 'unauthorized'
            ? t(typedKey === '' ? 'custom.needsKey' : 'custom.keyRejected', { host: address.host })
            : refusalText(outcome, t))
    }).finally(() => { setBusy(false) })
  }
  const add = (): void => {
    if (address === undefined || found === undefined) return
    const displayName = name.trim() === '' ? address.host : name.trim()
    const route = routeIdFor(address.hostname, taken)
    const models = found.filter(id => ticked.has(id))
    setBusy(true)
    setError(undefined)
    void operations.addOpenAICompatible({
      route, displayName, baseURL: address.baseURL, apiKey: key.trim() === '' ? KEYLESS_PLACEHOLDER : key.trim(), models,
    }).then((outcome) => {
      if (outcome.ok) onReady({ id: route, name: displayName, models })
      else setError(refusalText(outcome, t))
    }).finally(() => { setBusy(false) })
  }

  return (
    <li className={open ? `${css.row ?? ''} ${css.rowSelected ?? ''}` : css.row} data-first-run-local="custom">
      <div className={css.rowHead}>
        <StateDot state="idle" />
        <span className={css.rowText}>
          <span className={css.name}>{t('custom.title')}</span>
          <span className={css.detail}>{t('custom.hint')}</span>
        </span>
        {open ? null : (
          <div className={css.rowActions}>
            <Button variant="outline" size="sm" onClick={() => { setOpen(true) }}>{t('custom.open')}</Button>
          </div>
        )}
      </div>
      {!open ? null : (
        <form className={css.form} onSubmit={(event) => { event.preventDefault(); if (found === undefined) discover(); else add() }}>
          <label className={css.field}>
            <span>{t('custom.baseURL')}</span>
            <Input value={baseURL} placeholder="192.168.1.20:11434" disabled={busy}
              onChange={(event) => { setBaseURL(event.target.value); setFound(undefined); setError(undefined) }} />
          </label>
          {urlInvalid ? <p className={css.error}>{t('custom.invalidURL')}</p> : null}
          {address === undefined || address.baseURL === baseURL.trim() ? null : (
            <p className={css.muted}>{t('custom.resolvedURL', { url: address.baseURL })}</p>
          )}
          <label className={css.field}>
            <span>{t('custom.key')}</span>
            <Input type="password" autoComplete="new-password" value={key} disabled={busy}
              onChange={(event) => { setKey(event.target.value); setFound(undefined) }} />
          </label>
          <label className={css.field}>
            <span>{t('custom.name')}</span>
            <Input value={name} placeholder={address?.host ?? t('custom.namePlaceholder')} disabled={busy}
              onChange={(event) => { setName(event.target.value) }} />
          </label>
          {found === undefined ? null : found.length === 0
            ? <p className={css.muted}>{t('custom.none')}</p>
            : (
              <div className={css.form}>
                <p className={css.muted}>{t('custom.found', { count: found.length })}</p>
                <ul className={css.models}>
                  {found.map(id => (
                    <li key={id}>
                      <Checkbox label={id} checked={ticked.has(id)} disabled={busy} onChange={(checked) => {
                        setTicked((current) => {
                          const next = new Set(current)
                          if (checked) next.add(id)
                          else next.delete(id)
                          return next
                        })
                      }} />
                    </li>
                  ))}
                </ul>
              </div>
            )}
          {busy && found === undefined && address !== undefined
            ? <p className={css.muted} role="status"><StateDot state="ongoing" /> {t('custom.checking', { host: address.host })}</p>
            : null}
          {error === undefined ? null : <p className={css.error} role="alert">{error}</p>}
          <div className={css.formActions}>
            <Button type="button" variant="ghost" size="sm" disabled={busy} onClick={() => { setOpen(false) }}>{t('cancel')}</Button>
            {found === undefined
              ? <Button type="submit" variant="primary" size="sm" disabled={busy || address === undefined}>{t('custom.discover')}</Button>
              : <Button type="submit" variant="primary" size="sm" disabled={busy || ticked.size === 0}>{t('custom.add')}</Button>}
          </div>
        </form>
      )}
    </li>
  )
}

/** Which hosted section a row sits in; Anthropic appears in both. */
type HostedSection = 'subscription' | 'api'

/** What one hosted row is doing. */
type HostedAction =
  | { readonly row: string; readonly kind: 'key' }
  | { readonly row: string; readonly kind: 'signin'; readonly request: SignInRequest }

/**
 * The key of one hosted row, unique across both sections.
 * @param section - the row's section.
 * @param provider - the row's route id.
 * @returns the key.
 */
function rowKey(section: HostedSection, provider: string): string {
  return `${section}:${provider}`
}

function HostedGroups({ hosted, retry, operations, t, onReady }: {
  hosted: Loaded<readonly HostedProvider[]>
  retry: () => void
  operations: FirstRunOperations
  t: Translate<FirstRunKey>
  onReady: (provider: ReadyProvider) => void
}): ReactNode {
  const [query, setQuery] = useState('')
  const [action, setAction] = useState<HostedAction>()
  const sections = useMemo(() => hostedSections(hosted.status === 'ready' ? hosted.value : []), [hosted])
  const index = useMemo(
    () => new TextSearchIndex([...sections.apiAccess], entry => ({ fuzzy: [entry.name, entry.provider.provider] })),
    [sections],
  )
  const visible = index.search(query)
  const status = hosted.status === 'loading'
    ? <p className={css.muted}><StateDot state="ongoing" /> {t('hosted.loading')}</p>
    : hosted.status === 'error'
      ? (
        <div className={css.rowHead}>
          <p className={css.error} role="alert">{t('hosted.unavailable')}</p>
          <Button variant="ghost" size="sm" onClick={retry}>{t('retry')}</Button>
        </div>
      )
      : null
  const rows = (section: HostedSection, entries: readonly HostedEntry[]): ReactNode => entries.map((entry) => {
    const key = rowKey(section, entry.provider.provider)
    return (
      <HostedRow key={key} rowId={key} section={section} entry={entry} action={action?.row === key ? action : undefined}
        operations={operations} t={t} setAction={setAction}
        onReady={() => { onReady({ id: entry.provider.provider, name: entry.name }) }} />
    )
  })
  return (
    <>
      {hosted.status === 'ready' && sections.subscriptions.length === 0 ? null : (
        <section className={css.group} aria-label={t('subscriptions.title')}>
          <GroupHead title={t('subscriptions.title')} hint={t('subscriptions.hint')} />
          {status}
          {hosted.status !== 'ready' ? null : <ul className={css.rows}>{rows('subscription', sections.subscriptions)}</ul>}
        </section>
      )}
      <section className={css.group} aria-label={t('hosted.title')}>
        <GroupHead title={t('hosted.title')} hint={t('hosted.hint')} />
        {sections.subscriptions.length === 0 ? status : null}
        {hosted.status !== 'ready' ? null : (
          <>
            <Input value={query} placeholder={t('hosted.search')} aria-label={t('hosted.search')} onChange={(event) => { setQuery(event.target.value) }} />
            {visible.length === 0 ? <p className={css.muted}>{t('hosted.empty')}</p> : (
              <ul className={`${css.rows ?? ''} ${css.hostedList ?? ''}`}>{rows('api', visible)}</ul>
            )}
          </>
        )}
      </section>
    </>
  )
}

function HostedRow({ rowId, section, entry, action, operations, t, setAction, onReady }: {
  rowId: string
  section: HostedSection
  entry: HostedEntry
  action: HostedAction | undefined
  operations: FirstRunOperations
  t: Translate<FirstRunKey>
  setAction: (action: HostedAction | undefined) => void
  onReady: () => void
}): ReactNode {
  const { provider } = entry
  const [key, setKey] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string>()
  /** The key is stored, but the provider could not confirm it. */
  const [unverified, setUnverified] = useState(false)
  const save = (): void => {
    setBusy(true)
    setError(undefined)
    void operations.addApiKeyAccount(provider.provider, key.trim()).then((outcome) => {
      if (outcome.ok) {
        if (outcome.value.verified) onReady()
        else setUnverified(true)
      } else {
        setError(outcome.code === 'llm-accounts/key-rejected' ? t('hosted.keyRejected', { provider: entry.name }) : refusalText(outcome, t))
      }
    }).finally(() => { setBusy(false) })
  }
  return (
    <li className={action === undefined ? css.row : `${css.row ?? ''} ${css.rowSelected ?? ''}`}
      data-first-run-hosted={provider.provider} data-first-run-section={section}>
      <div className={css.rowHead}>
        <span className={css.rowText}><span className={css.name}>{entry.name}</span></span>
        {action !== undefined ? null : (
          <div className={css.rowActions}>
            {section === 'subscription'
              ? (
                <Button variant="outline" size="sm" onClick={() => { setAction({ row: rowId, kind: 'signin', request: { method: 'oauth' } }) }}>
                  {t('hosted.signIn')}
                </Button>
              )
              : (
                <Button variant="outline" size="sm" onClick={() => {
                  setAction(provider.simpleKey
                    ? { row: rowId, kind: 'key' }
                    : { row: rowId, kind: 'signin', request: { method: 'api-key' } })
                }}>
                  {t('hosted.apiKey')}
                </Button>
              )}
          </div>
        )}
      </div>
      {action?.kind === 'signin'
        ? <SignInPanel provider={provider.provider} request={action.request} operations={operations} t={t}
          onAuthorized={onReady} onCancel={() => { setAction(undefined) }} />
        : null}
      {action?.kind === 'key' && unverified
        ? (
          <div className={css.form}>
            <p className={css.notice} role="status">{t('hosted.keyUnverified', { provider: entry.name })}</p>
            <div className={css.formActions}>
              <Button variant="primary" size="sm" onClick={onReady}>{t('hosted.continue')}</Button>
            </div>
          </div>
        )
        : null}
      {action?.kind === 'key' && !unverified
        ? (
          <form className={css.form} onSubmit={(event) => { event.preventDefault(); save() }}>
            <label className={css.field}>
              <span>{t('hosted.keyLabel', { provider: entry.name })}</span>
              <Input type="password" autoComplete="new-password" value={key} disabled={busy}
                onChange={(event) => { setKey(event.target.value); setError(undefined) }} />
            </label>
            {busy ? <p className={css.muted} role="status"><StateDot state="ongoing" /> {t('hosted.checking', { provider: entry.name })}</p> : null}
            {error === undefined ? null : <p className={css.error} role="alert">{error}</p>}
            <div className={css.formActions}>
              <Button type="button" variant="ghost" size="sm" disabled={busy} onClick={() => { setAction(undefined) }}>{t('cancel')}</Button>
              <Button type="submit" variant="primary" size="sm" disabled={busy || key.trim() === ''}>{t('hosted.save')}</Button>
            </div>
          </form>
        )
        : null}
    </li>
  )
}
