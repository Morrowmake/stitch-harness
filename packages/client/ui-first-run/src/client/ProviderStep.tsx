/**
 * Step 1, the provider picker, local first: providers that already serve
 * requests, the local servers the Host finds on their default ports (probed
 * only while this step is open), any OpenAI-compatible URL, then the hosted
 * pi-ai providers with sign-in or an API key.
 */
import { useEffect, useMemo, useState, type ReactNode } from 'react'
import { Button, Checkbox, Input, StateDot } from '@deepseek-ai/dsh-client-ui-primitives'
import type { Translate } from '@deepseek-ai/dsh-client-ui-slots'
import type { LocalProviderProbeView, SignInRequest } from '@deepseek-ai/dsh-api-remotes/client'
import { TextSearchIndex } from '@deepseek-ai/dsh-util-text-search'
import type { FirstRunKey } from './locales.ts'
import type { ConfiguredProvider, FirstRunOperations, HostedProvider, Outcome } from './operations.ts'
import { refusalText } from './errors.ts'
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
 * A free route id for a custom server.
 * @param label - the name or host the user gave.
 * @param taken - ids already in use.
 * @returns a valid, unused route id.
 */
export function routeIdFor(label: string, taken: ReadonlySet<string>): string {
  const slug = label.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^[^a-z]+/, '').replace(/-+$/, '')
  const base = ROUTE_PATTERN.test(slug) ? slug : 'custom'
  let candidate = base
  for (let index = 2; taken.has(candidate); index += 1) candidate = `${base}-${String(index)}`
  return candidate
}

/**
 * The host of an http(s) URL, or `undefined` when the text is not one.
 * @param value - the typed URL.
 * @returns the host name.
 */
