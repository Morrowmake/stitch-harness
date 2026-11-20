/**
 * Signed update manifest (`latest.json` release asset) shared by the release signer and the in-app updater.
 * Import-free except `node:` builtins and erasable TypeScript only, so release scripts run it under plain Node type stripping.
 */
import { createHash, createPublicKey, sign, verify, type KeyObject } from 'node:crypto'

export const UPDATE_MANIFEST_SCHEMA = 1
/** Release asset name of the manifest. */
export const UPDATE_MANIFEST_NAME = 'latest.json'
/** `process.platform`-`process.arch` pairs that receive one-click updates. */
export const UPDATE_PLATFORM_KEYS = ['darwin-arm64', 'darwin-x64', 'win32-x64'] as const
export type UpdatePlatformKey = typeof UPDATE_PLATFORM_KEYS[number]

/** One updatable release asset; `signature` is base64 ed25519 over the raw file bytes. */
export interface UpdateAsset {
  readonly name: string
  readonly size: number
  /** Lowercase hex SHA-256 of the file. */
  readonly sha256: string
  readonly signature: string
}

/** Everything the manifest signature covers. */
export interface UnsignedUpdateManifest {
  readonly schema: 1
  readonly version: string
  readonly tag: string
  readonly releaseUrl: string
  readonly publishedAt: string
  readonly assets: { readonly [K in UpdatePlatformKey]?: UpdateAsset }
}

export interface UpdateManifest extends UnsignedUpdateManifest {
  /** Base64 ed25519 over `canonicalManifestJson` of the manifest without this field. */
  readonly manifestSignature: string
}

/**
 * Deterministic JSON: object keys sorted by UTF-16 code units, no whitespace, arrays in order.
 * @param value - JSON data; `undefined`, functions, and non-finite numbers are rejected.
 */
