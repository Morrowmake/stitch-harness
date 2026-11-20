/**
 * Refusal text for the first-run steps: known Host error codes read as localized
 * sentences; an unknown code shows the Host's own message, never the bare code.
 */
import type { Translate } from '@deepseek-ai/dsh-client-ui-slots'
import type { FirstRunKey } from './locales.ts'
import type { Outcome } from './operations.ts'

/** Host error codes the dialog explains in its own words. */
const CODE_KEYS: Readonly<Record<string, FirstRunKey>> = {
  'llm-accounts/attempt-busy': 'signin.busy',
  'llm-accounts/invalid-key': 'hosted.keyInvalid',
  'llm-accounts/unsupported': 'error.unsupported',
  'llm-accounts/settings-rejected': 'error.settingsRejected',
  'llm-accounts/unknown-account': 'error.signinGone',
  'llm-accounts/attempt-unknown': 'error.signinGone',
  'llm/model-discovery-rejected': 'error.discovery',
  'settings/conflict': 'error.settingsConflict',
  'plugin-manager/management-required': 'error.componentsReadOnly',
  'plugin-manager/unaddressable': 'error.componentsReadOnly',
  'plugin-manager/bundle-in-use': 'error.componentsInUse',
  'plugin-manager/unknown-plugin': 'error.componentsMissing',
  'plugin-manager/not-bundle': 'error.componentsMissing',
  'plugin-manager/unexpected-package': 'error.componentsMissing',
  'plugin-manager/incompatible-version': 'error.componentsIncompatible',
  'plugin-manager/unsupported-platform': 'error.componentsIncompatible',
  'plugin-manager/cancelled': 'error.componentsCancelled',
  'plugin-manager/overridden': 'error.componentsOverridden',
}

/**
 * The text of a refused call.
 * @param outcome - a refused outcome.
 * @param t - the translator.
 * @returns the localized sentence for a known code, else the Host's message, else a generic sentence.
 */
export function refusalText(outcome: Extract<Outcome<unknown>, { ok: false }>, t: Translate<FirstRunKey>): string {
  const key = Object.hasOwn(CODE_KEYS, outcome.code) ? CODE_KEYS[outcome.code] : undefined
  if (key !== undefined) return t(key)
  return outcome.message === '' ? t('error.unknown') : t('action.failed', { message: outcome.message })
}

/**
 * The text of a thrown failure (a transport error rather than a Host refusal).
 * @param cause - what was thrown.
 * @param t - the translator.
 * @returns the localized sentence carrying the error's own message.
 */
export function thrownText(cause: unknown, t: Translate<FirstRunKey>): string {
  const message = cause instanceof Error ? cause.message : String(cause)
  return message === '' ? t('error.unknown') : t('action.failed', { message })
}
