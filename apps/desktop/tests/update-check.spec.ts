import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  checkLatestRelease, DesktopUpdateChecker, newerRelease, releaseAssetUrl, releaseInstall, RELEASES_URL, UPDATE_CHECK_INTERVAL_MS,
  type DesktopUpdateFetch, type DesktopUpdateTarget,
} from '../src/update-check.ts'
import { sha256Hex, signUpdateManifest, type UnsignedUpdateManifest } from '../src/update-manifest.ts'
import { releaseKey } from './helpers/update-signing.ts'

const PAGE = 'https://github.com/Morrowmake/stitch-harness/releases/tag/stitch-v1.2.0'
const key = releaseKey()
const MAC: DesktopUpdateTarget = { keys: [key.publicKey], platform: 'darwin', arch: 'arm64' }
const NO_KEYS: DesktopUpdateTarget = { keys: [], platform: 'darwin', arch: 'arm64' }

function release(fields: Record<string, unknown> = {}): Record<string, unknown> {
  return { tag_name: 'stitch-v1.2.0', name: 'Stitch 1.2.0', html_url: PAGE, draft: false, prerelease: false, ...fields }
}

function manifest(fields: Partial<UnsignedUpdateManifest> = {}, privateKey = key.privateKey): unknown {
  const asset = { name: 'stitch-1.2.0-mac-arm64-unsigned.zip', size: 3, sha256: sha256Hex(Buffer.from('zip')), signature: 'x' }
  return JSON.parse(JSON.stringify(signUpdateManifest({
    schema: 1, version: '1.2.0', tag: 'stitch-v1.2.0', releaseUrl: PAGE, publishedAt: '2026-11-21T00:00:00Z',
    assets: { 'darwin-arm64': asset }, ...fields,
  }, privateKey)))
}

/** GitHub stand-in: the release list, and `latest.json` of each release. */
function github(list: unknown, latest: unknown = manifest(), status = 200) {
  return vi.fn<DesktopUpdateFetch>(async url => url === RELEASES_URL
    ? new Response(JSON.stringify(list), { status })
    : new Response(JSON.stringify(latest), { status: 200 }))
}

beforeEach(() => { vi.spyOn(console, 'warn').mockImplementation(() => {}) })
afterEach(() => { vi.useRealTimers(); vi.restoreAllMocks() })

describe('newerRelease', () => {
  it.each([
    ['1.1.9', true],
    ['1.2.0', false],
    ['1.10.0', false],
    ['1.2.0-rc.1', true],
  ])('compares stitch-v1.2.0 against running %s by semver', (current, newer) => {
    expect(newerRelease([release()], current))
      .toEqual(newer ? { version: '1.2.0', tag: 'stitch-v1.2.0', name: 'Stitch 1.2.0', url: PAGE } : undefined)
  })

  it('ignores drafts and prereleases while the running version is a release', () => {
    expect(newerRelease([release({ draft: true })], '1.0.0')).toBeUndefined()
    expect(newerRelease([release({ prerelease: true })], '1.0.0')).toBeUndefined()
    expect(newerRelease([release({ tag_name: 'stitch-v1.3.0-beta.1' })], '1.0.0')).toBeUndefined()
  })

  it('offers newer prereleases when the running version is itself a prerelease, but never drafts', () => {
    expect(newerRelease([release({ tag_name: 'stitch-v1.3.0-beta.2', prerelease: true })], '1.3.0-beta.1')?.version).toBe('1.3.0-beta.2')
    expect(newerRelease([release({ tag_name: 'stitch-v1.3.0-beta.1', prerelease: true })], '1.3.0-beta.1')).toBeUndefined()
    expect(newerRelease([release({ tag_name: 'stitch-v1.3.0-beta.2', draft: true })], '1.3.0-beta.1')).toBeUndefined()
  })

  it('picks the newest eligible entry and skips unusable ones', () => {
    const list = [
      release({ tag_name: 'nightly' }),
      release({ tag_name: 'stitch-v1.4.0', html_url: 'https://example.com/releases/v1.4.0' }),
      release({ tag_name: 'stitch-v1.5.0', draft: true }),
      release({ tag_name: 'stitch-v1.1.0' }),
      release({ tag_name: 'v1.3.0', name: 'Three' }),
      null,
    ]
    expect(newerRelease(list, '1.0.0')).toMatchObject({ version: '1.3.0', tag: 'v1.3.0', name: 'Three' })
  })

  it('falls back to the tag when the release has no name', () => {
    expect(newerRelease([release({ name: '  ' })], '1.0.0')?.name).toBe('stitch-v1.2.0')
  })

  it.each([['a non-list', release()], ['null', null]])('rejects %s', (_label, body) => {
    expect(() => newerRelease(body, '1.0.0')).toThrow()
  })
})

