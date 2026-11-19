import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  checkLatestRelease, DesktopUpdateChecker, LATEST_RELEASE_URL, newerRelease, UPDATE_CHECK_INTERVAL_MS,
  type DesktopUpdateFetch,
} from '../src/update-check.ts'

const PAGE = 'https://github.com/Morrowmake/stitch-harness/releases/tag/v1.2.0'

function release(fields: Record<string, unknown> = {}): Record<string, unknown> {
  return { tag_name: 'v1.2.0', name: 'Stitch 1.2.0', html_url: PAGE, draft: false, prerelease: false, ...fields }
}

function fetchReturning(body: unknown, status = 200) {
  return vi.fn<DesktopUpdateFetch>(async () => new Response(JSON.stringify(body), { status }))
}

beforeEach(() => { vi.spyOn(console, 'warn').mockImplementation(() => {}) })
afterEach(() => { vi.useRealTimers(); vi.restoreAllMocks() })

describe('newerRelease', () => {
  it.each([
    ['1.1.9', true],
    ['1.2.0', false],
    ['1.10.0', false],
    ['1.2.0-rc.1', true],
  ])('compares v1.2.0 against running %s by semver', (current, newer) => {
    expect(newerRelease(release(), current)).toEqual(newer ? { version: '1.2.0', name: 'Stitch 1.2.0', url: PAGE } : undefined)
  })

  it('ignores drafts and prereleases while the running version is a release', () => {
    expect(newerRelease(release({ draft: true }), '1.0.0')).toBeUndefined()
    expect(newerRelease(release({ prerelease: true }), '1.0.0')).toBeUndefined()
    expect(newerRelease(release({ tag_name: 'v1.3.0-beta.1' }), '1.0.0')).toBeUndefined()
  })

  it('offers newer prereleases when the running version is itself a prerelease, but never drafts', () => {
    expect(newerRelease(release({ tag_name: 'v1.3.0-beta.2', prerelease: true }), '1.3.0-beta.1'))
      .toEqual({ version: '1.3.0-beta.2', name: 'Stitch 1.2.0', url: PAGE })
    expect(newerRelease(release({ tag_name: 'v1.3.0-beta.1', prerelease: true }), '1.3.0-beta.1')).toBeUndefined()
    expect(newerRelease(release({ tag_name: 'v1.3.0-beta.2', draft: true }), '1.3.0-beta.1')).toBeUndefined()
  })

  it('falls back to the tag when the release has no name', () => {
    expect(newerRelease(release({ name: '  ' }), '1.0.0')?.name).toBe('v1.2.0')
  })

  it.each([
    ['a non-object', null],
    ['an invalid tag', release({ tag_name: 'nightly' })],
    ['a foreign release page', release({ html_url: 'https://example.com/releases/v1.2.0' })],
    ['another repository', release({ html_url: 'https://github.com/someone/else/releases/tag/v1.2.0' })],
  ])('rejects %s', (_label, body) => {
    expect(() => newerRelease(body, '1.0.0')).toThrow()
  })
})

describe('checkLatestRelease', () => {
  it('requests only the latest release with a product User-Agent and no credentials', async () => {
    const fetch = fetchReturning(release())
    await expect(checkLatestRelease(fetch, '1.0.0')).resolves.toEqual({
      kind: 'available', release: { version: '1.2.0', name: 'Stitch 1.2.0', url: PAGE },
    })
    expect(fetch).toHaveBeenCalledOnce()
    const [url, init] = fetch.mock.calls[0]!
    expect(url).toBe(LATEST_RELEASE_URL)
    expect(url).toBe('https://api.github.com/repos/Morrowmake/stitch-harness/releases/latest')
    expect(init).toMatchObject({ method: 'GET', credentials: 'omit', referrerPolicy: 'no-referrer' })
    expect(init.headers).toEqual({ 'User-Agent': 'Stitch/1.0.0', Accept: 'application/vnd.github+json' })
  })

  it('reports the running version when it is current', async () => {
    await expect(checkLatestRelease(fetchReturning(release()), '1.2.0')).resolves.toEqual({ kind: 'current', version: '1.2.0' })
  })

  it('turns HTTP, network, and format failures into a failed result', async () => {
    await expect(checkLatestRelease(fetchReturning({ message: 'rate limited' }, 403), '1.0.0')).resolves.toEqual({ kind: 'failed' })
    await expect(checkLatestRelease(vi.fn<DesktopUpdateFetch>(async () => { throw new Error('offline') }), '1.0.0'))
      .resolves.toEqual({ kind: 'failed' })
    await expect(checkLatestRelease(fetchReturning({ unexpected: true }), '1.0.0')).resolves.toEqual({ kind: 'failed' })
  })
})

