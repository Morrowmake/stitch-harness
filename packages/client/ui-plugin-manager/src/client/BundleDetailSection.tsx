/** A bundle's long description on its page: the Markdown document the Host reads for it. */
import { useEffect, useMemo, type ReactNode } from 'react'
import { DetailDocument, detailDocumentState, useDetailDocumentLabels, type MarkdownPathImages } from '@deepseek-ai/dsh-client-ui-primitives'
import type { PropsLocale } from '@deepseek-ai/dsh-client-ui-slots'
import { bundleDetailKey, type BundleDetailFailure, type BundleDetailsState } from './detail-store.ts'

type Translate = PropsLocale<'pluginManager'>['t']

const FAILURE_KEYS = {
  'too-large': 'detailTooLarge',
  'network': 'detailNetwork',
  'denied': 'detailFailed',
  'git-unavailable': 'detailFailed',
  'invalid': 'detailInvalid',
  'other': 'detailFailed',
} as const satisfies Record<BundleDetailFailure, string>

/** What the section reads and calls; the page passes them from its injected face. */
export interface BundleDetailSectionProps {
  readonly name: string
  readonly version: string | undefined
  /** Which document this section shows: the user guide the locale names (`locale`) or the README (`readme`). */
  readonly origin: 'locale' | 'readme'
  readonly language: string
  readonly details: BundleDetailsState
  readonly t: Translate
  readonly load: (name: string, version: string | undefined, language: string) => void
  readonly retry: (name: string, version: string | undefined, language: string) => void
  readonly image: (name: string, document: string, destination: string) => string | undefined
}

/**
 * Read and render a bundle's detail document in the active language once it is read and has the section's origin;
 * relative images load from the Host beside it. Both sections share one read, and the `locale` one reports a failure.
 * @param props - the bundle, the language, the reads, and the page's callbacks.
 * @returns the section, or null while reading and when the bundle has no document of that origin.
 */
export function BundleDetailSection(props: BundleDetailSectionProps): ReactNode {
  const { name, version, origin, language, details, t, load, retry, image } = props
  const key = bundleDetailKey(name, version, language)
  const state = details[key]
  useEffect(() => { load(name, version, language) }, [key, details])
  const labels = useDetailDocumentLabels({
    title: t(origin === 'locale' ? 'detailTitle' : 'detailReadmeTitle'), loading: t('detailLoading'), retry: t('retry'), copy: t('copy'), copied: t('copied'),
    codeBlock: t('codeBlock.title'), wrap: t('codeBlock.wrap'), unwrap: t('codeBlock.unwrap'), footnotes: t('detailFootnotes'),
  })
  const detail = state?.status === 'ready' ? state.detail : undefined
  const found = detail?.status === 'found' && detail.origin === origin ? detail : undefined
  const document = found?.path
  const images = useMemo<MarkdownPathImages | undefined>(
    () => document === undefined ? undefined : { resolve: value => image(name, document, value) },
    [name, document, image],
  )
  const failed = state?.status === 'error' && origin === 'locale'
  if (found === undefined && !failed) return null
  const shown = detailDocumentState(state?.status === 'error'
    ? { status: 'error', message: t(FAILURE_KEYS[state.failure]) }
    : { status: 'ready', markdown: found?.markdown })
  return <DetailDocument state={shown} labels={labels} images={images} onRetry={() => { retry(name, version, language) }} />
}
