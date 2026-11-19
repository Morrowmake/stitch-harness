/**
 * Usage cache semantics (ported from dsh-plugin-subscriptions' PoolUsageTracker
 * tests, Copyright (c) 2026 V1ki, MIT License).
 */

import { describe, expect, it, vi } from 'vitest'
import { UsageCache } from '../src/accounts/usage/cache.ts'
import { UsageCredentialError, UsageFetchError } from '../src/accounts/usage/http.ts'
import type { FetchedUsage } from '../src/accounts/usage/http.ts'

const SNAPSHOT: FetchedUsage = { windows: [{ kind: 'session', usedPercent: 40, resetsAt: 9_000_000 }] }

function clock(start = 1_000_000): { now: () => number; advance: (ms: number) => void } {
  let at = start
  return { now: () => at, advance: (ms) => { at += ms } }
}

describe('UsageCache', () => {
  it('serves a fresh snapshot without re-fetching until the TTL passes', async () => {
    const time = clock()
    const cache = new UsageCache({ now: time.now })
    const load = vi.fn(() => Promise.resolve(SNAPSHOT))
    await cache.refresh('r', 'a', load)
    await cache.refresh('r', 'a', load)
    expect(load).toHaveBeenCalledTimes(1)
    expect(cache.peek('r', 'a')).toMatchObject({ source: 'endpoint', fetchedAt: 1_000_000, staleAt: 1_300_000 })
    time.advance(300_000)
    expect(cache.peek('r', 'a')?.stale).toBe(true)
    await cache.refresh('r', 'a', load)
    expect(load).toHaveBeenCalledTimes(2)
  })

  it('dedupes concurrent lookups', async () => {
    const cache = new UsageCache()
    const { promise, resolve } = Promise.withResolvers<FetchedUsage>()
    const load = vi.fn(() => promise)
    const both = Promise.all([cache.refresh('r', 'a', load), cache.refresh('r', 'a', load)])
    resolve(SNAPSHOT)
    await both
    expect(load).toHaveBeenCalledTimes(1)
  })

  it('negative-caches for the endpoint retry-after; force bypasses a fresh snapshot but not a cooldown', async () => {
    const time = clock()
    const cache = new UsageCache({ now: time.now })
    await cache.refresh('r', 'a', () => Promise.resolve(SNAPSHOT))
    const fresh = vi.fn(() => Promise.resolve(SNAPSHOT))
    await cache.refresh('r', 'a', fresh, { force: true })
    expect(fresh).toHaveBeenCalledTimes(1)

    const failing = vi.fn(() => Promise.reject(new UsageFetchError('429', 429, 60_000)))
    const view = await cache.refresh('r', 'a', failing, { force: true })
    expect(view).toMatchObject({ refreshFailed: true, retryAt: 1_060_000, windows: SNAPSHOT.windows })
    await cache.refresh('r', 'a', failing, { force: true })
    expect(failing).toHaveBeenCalledTimes(1)
    time.advance(60_000)
    await cache.refresh('r', 'a', failing, { force: true })
    expect(failing).toHaveBeenCalledTimes(2)
  })

  it('falls back to the default failure TTL and reports a failure with nothing cached', async () => {
    const time = clock()
    const cache = new UsageCache({ now: time.now, failureTtlMs: 1_000 })
    const view = await cache.refresh('r', 'a', () => Promise.reject(new Error('boom')))
    expect(view).toEqual({ supported: true, source: 'endpoint', refreshFailed: true, retryAt: 1_001_000, windows: [] })
    expect(cache.settled('r', 'a')).toBe(true)
    time.advance(1_000)
    expect(cache.settled('r', 'a')).toBe(false)
  })

  it('never negative-caches a missing credential', async () => {
    const cache = new UsageCache()
    await expect(cache.refresh('r', 'a', () => Promise.reject(new UsageCredentialError('none')))).rejects.toBeInstanceOf(UsageCredentialError)
    const load = vi.fn(() => Promise.resolve(SNAPSHOT))
    await cache.refresh('r', 'a', load)
    expect(load).toHaveBeenCalledTimes(1)
  })

  it('merges newer header windows over the endpoint snapshot and stands alone without one', async () => {
    const time = clock()
    const cache = new UsageCache({ now: time.now })
    cache.observe('r', 'b', { at: time.now(), windows: [{ kind: 'requests', limit: 100, remaining: 25, usedPercent: 75 }] })
    expect(cache.peek('r', 'b')).toMatchObject({ source: 'headers', windows: [{ kind: 'requests', usedPercent: 75 }] })

    await cache.refresh('r', 'a', () => Promise.resolve(SNAPSHOT))
    cache.observe('r', 'a', { at: time.now() - 1, windows: [{ kind: 'session', usedPercent: 1 }] })
    expect(cache.peek('r', 'a')?.windows).toEqual(SNAPSHOT.windows)
    time.advance(10)
    cache.observe('r', 'a', { at: time.now(), windows: [{ kind: 'session', usedPercent: 55 }, { kind: 'weekly', usedPercent: 3 }] })
    expect(cache.peek('r', 'a')?.windows).toEqual([{ kind: 'session', usedPercent: 55 }, { kind: 'weekly', usedPercent: 3 }])
  })

  it('invalidates and retains per account, and expire forces the next lookup', async () => {
    const cache = new UsageCache()
    const load = vi.fn(() => Promise.resolve(SNAPSHOT))
    await cache.refresh('r', 'a', load)
    await cache.refresh('r', 'b', load)
    cache.expire('r', 'a')
    await cache.refresh('r', 'a', load)
    expect(load).toHaveBeenCalledTimes(3)
    cache.retain('r', new Set(['a']))
    expect(cache.peek('r', 'b')).toBeUndefined()
    cache.invalidate('r', 'a')
    expect(cache.peek('r', 'a')).toBeUndefined()
  })
})
