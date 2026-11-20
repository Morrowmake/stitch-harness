/**
 * Refusal text: every Host code the dialog knows reads as a localized sentence in each language, an unknown code
 * shows the Host's message (never the bare code), and a refusal without a message falls back to a generic sentence.
 */
import { makeTranslate } from '@deepseek-ai/dsh-client-test-runtime'
import { describe, expect, it } from 'vitest'
import { refusalText, thrownText } from '../src/client/errors.ts'
import { de, en, es, fr, ja, pt, ru, zh, type FirstRunKey } from '../src/client/locales.ts'

const KNOWN: ReadonlyArray<[code: string, key: FirstRunKey]> = [
  ['llm-accounts/attempt-busy', 'signin.busy'],
  ['llm-accounts/invalid-key', 'hosted.keyInvalid'],
  ['llm-accounts/unsupported', 'error.unsupported'],
  ['llm-accounts/settings-rejected', 'error.settingsRejected'],
  ['llm-accounts/unknown-account', 'error.signinGone'],
  ['llm-accounts/attempt-unknown', 'error.signinGone'],
  ['llm/model-discovery-rejected', 'error.discovery'],
  ['settings/conflict', 'error.settingsConflict'],
  ['plugin-manager/management-required', 'error.componentsReadOnly'],
  ['plugin-manager/unaddressable', 'error.componentsReadOnly'],
  ['plugin-manager/bundle-in-use', 'error.componentsInUse'],
  ['plugin-manager/unknown-plugin', 'error.componentsMissing'],
  ['plugin-manager/not-bundle', 'error.componentsMissing'],
  ['plugin-manager/unexpected-package', 'error.componentsMissing'],
  ['plugin-manager/incompatible-version', 'error.componentsIncompatible'],
  ['plugin-manager/unsupported-platform', 'error.componentsIncompatible'],
  ['plugin-manager/cancelled', 'error.componentsCancelled'],
  ['plugin-manager/overridden', 'error.componentsOverridden'],
]

describe('refusalText', () => {
  it.each([['en', en], ['zh', zh], ['ja', ja], ['es', es], ['fr', fr], ['de', de], ['ru', ru], ['pt', pt]] as const)(
    'localizes every known code in %s without showing the code',
    (_language, dictionary) => {
      const t = makeTranslate(dictionary)
      for (const [code, key] of KNOWN) {
        const text = refusalText({ ok: false, code, message: 'host detail' }, t)
        expect(text).toBe(dictionary[key])
        expect(text).not.toContain(code)
      }
    },
  )

  it('shows the Host message for unknown codes and a generic sentence when there is none', () => {
    const t = makeTranslate(en)
    expect(refusalText({ ok: false, code: 'gateway/internal', message: 'socket closed' }, t)).toBe('Something went wrong: socket closed')
    expect(refusalText({ ok: false, code: 'plugin-manager/operation-error', message: 'pnpm exited with 1' }, t))
      .toBe('Something went wrong: pnpm exited with 1')
    const bare = refusalText({ ok: false, code: 'plugin-manager/stop-profile', message: '' }, t)
    expect(bare).toBe(en['error.unknown'])
    expect(bare).not.toContain('stop-profile')
    // Codes are looked up as own keys only.
    expect(refusalText({ ok: false, code: 'toString', message: '' }, t)).toBe(en['error.unknown'])
  })

  it('reports thrown transport failures with their message', () => {
    const t = makeTranslate(zh)
    expect(thrownText(new Error('连接已断开'), t)).toBe('出现问题：连接已断开')
    expect(thrownText('', t)).toBe(zh['error.unknown'])
  })
})