export function httpHost(value: string): string | undefined {
  if (!URL.canParse(value)) return undefined
  const url = new URL(value)
  return url.protocol === 'http:' || url.protocol === 'https:' ? url.hostname : undefined
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
      <LocalGroup operations={operations} t={t} taken={configuredIds} onReady={onReady} />
      <CustomGroup operations={operations} t={t} taken={taken} onReady={onReady} />
      <HostedGroup hosted={hosted} retry={() => { setHostedGeneration(value => value + 1) }}
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

function LocalGroup({ operations, t, taken, onReady }: {
  operations: FirstRunOperations
  t: Translate<FirstRunKey>
  taken: ReadonlySet<string>
  onReady: (provider: ReadyProvider) => void
}): ReactNode {
  const [generation, setGeneration] = useState(0)
  const probe = useLoaded(signal => operations.probeLocal(signal), generation)
  const [busy, setBusy] = useState<string>()
  const [error, setError] = useState<string>()
  const use = (server: LocalProviderProbeView): void => {
    if (taken.has(server.id)) {
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
      <div className={css.groupHead}>
        <h3 className={css.groupTitle}>{t('local.title')}</h3>
        <Button className={css.groupAction} variant="ghost" size="sm" disabled={probe.status === 'loading'}
          onClick={() => { setGeneration(value => value + 1) }}>
          {t('local.recheck')}
        </Button>
      </div>
      {probe.status === 'loading' ? <p className={css.muted}><StateDot state="ongoing" /> {t('local.checking')}</p> : null}
      {probe.status === 'error' ? <p className={css.error} role="alert">{t('error.probe')}</p> : null}
      {probe.status === 'ready'
        ? (
          <ul className={css.rows}>
            {probe.value.map(server => (
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
          </ul>
        )
        : null}
      {error === undefined ? null : <p className={css.error} role="alert">{error}</p>}
    </section>
  )
}

function CustomGroup({ operations, t, taken, onReady }: {
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
  const url = baseURL.trim()
  const host = httpHost(url)
  const urlInvalid = url.length > 0 && host === undefined

  const discover = (): void => {
    setBusy(true)
    setError(undefined)
    void operations.discoverModels(url, key.trim() === '' ? undefined : key.trim()).then((outcome) => {
      if (!outcome.ok) { setError(refusalText(outcome, t)); return }
      setFound(outcome.value)
      setTicked(new Set(outcome.value))
    }).finally(() => { setBusy(false) })
  }
  const add = (): void => {
    if (host === undefined || found === undefined) return
    const displayName = name.trim() === '' ? host : name.trim()
    const route = routeIdFor(displayName, taken)
    const models = found.filter(id => ticked.has(id))
    setBusy(true)
    setError(undefined)
    void operations.addOpenAICompatible({
      route, displayName, baseURL: url, apiKey: key.trim() === '' ? KEYLESS_PLACEHOLDER : key.trim(), models,
    }).then((outcome) => {
      if (outcome.ok) onReady({ id: route, name: displayName, models })
      else setError(refusalText(outcome, t))
    }).finally(() => { setBusy(false) })
  }

  return (
    <section className={css.group} aria-label={t('custom.title')}>
      <div className={css.groupHead}>
        <span className={css.rowText}>
          <h3 className={css.groupTitle}>{t('custom.title')}</h3>
          <span className={css.detail}>{t('custom.hint')}</span>
        </span>
        {open ? null : (
          <Button className={css.groupAction} variant="outline" size="sm" onClick={() => { setOpen(true) }}>{t('custom.open')}</Button>
        )}
      </div>
      {!open ? null : (
        <form className={css.form} onSubmit={(event) => { event.preventDefault(); if (found === undefined) discover(); else add() }}>
          <label className={css.field}>
            <span>{t('custom.baseURL')}</span>
            <Input value={baseURL} placeholder="http://localhost:8000/v1" disabled={busy}
              onChange={(event) => { setBaseURL(event.target.value); setFound(undefined) }} />
          </label>
          {urlInvalid ? <p className={css.error}>{t('custom.invalidURL')}</p> : null}
          <label className={css.field}>
            <span>{t('custom.key')}</span>
            <Input type="password" autoComplete="new-password" value={key} disabled={busy}
              onChange={(event) => { setKey(event.target.value); setFound(undefined) }} />
          </label>
          <label className={css.field}>
            <span>{t('custom.name')}</span>
            <Input value={name} placeholder={host ?? t('custom.namePlaceholder')} disabled={busy}
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
          {error === undefined ? null : <p className={css.error} role="alert">{error}</p>}
          <div className={css.formActions}>
            <Button type="button" variant="ghost" size="sm" disabled={busy} onClick={() => { setOpen(false) }}>{t('cancel')}</Button>
            {found === undefined
              ? <Button type="submit" variant="primary" size="sm" disabled={busy || host === undefined}>{t('custom.discover')}</Button>
              : <Button type="submit" variant="primary" size="sm" disabled={busy || ticked.size === 0}>{t('custom.add')}</Button>}
          </div>
        </form>
      )}
    </section>
  )
}

/** What one hosted row is doing. */
type HostedAction = { readonly provider: string; readonly kind: 'key' } | { readonly provider: string; readonly kind: 'signin'; readonly request: SignInRequest }

function HostedGroup({ hosted, retry, operations, t, onReady }: {
  hosted: Loaded<readonly HostedProvider[]>
  retry: () => void
  operations: FirstRunOperations
  t: Translate<FirstRunKey>
  onReady: (provider: ReadyProvider) => void
}): ReactNode {
  const [query, setQuery] = useState('')
  const [action, setAction] = useState<HostedAction>()
  const providers = hosted.status === 'ready' ? hosted.value : []
  const index = useMemo(
    () => new TextSearchIndex(providers, provider => ({ fuzzy: [provider.displayName, provider.provider] })),
    [providers],
  )
  const visible = index.search(query)
  return (
    <section className={css.group} aria-label={t('hosted.title')}>
      <div className={css.groupHead}><h3 className={css.groupTitle}>{t('hosted.title')}</h3></div>
      {hosted.status === 'loading' ? <p className={css.muted}><StateDot state="ongoing" /> {t('hosted.loading')}</p> : null}
      {hosted.status === 'error'
        ? (
          <div className={css.rowHead}>
            <p className={css.error} role="alert">{t('hosted.unavailable')}</p>
            <Button variant="ghost" size="sm" onClick={retry}>{t('retry')}</Button>
          </div>
        )
        : null}
      {hosted.status !== 'ready' ? null : (
        <>
          <Input value={query} placeholder={t('hosted.search')} aria-label={t('hosted.search')} onChange={(event) => { setQuery(event.target.value) }} />
          {visible.length === 0 ? <p className={css.muted}>{t('hosted.empty')}</p> : (
            <ul className={`${css.rows ?? ''} ${css.hostedList ?? ''}`}>
              {visible.map(provider => (
                <HostedRow key={provider.provider} provider={provider} action={action?.provider === provider.provider ? action : undefined}
                  operations={operations} t={t} setAction={setAction}
                  onReady={() => { onReady({ id: provider.provider, name: provider.displayName }) }} />
              ))}
            </ul>
          )}
        </>
      )}
    </section>
  )
}

function HostedRow({ provider, action, operations, t, setAction, onReady }: {
  provider: HostedProvider
  action: HostedAction | undefined
  operations: FirstRunOperations
  t: Translate<FirstRunKey>
  setAction: (action: HostedAction | undefined) => void
  onReady: () => void
}): ReactNode {
  const [key, setKey] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string>()
  const save = (): void => {
    setBusy(true)
    setError(undefined)
    void operations.addApiKeyAccount(provider.provider, key.trim()).then((outcome) => {
      if (outcome.ok) onReady()
      else setError(refusalText(outcome, t))
    }).finally(() => { setBusy(false) })
  }
  return (
    <li className={action === undefined ? css.row : `${css.row ?? ''} ${css.rowSelected ?? ''}`} data-first-run-hosted={provider.provider}>
      <div className={css.rowHead}>
        <span className={css.rowText}><span className={css.name}>{provider.displayName}</span></span>
        {action !== undefined ? null : (
          <div className={css.rowActions}>
            {provider.oauth
              ? (
                <Button variant="outline" size="sm" onClick={() => { setAction({ provider: provider.provider, kind: 'signin', request: { method: 'oauth' } }) }}>
                  {t('hosted.signIn')}
                </Button>
              )
              : null}
            <Button variant="outline" size="sm" onClick={() => {
              setAction(provider.simpleKey
                ? { provider: provider.provider, kind: 'key' }
                : { provider: provider.provider, kind: 'signin', request: { method: 'api-key' } })
            }}>
              {t('hosted.apiKey')}
            </Button>
          </div>
        )}
      </div>
      {action?.kind === 'signin'
        ? <SignInPanel provider={provider.provider} request={action.request} operations={operations} t={t}
          onAuthorized={onReady} onCancel={() => { setAction(undefined) }} />
        : null}
      {action?.kind === 'key'
        ? (
          <form className={css.form} onSubmit={(event) => { event.preventDefault(); save() }}>
            <label className={css.field}>
              <span>{t('hosted.keyLabel', { provider: provider.displayName })}</span>
              <Input type="password" autoComplete="new-password" value={key} disabled={busy} onChange={(event) => { setKey(event.target.value) }} />
            </label>
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
