import { describe, expect, it } from 'vitest'
import {
  canonicalJson, canonicalManifestJson, selectUpdateAsset, sha256Hex, signUpdateManifest, signUpdatePayload, updatePlatformKey,
  updatePublicKey, verifyUpdateAsset, verifyUpdateManifest, type UnsignedUpdateManifest,
} from '../src/update-manifest.ts'
import { UPDATE_PUBLIC_KEYS } from '../src/update-public-key.ts'
import { releaseKey } from './helpers/update-signing.ts'

const payload = Buffer.from('stitch update payload')

function unsigned(fields: Partial<UnsignedUpdateManifest> = {}): UnsignedUpdateManifest {
  const asset = { name: 'stitch-1.2.0-mac-arm64.zip', size: payload.length, sha256: sha256Hex(payload), signature: 'unused' }
  return {
    schema: 1, version: '1.2.0', tag: 'stitch-v1.2.0',
    releaseUrl: 'https://github.com/Morrowmake/stitch-harness/releases/tag/stitch-v1.2.0', publishedAt: '2026-11-21T00:00:00Z',
    assets: { 'darwin-arm64': asset, 'win32-x64': { ...asset, name: 'stitch-1.2.0-win-x64.exe' } },
    ...fields,
  }
}

describe('canonical JSON', () => {
  it('sorts keys at every depth, keeps array order, and has no whitespace', () => {
    expect(canonicalJson({ b: 1, a: { d: [3, { z: true, y: null }], c: 'x"y' } }))
      .toBe('{"a":{"c":"x\\"y","d":[3,{"y":null,"z":true}]},"b":1}')
  })

  it('excludes only manifestSignature from the signed text', () => {
    const manifest = unsigned()
    expect(canonicalManifestJson({ ...manifest, manifestSignature: 'sig' })).toBe(canonicalManifestJson(manifest))
    expect(canonicalManifestJson(manifest)).toMatch(/^\{"assets":\{"darwin-arm64":\{"name":/u)
  })

  it.each([[Number.NaN], [undefined], [() => 1]])('rejects non-JSON values', (value) => {
    expect(() => canonicalJson({ value })).toThrow()
  })
})

describe('manifest verification', () => {
  const key = releaseKey()

  it('accepts a manifest signed by an embedded key, including a rotated second key', () => {
    const signed = signUpdateManifest(unsigned(), key.privateKey)
    const body: unknown = JSON.parse(JSON.stringify(signed))
    expect(verifyUpdateManifest(body, [key.publicKey])).toEqual(signed)
    expect(verifyUpdateManifest(body, [releaseKey().publicKey, key.publicKey]).version).toBe('1.2.0')
  })

  it('verifies the object as received, regardless of key order', () => {
    const signed = signUpdateManifest(unsigned(), key.privateKey)
    const reordered = Object.fromEntries(Object.entries(signed).reverse())
    expect(verifyUpdateManifest(reordered, [key.publicKey]).tag).toBe('stitch-v1.2.0')
  })

  it.each([
    ['a changed version', (m: Record<string, unknown>) => ({ ...m, version: '9.9.9' })],
    ['a changed asset digest', (m: Record<string, unknown>) => ({ ...m, assets: { 'darwin-arm64': { name: 'x.zip', size: 1, sha256: '0'.repeat(64), signature: 'AA==' } } })],
    ['an added field', (m: Record<string, unknown>) => ({ ...m, extra: true })],
    ['a missing signature', ({ manifestSignature: _signature, ...m }: Record<string, unknown>) => m],
    ['a malformed signature', (m: Record<string, unknown>) => ({ ...m, manifestSignature: 'not base64 of 64 bytes' })],
  ])('rejects %s', (_label, tamper) => {
    const signed: Record<string, unknown> = { ...signUpdateManifest(unsigned(), key.privateKey) }
    expect(() => verifyUpdateManifest(tamper(signed), [key.publicKey])).toThrow()
  })

  it('rejects a manifest signed by an untrusted key', () => {
    const signed = signUpdateManifest(unsigned(), releaseKey().privateKey)
    expect(() => verifyUpdateManifest(signed, [key.publicKey])).toThrow(/trusted key/u)
  })

  it('rejects every manifest when no key is embedded', () => {
    const signed = signUpdateManifest(unsigned(), key.privateKey)
    expect(() => verifyUpdateManifest(signed, [])).toThrow(/no trusted update keys/u)
  })

  it('embeds only well-formed raw ed25519 release keys', () => {
    expect(UPDATE_PUBLIC_KEYS.length).toBeGreaterThan(0)
    for (const embedded of UPDATE_PUBLIC_KEYS) expect(() => updatePublicKey(embedded)).not.toThrow()
  })

  it('rejects the real key list for a manifest signed by a test key', () => {
    expect(() => verifyUpdateManifest(signUpdateManifest(unsigned(), key.privateKey), UPDATE_PUBLIC_KEYS)).toThrow(/trusted key/u)
  })

  it.each<[string, Record<string, unknown>]>([
    ['an unsupported schema', { schema: 2 }],
    ['an invalid version', { version: 'latest' }],
    ['an unsafe asset name', { assets: { 'win32-x64': { name: '../evil.exe', size: 1, sha256: '0'.repeat(64), signature: 'x' } } }],
    ['a non-positive size', { assets: { 'win32-x64': { name: 'a.exe', size: 0, sha256: '0'.repeat(64), signature: 'x' } } }],
  ])('rejects a correctly signed manifest with %s', (_label, fields) => {
    const body = { ...unsigned(), ...fields }
    const manifestSignature = signUpdatePayload(Buffer.from(canonicalManifestJson(body), 'utf8'), key.privateKey)
    expect(() => verifyUpdateManifest({ ...body, manifestSignature }, [key.publicKey])).toThrow()
  })
})

describe('asset selection and verification', () => {
  const key = releaseKey()

  it.each([
    ['darwin', 'arm64', 'darwin-arm64'],
    ['darwin', 'x64', 'darwin-x64'],
    ['win32', 'x64', 'win32-x64'],
    ['win32', 'arm64', undefined],
    ['linux', 'x64', undefined],
  ])('maps %s-%s to %s', (platform, arch, expected) => {
    expect(updatePlatformKey(platform, arch)).toBe(expected)
  })

  it('selects this platform asset and nothing for a missing one', () => {
    const manifest = unsigned()
    expect(selectUpdateAsset(manifest, 'darwin', 'arm64')?.name).toBe('stitch-1.2.0-mac-arm64.zip')
    expect(selectUpdateAsset(manifest, 'win32', 'x64')?.name).toBe('stitch-1.2.0-win-x64.exe')
    expect(selectUpdateAsset(manifest, 'darwin', 'x64')).toBeUndefined()
    expect(selectUpdateAsset(manifest, 'linux', 'x64')).toBeUndefined()
  })

  it('accepts the exact signed bytes', () => {
    const asset = { name: 'a.zip', size: payload.length, sha256: sha256Hex(payload), signature: signUpdatePayload(payload, key.privateKey) }
    expect(() => { verifyUpdateAsset(payload, asset, [key.publicKey]) }).not.toThrow()
  })

  it.each([
    ['a size mismatch', Buffer.concat([payload, Buffer.from('!')]), {}, /bytes/u],
    ['an asset sha256 mismatch', Buffer.from(payload).fill(0x41, 0, 1), {}, /sha256/u],
    ['a bad signature', payload, { signature: Buffer.alloc(64).toString('base64') }, /signature/u],
  ])('rejects %s', (_label, data, override, error) => {
    const asset = { name: 'a.zip', size: payload.length, sha256: sha256Hex(payload), signature: signUpdatePayload(payload, key.privateKey), ...override }
    expect(() => { verifyUpdateAsset(data, asset, [key.publicKey]) }).toThrow(error)
  })

  it('rejects an asset signed by another key even when its digest matches', () => {
    const asset = { name: 'a.zip', size: payload.length, sha256: sha256Hex(payload), signature: signUpdatePayload(payload, releaseKey().privateKey) }
    expect(() => { verifyUpdateAsset(payload, asset, [key.publicKey]) }).toThrow(/signature/u)
  })
})