describe('releaseInstall', () => {
  const selected = { version: '1.2.0', tag: 'stitch-v1.2.0' }

  it('picks this platform asset from a verified manifest, using the manifest asset name', () => {
    expect(releaseInstall(manifest(), selected, '1.0.0', MAC)?.asset.name).toBe('stitch-1.2.0-mac-arm64-unsigned.zip')
    expect(releaseInstall(manifest(), selected, '1.0.0', { ...MAC, platform: 'win32', arch: 'x64' })).toBeUndefined()
  })

  it.each([
    ['an untrusted signature', manifest({}, releaseKey().privateKey), selected, '1.0.0'],
    ['an unsigned manifest', (({ manifestSignature: _s, ...rest }) => rest)(manifest() as Record<string, unknown>), selected, '1.0.0'],
    ['another release tag', manifest({ tag: 'stitch-v1.1.0' }), selected, '1.0.0'],
    ['another version', manifest({ version: '1.2.1' }), selected, '1.0.0'],
    ['a downgrade', manifest({ version: '1.2.0' }), selected, '1.3.0'],
  ])('rejects %s', (_label, body, chosen, current) => {
    expect(() => releaseInstall(body, chosen, current, MAC)).toThrow()
  })
})

describe('checkLatestRelease', () => {
  it('requests the release list and the release manifest with a product User-Agent and no credentials', async () => {
    const fetch = github([release()])
    const result = await checkLatestRelease(fetch, '1.0.0', MAC)
    expect(result).toMatchObject({ kind: 'available', release: { version: '1.2.0', url: PAGE, install: { asset: { size: 3 } } } })
    expect(fetch).toHaveBeenCalledTimes(2)
    const [[listUrl, init], [manifestUrl]] = fetch.mock.calls as [[string, RequestInit], [string, RequestInit]]
    expect(listUrl).toBe('https://api.github.com/repos/Morrowmake/stitch-harness/releases?per_page=30')
    expect(manifestUrl).toBe(releaseAssetUrl('stitch-v1.2.0', 'latest.json'))
    expect(manifestUrl).toBe('https://github.com/Morrowmake/stitch-harness/releases/download/stitch-v1.2.0/latest.json')
    expect(init).toMatchObject({ method: 'GET', credentials: 'omit', referrerPolicy: 'no-referrer' })
    expect(init.headers).toEqual({ 'User-Agent': 'Stitch/1.0.0', Accept: 'application/vnd.github+json' })
  })

  it('offers the release without one-click install and without fetching a manifest when no key is embedded', async () => {
    const fetch = github([release()])
    const result = await checkLatestRelease(fetch, '1.0.0', NO_KEYS)
    expect(result).toEqual({ kind: 'available', release: { version: '1.2.0', tag: 'stitch-v1.2.0', name: 'Stitch 1.2.0', url: PAGE } })
    expect(fetch).toHaveBeenCalledOnce()
  })

  it('still offers manual download when the manifest is missing or fails verification', async () => {
    for (const latest of [{ message: 'Not Found' }, manifest({}, releaseKey().privateKey)]) {
      const result = await checkLatestRelease(github([release()], latest), '1.0.0', MAC)
      expect(result).toMatchObject({ kind: 'available', release: { version: '1.2.0' } })
      expect(result.kind === 'available' && result.release.install).toBeUndefined()
    }
  })

  it('reports the running version when it is current without fetching a manifest', async () => {
    const fetch = github([release()])
    await expect(checkLatestRelease(fetch, '1.2.0', MAC)).resolves.toEqual({ kind: 'current', version: '1.2.0' })
    expect(fetch).toHaveBeenCalledOnce()
  })

  it('turns HTTP, network, and format failures of the list into a failed result', async () => {
    await expect(checkLatestRelease(github({ message: 'rate limited' }, undefined, 403), '1.0.0', MAC)).resolves.toEqual({ kind: 'failed' })
    await expect(checkLatestRelease(vi.fn<DesktopUpdateFetch>(async () => { throw new Error('offline') }), '1.0.0', MAC))
      .resolves.toEqual({ kind: 'failed' })
    await expect(checkLatestRelease(github({ unexpected: true }), '1.0.0', MAC)).resolves.toEqual({ kind: 'failed' })
  })
})

describe('DesktopUpdateChecker', () => {
  function checker(enabled: { value: boolean }, fetch: DesktopUpdateFetch = github([release()])) {
    const onAvailable = vi.fn()
    const instance = new DesktopUpdateChecker({ currentVersion: '1.0.0', enabled: () => enabled.value, fetch, target: NO_KEYS, onAvailable })
    return { instance, onAvailable }
  }
  const available = { version: '1.2.0', tag: 'stitch-v1.2.0', name: 'Stitch 1.2.0', url: PAGE }

  it('never requests GitHub automatically while the preference is off, across startup and many days', async () => {
    vi.useFakeTimers()
    const fetch = github([release()])
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
    const fetch = github([release()])
    const { instance, onAvailable } = checker({ value: true }, fetch)
    instance.sync()
    await vi.advanceTimersByTimeAsync(0)
    expect(fetch).toHaveBeenCalledTimes(1)
    expect(onAvailable).toHaveBeenCalledWith(available)
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
    const fetch = github([release()])
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
    ['an available release', [release()], { kind: 'available', release: available }],
    ['the current version', [release({ tag_name: 'stitch-v1.0.0' })], { kind: 'current', version: '1.0.0' }],
  ])('reports %s from Check now even while the preference is off', async (_label, body, expected) => {
    const fetch = github(body)
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
