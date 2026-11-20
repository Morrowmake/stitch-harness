/** Release-side update signing produces manifests the in-app updater accepts, and nothing it should accept. */
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, expect, it } from 'vitest'
import { generateUpdateSigningKey, updateSigningKeyDestination } from '../scripts/generate-update-signing-key.ts'
import { createUpdateManifest, selectUpdateFiles } from '../scripts/sign-update-assets.ts'
import { verifyUpdateAsset, verifyUpdateManifest, type UpdateManifest } from '../src/update-manifest.ts'

const VERSION = '0.2.2-rc.5'
const ASSETS = {
  'darwin-arm64': `stitch-${VERSION}-mac-arm64-unsigned.zip`,
  'darwin-x64': `stitch-${VERSION}-mac-x64-unsigned.zip`,
  'win32-x64': `stitch-${VERSION}-win-x64-unsigned.exe`,
} as const
const roots: string[] = []
afterEach(() => { for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true }) })

function release(): string {
  const directory = mkdtempSync(join(tmpdir(), 'update-assets-'))
  roots.push(directory)
  for (const [index, name] of Object.values(ASSETS).entries()) writeFileSync(join(directory, name), Buffer.from(`payload ${index}`))
  writeFileSync(join(directory, `stitch-${VERSION}-mac-arm64-unsigned.dmg`), 'disk image')
  writeFileSync(join(directory, `stitch-${VERSION}-win-x64-unsigned.exe.blockmap`), 'blockmap')
  return directory
}

function manifest(directory: string, privateKeyPem: string | undefined) {
  return createUpdateManifest({
    directory, version: VERSION, tag: `stitch-v${VERSION}`, repository: 'Morrowmake/stitch-harness',
    publishedAt: '2026-11-21T00:00:00Z', privateKeyPem,
  })
}

it('signs every updatable asset and the manifest so the updater verifies them with the public key', () => {
  const { privateKeyPem, publicKey } = generateUpdateSigningKey()
  expect(Buffer.from(publicKey, 'base64')).toHaveLength(32)
  const directory = release()
  const signed = manifest(directory, privateKeyPem) as UpdateManifest
  expect(Object.keys(signed).sort()).toEqual(['assets', 'manifestSignature', 'publishedAt', 'releaseUrl', 'schema', 'tag', 'version'])
  expect(signed).toMatchObject({
    schema: 1, version: VERSION, tag: `stitch-v${VERSION}`, publishedAt: '2026-11-21T00:00:00Z',
    releaseUrl: `https://github.com/Morrowmake/stitch-harness/releases/tag/stitch-v${VERSION}`,
  })
  const verified = verifyUpdateManifest(JSON.parse(JSON.stringify(signed)), [publicKey])
  for (const [index, [platform, name]] of (Object.entries(ASSETS) as [keyof typeof ASSETS, string][]).entries()) {
    const payload = Buffer.from(`payload ${index}`)
    const asset = verified.assets[platform]!
    expect(asset).toMatchObject({ name, size: payload.byteLength })
    expect(() =>{  verifyUpdateAsset(payload, asset, [publicKey]) }).not.toThrow()
  }
})

it('produces manifests and assets that a tamperer or another key cannot pass off', () => {
  const { privateKeyPem, publicKey } = generateUpdateSigningKey()
  const other = generateUpdateSigningKey()
  const signed = manifest(release(), privateKeyPem) as UpdateManifest
  expect(() => verifyUpdateManifest({ ...signed, version: '9.9.9' }, [publicKey])).toThrow(/signature/u)
  const swapped = { ...signed, assets: { ...signed.assets, 'darwin-arm64': { ...signed.assets['darwin-arm64']!, sha256: '0'.repeat(64) } } }
  expect(() => verifyUpdateManifest(swapped, [publicKey])).toThrow(/signature/u)
  expect(() => verifyUpdateManifest(signed, [other.publicKey])).toThrow(/signature/u)
  expect(() =>{  verifyUpdateAsset(Buffer.from('payload 9'), signed.assets['darwin-arm64']!, [publicKey]) }).toThrow()
})

it('writes an unsigned manifest without a key, which the updater rejects', () => {
  const draft = manifest(release(), undefined)
  expect(draft).not.toHaveProperty('manifestSignature')
  for (const asset of Object.values(draft.assets)) expect(asset).not.toHaveProperty('signature')
  expect(() => verifyUpdateManifest(draft, [generateUpdateSigningKey().publicKey])).toThrow(/manifestSignature/u)
})

it('selects exactly one asset per platform, ignoring installers that are not update payloads', () => {
  expect(selectUpdateFiles([...Object.values(ASSETS), `stitch-${VERSION}-mac-x64-unsigned.dmg`, 'latest.json'], VERSION)).toEqual(ASSETS)
  expect(selectUpdateFiles([`stitch-${VERSION}-mac-arm64.zip`, `stitch-${VERSION}-mac-x64.zip`, `stitch-${VERSION}-win-x64.exe`], VERSION))
    .toMatchObject({ 'win32-x64': `stitch-${VERSION}-win-x64.exe` })
  expect(() => selectUpdateFiles([ASSETS['darwin-arm64'], ASSETS['win32-x64']], VERSION)).toThrow(/darwin-x64.*found none/u)
  expect(() => selectUpdateFiles([...Object.values(ASSETS), `stitch-${VERSION}-win-x64.exe`], VERSION)).toThrow(/win32-x64.*found/u)
  expect(() => selectUpdateFiles(Object.values(ASSETS), '0.2.2-rc.6')).toThrow(/found none/u)
})

it('refuses to place the private key inside the repository', () => {
  const root = mkdtempSync(join(tmpdir(), 'update-key-repo-'))
  roots.push(root)
  mkdirSync(join(root, 'apps'))
  expect(() => updateSigningKeyDestination(join(root, 'key.pem'), root)).toThrow(/outside the repository/u)
  expect(() => updateSigningKeyDestination(join(root, 'apps', 'key.pem'), root)).toThrow(/outside the repository/u)
  const outside = mkdtempSync(join(tmpdir(), 'update-key-home-'))
  roots.push(outside)
  expect(updateSigningKeyDestination(join(outside, 'key.pem'), root)).toBe(join(outside, 'key.pem'))
})
