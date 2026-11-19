/** Display helpers: time, shares, window names, the serving account, and badge provider order. */
import { makeTranslate } from '@deepseek-ai/dsh-client-test-runtime'
import { describe, expect, it } from 'vitest'
import {
  accountName, formatRemaining, hasReadings, mostConstrained, providersWithUsage, servingAccount, shownPercent,
  usedPercentOf, windowName,
} from '../src/client/format.ts'
import { en } from '../src/client/locales.ts'
import { account, HOUR, provider, snapshot, usage } from './fixtures.client.ts'

const t = makeTranslate(en)

describe('formatRemaining', () => {
  it('rounds up to the minute and picks the largest unit pair', () => {
    expect(formatRemaining(30_000, t)).toBe('under a minute')
    expect(formatRemaining(61_000, t)).toBe('2m')
    expect(formatRemaining(2 * HOUR + 5 * 60_000, t)).toBe('2h 5m')
    expect(formatRemaining(26 * HOUR, t)).toBe('1d 2h')
  })
})

describe('usage shares', () => {
  it('reads the percentage, else limit and remaining, clamped to 0-100', () => {
    expect(usedPercentOf({ kind: 'session', usedPercent: 140 })).toBe(100)
    expect(usedPercentOf({ kind: 'requests', limit: 200, remaining: 150 })).toBe(25)
    expect(usedPercentOf({ kind: 'tokens', limit: 0, remaining: 0 })).toBeUndefined()
    expect(usedPercentOf({ kind: 'other' })).toBeUndefined()
    expect(shownPercent(42.4, 'used')).toBe(42)
    expect(shownPercent(42.4, 'left')).toBe(58)
  })

  it('names windows by label or kind plus scope, and finds the most constrained one', () => {
    expect(windowName({ kind: 'weekly', scope: 'Opus' }, t)).toBe('Weekly · Opus')
    expect(windowName({ kind: 'other', label: '5h' }, t)).toBe('5h')
    expect(mostConstrained(usage())?.window.kind).toBe('session')
    expect(mostConstrained(undefined)).toBeUndefined()
    expect(hasReadings(usage({ windows: [{ kind: 'other' }] }))).toBe(false)
  })
})

describe('accounts', () => {
  it('prefers the alias, and serves the sticky account, else the default, else the first', () => {
    expect(accountName(account('main', { alias: 'Work' }))).toBe('Work')
    expect(accountName(account('main'))).toBe('Account main')
    const a = account('a'), b = account('b', { isDefault: true })
    expect(servingAccount(provider([a, b]))?.id).toBe('b')
    expect(servingAccount(provider([a, b], { serving: 'a' }))?.id).toBe('a')
    expect(servingAccount(provider([a]))?.id).toBe('a')
    expect(servingAccount(provider([]))).toBeUndefined()
  })

  it('orders providers with readings current-first and drops ones without readings', () => {
    const codex = provider([account('a', { usage: usage() })])
    const claude = provider([account('b', { provider: 'anthropic', usage: usage() })], { provider: 'anthropic', displayName: 'Claude' })
    const bare = provider([account('c', { provider: 'groq' })], { provider: 'groq' })
    expect(providersWithUsage(snapshot(codex, claude, bare), 'anthropic').map(view => view.provider)).toEqual(['anthropic', 'openai-codex'])
    expect(providersWithUsage(undefined, undefined)).toEqual([])
  })
})