describe('DesktopUpdateChecker', () => {
  function checker(enabled: { value: boolean }, fetch: DesktopUpdateFetch = fetchReturning(release())) {
    const onAvailable = vi.fn()
    const instance = new DesktopUpdateChecker({ currentVersion: '1.0.0', enabled: () => enabled.value, fetch, onAvailable })
    return { instance, onAvailable }
  }

  it('never requests GitHub while the preference is off, across startup and many days', async () => {
    vi.useFakeTimers()
    const fetch = fetchReturning(release())
    const { instance, onAvailable } = checker({ value: false }, fetch)
    instance.sync()
    await vi.advanceTimersByTimeAsync(UPDATE_CHECK_INTERVAL_MS * 7)
    instance.sync()
    await vi.advanceTimersByTimeAsync(UPDATE_CHECK_INTERVAL_MS * 7)
    expect(fetch).not.toHaveBeenCalled()
    expect(onAvailable).not.toHaveBeenCalled()
    instance.dispose()
  })

  it('checks at startup and then once a day while on, presenting newer releases', async () => {
    vi.useFakeTimers()
    const fetch = fetchReturning(release())
    const { instance, onAvailable } = checker({ value: true }, fetch)
    instance.sync()
    await vi.advanceTimersByTimeAsync(0)
    expect(fetch).toHaveBeenCalledTimes(1)
    expect(onAvailable).toHaveBeenCalledWith({ version: '1.2.0', name: 'Stitch 1.2.0', url: PAGE })
    instance.sync()
    await vi.advanceTimersByTimeAsync(UPDATE_CHECK_INTERVAL_MS - 1)
    expect(fetch).toHaveBeenCalledTimes(1)
    await vi.advanceTimersByTimeAsync(1)
    expect(fetch).toHaveBeenCalledTimes(2)
    await vi.advanceTimersByTimeAsync(UPDATE_CHECK_INTERVAL_MS)
    expect(fetch).toHaveBeenCalledTimes(3)
    instance.dispose()
    await vi.advanceTimersByTimeAsync(UPDATE_CHECK_INTERVAL_MS * 3)
    expect(fetch).toHaveBeenCalledTimes(3)
  })

  it('checks immediately when turned on and stops the daily timer when turned off', async () => {
    vi.useFakeTimers()
    const enabled = { value: false }
    const fetch = fetchReturning(release())
    const { instance } = checker(enabled, fetch)
    instance.sync()
    enabled.value = true
    instance.sync()
    await vi.advanceTimersByTimeAsync(0)
    expect(fetch).toHaveBeenCalledOnce()
    enabled.value = false
    instance.sync()
    await vi.advanceTimersByTimeAsync(UPDATE_CHECK_INTERVAL_MS * 3)
    expect(fetch).toHaveBeenCalledOnce()
  })

  it('keeps automatic failures silent', async () => {
    const { instance, onAvailable } = checker({ value: true }, vi.fn<DesktopUpdateFetch>(async () => { throw new Error('offline') }))
    instance.sync()
    await vi.waitFor(() => { expect(console.warn).toHaveBeenCalled() })
    expect(onAvailable).not.toHaveBeenCalled()
    instance.dispose()
  })

  it.each([
    ['an available release', release(), { kind: 'available', release: { version: '1.2.0', name: 'Stitch 1.2.0', url: PAGE } }],
    ['the current version', release({ tag_name: 'v1.0.0' }), { kind: 'current', version: '1.0.0' }],
  ])('reports %s from Check now even while the preference is off', async (_label, body, expected) => {
    const fetch = fetchReturning(body)
    const { instance, onAvailable } = checker({ value: false }, fetch)
    await expect(instance.checkNow()).resolves.toEqual(expected)
    expect(fetch).toHaveBeenCalledOnce()
    expect(onAvailable).not.toHaveBeenCalled()
  })

  it('reports failures from Check now and joins a concurrent request', async () => {
    const reply = Promise.withResolvers<Response>()
    const fetch = vi.fn<DesktopUpdateFetch>(() => reply.promise)
    const { instance } = checker({ value: false }, fetch)
    const first = instance.checkNow()
    const second = instance.checkNow()
    reply.resolve(new Response('busy', { status: 503 }))
    await expect(Promise.all([first, second])).resolves.toEqual([{ kind: 'failed' }, { kind: 'failed' }])
    expect(fetch).toHaveBeenCalledOnce()
  })
})