export function canonicalJson(value: unknown): string {
  if (value === null || typeof value === 'string' || typeof value === 'boolean') return JSON.stringify(value)
  if (typeof value === 'number') {
    if (!Number.isFinite(value)) throw new Error('update manifest: non-finite number')
    return JSON.stringify(value)
  }
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(',')}]`
  if (typeof value === 'object') {
    const entries = Object.entries(value).sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
    return `{${entries.map(([key, item]) => `${JSON.stringify(key)}:${canonicalJson(item)}`).join(',')}}`
  }
  throw new Error(`update manifest: ${typeof value} is not JSON`)
}

/**
 * @param manifest - Manifest object; a `manifestSignature` field, if present, is excluded.
 * @returns The exact text covered by `manifestSignature`.
 */
export function canonicalManifestJson(manifest: object): string {
  const { manifestSignature: _signature, ...rest } = manifest as { manifestSignature?: unknown }
  return canonicalJson(rest)
}

/** DER prefix turning a raw 32-byte ed25519 key into SubjectPublicKeyInfo. */
const ED25519_SPKI_PREFIX = Buffer.from('302a300506032b6570032100', 'hex')

/**
 * @param raw - Base64 raw 32-byte ed25519 public key.
 * @returns Node key object.
 */
export function updatePublicKey(raw: string): KeyObject {
  const bytes = Buffer.from(raw, 'base64')
  if (bytes.length !== 32) throw new Error('update manifest: public key must be 32 raw bytes')
  return createPublicKey({ key: Buffer.concat([ED25519_SPKI_PREFIX, bytes]), format: 'der', type: 'spki' })
}

/**
 * @param data - Signed bytes.
 * @param signature - Base64 detached ed25519 signature.
 * @param keys - Trusted raw base64 public keys.
 * @returns Whether any trusted key verifies the signature.
 */
export function verifyUpdateSignature(data: Uint8Array, signature: string, keys: readonly string[]): boolean {
  const bytes = Buffer.from(signature, 'base64')
  if (bytes.length !== 64) return false
  return keys.some(key => verify(null, data, updatePublicKey(key), bytes))
}

/**
 * Release-side signer.
 * @param data - Bytes to sign (file contents or canonical manifest text as UTF-8).
 * @param privateKeyPem - PKCS#8 PEM ed25519 private key.
 * @returns Base64 detached signature.
 */
export function signUpdatePayload(data: Uint8Array, privateKeyPem: string): string {
  return sign(null, data, privateKeyPem).toString('base64')
}

/**
 * Release-side helper adding `manifestSignature`.
 * @param manifest - Complete unsigned manifest.
 * @param privateKeyPem - PKCS#8 PEM ed25519 private key.
 */
export function signUpdateManifest(manifest: UnsignedUpdateManifest, privateKeyPem: string): UpdateManifest {
  const manifestSignature = signUpdatePayload(Buffer.from(canonicalManifestJson(manifest), 'utf8'), privateKeyPem)
  return { ...manifest, manifestSignature }
}

/** @returns Lowercase hex SHA-256. */
export function sha256Hex(data: Uint8Array): string {
  return createHash('sha256').update(data).digest('hex')
}

/** @returns The JSON object fields of `value`. @throws When `value` is not a plain JSON object. */
function objectFields(value: unknown, what: string): Readonly<Record<string, unknown>> {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) throw new Error(`update manifest: ${what} is not an object`)
  return value as Readonly<Record<string, unknown>>
}
const SEMVER = /^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?(?:\+[0-9A-Za-z.-]+)?$/u
const ASSET_NAME = /^[A-Za-z0-9][A-Za-z0-9._-]*$/u

function parseAsset(value: unknown, key: string): UpdateAsset {
  const { name, size, sha256, signature } = objectFields(value, `asset ${key}`)
  if (typeof name !== 'string' || !ASSET_NAME.test(name)) throw new Error(`update manifest: asset ${key} has an invalid name`)
  if (typeof size !== 'number' || !Number.isSafeInteger(size) || size <= 0) throw new Error(`update manifest: asset ${key} has an invalid size`)
  if (typeof sha256 !== 'string' || !/^[0-9a-f]{64}$/u.test(sha256)) throw new Error(`update manifest: asset ${key} has an invalid sha256`)
  if (typeof signature !== 'string' || signature === '') throw new Error(`update manifest: asset ${key} has no signature`)
  return { name, size, sha256, signature }
}

/**
 * Verify the manifest signature over the untrusted object as received, then validate its shape.
 * @param body - Parsed `latest.json`.
 * @param keys - Trusted raw base64 public keys; an empty list rejects every manifest.
 * @returns The verified manifest; unknown platform keys are dropped after verification.
 * @throws When unsigned, signed by an untrusted key, tampered, or malformed.
 */
export function verifyUpdateManifest(body: unknown, keys: readonly string[]): UpdateManifest {
  const fields = objectFields(body, 'manifest')
  const { manifestSignature } = fields
  if (typeof manifestSignature !== 'string') throw new Error('update manifest: missing manifestSignature')
  if (keys.length === 0) throw new Error('update manifest: no trusted update keys are embedded')
  if (!verifyUpdateSignature(Buffer.from(canonicalManifestJson(fields), 'utf8'), manifestSignature, keys)) {
    throw new Error('update manifest: signature does not verify with any trusted key')
  }
  const { schema, version, tag, releaseUrl, publishedAt } = fields
  const assets = objectFields(fields.assets, 'assets')
  if (schema !== UPDATE_MANIFEST_SCHEMA) throw new Error('update manifest: unsupported schema')
  if (typeof version !== 'string' || !SEMVER.test(version)) throw new Error('update manifest: invalid version')
  if (typeof tag !== 'string' || typeof releaseUrl !== 'string' || typeof publishedAt !== 'string') {
    throw new Error('update manifest: missing tag, releaseUrl, or publishedAt')
  }
  const parsed: { [K in UpdatePlatformKey]?: UpdateAsset } = {}
  for (const key of UPDATE_PLATFORM_KEYS) {
    if (assets[key] !== undefined) parsed[key] = parseAsset(assets[key], key)
  }
  return { schema: UPDATE_MANIFEST_SCHEMA, version, tag, releaseUrl, publishedAt, assets: parsed, manifestSignature }
}

/**
 * @param platform - `process.platform`.
 * @param arch - `process.arch`.
 * @returns The manifest key for this build, or undefined when one-click updates are not offered.
 */
export function updatePlatformKey(platform: string, arch: string): UpdatePlatformKey | undefined {
  const key = `${platform}-${arch}`
  return (UPDATE_PLATFORM_KEYS as readonly string[]).includes(key) ? key as UpdatePlatformKey : undefined
}

/**
 * @param manifest - Verified manifest.
 * @param platform - `process.platform`.
 * @param arch - `process.arch`.
 * @returns This build's asset, or undefined.
 */
export function selectUpdateAsset(manifest: UnsignedUpdateManifest, platform: string, arch: string): UpdateAsset | undefined {
  const key = updatePlatformKey(platform, arch)
  return key === undefined ? undefined : manifest.assets[key]
}

/**
 * Check a downloaded asset against its manifest entry.
 * @param data - Downloaded bytes.
 * @param asset - Verified manifest entry.
 * @param keys - Trusted raw base64 public keys.
 * @throws On size, digest, or signature mismatch.
 */
export function verifyUpdateAsset(data: Uint8Array, asset: UpdateAsset, keys: readonly string[]): void {
  if (data.byteLength !== asset.size) throw new Error(`update asset: expected ${String(asset.size)} bytes, got ${String(data.byteLength)}`)
  if (sha256Hex(data) !== asset.sha256) throw new Error('update asset: sha256 mismatch')
  if (!verifyUpdateSignature(data, asset.signature, keys)) throw new Error('update asset: signature does not verify with any trusted key')
}
