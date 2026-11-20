/**
 * Write the in-app update manifest (`latest.json`) for one release directory, signing every updatable asset and the
 * manifest with the release key from `STITCH_RELEASE_SIGNING_KEY`. Without the key it writes an unsigned manifest,
 * which the application rejects, so dry runs still exercise asset selection.
 *
 * Usage: node apps/desktop/scripts/sign-update-assets.ts --dir <assets> --version <version> --tag <tag> [--repository owner/name]
 */
import { createPrivateKey, createPublicKey } from 'node:crypto'
import { readFileSync, readdirSync, writeFileSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { parseArgs } from 'node:util'
import {
  UPDATE_MANIFEST_NAME,
  UPDATE_MANIFEST_SCHEMA,
  UPDATE_PLATFORM_KEYS,
  sha256Hex,
  signUpdateManifest,
  signUpdatePayload,
  verifyUpdateAsset,
  verifyUpdateManifest,
  type UnsignedUpdateManifest,
  type UpdateAsset,
  type UpdateManifest,
  type UpdatePlatformKey,
} from '../src/update-manifest.ts'
import { rawEd25519PublicKey } from './generate-update-signing-key.ts'

/** Environment variable holding the PKCS#8 PEM ed25519 private key. */
export const UPDATE_SIGNING_KEY_ENV = 'STITCH_RELEASE_SIGNING_KEY'

/** electron-builder file stem and extension of the asset each platform installs from. */
const PLATFORM_ARTIFACTS: Record<UpdatePlatformKey, { readonly stem: string; readonly extension: string }> = {
  'darwin-arm64': { stem: 'mac-arm64', extension: 'zip' },
  'darwin-x64': { stem: 'mac-x64', extension: 'zip' },
  'win32-x64': { stem: 'win-x64', extension: 'exe' },
}

function escapeRegExp(text: string): string {
  return text.replace(/[.*+?^${}()|[\]\\]/gu, '\\$&')
}

/**
 * Find the single updatable asset of every platform in a release directory.
 * @param names - File names in the directory.
 * @param version - Release version the artifact names carry.
 * @returns The file name per platform key.
 * @throws When a platform has no asset or more than one.
 */
export function selectUpdateFiles(names: readonly string[], version: string): Record<UpdatePlatformKey, string> {
  const selected = {} as Record<UpdatePlatformKey, string>
  for (const key of UPDATE_PLATFORM_KEYS) {
    const { stem, extension } = PLATFORM_ARTIFACTS[key]
    const pattern = new RegExp(`^stitch-${escapeRegExp(version)}-${stem}(?:-unsigned)?\\.${extension}$`, 'u')
    const matches = names.filter(name => pattern.test(name))
    if (matches.length !== 1) {
      throw new Error(`update manifest: expected one ${key} asset stitch-${version}-${stem}[-unsigned].${extension}, found ${matches.length === 0 ? 'none' : matches.join(', ')}`)
    }
    selected[key] = matches[0]!
  }
  return selected
}

/** Inputs of one release manifest. */
export interface UpdateManifestRequest {
  readonly directory: string
  readonly version: string
  readonly tag: string
  /** GitHub `owner/name` that hosts the release. */
  readonly repository: string
  readonly publishedAt: string
  /** PKCS#8 PEM ed25519 key; undefined writes an unsigned manifest. */
  readonly privateKeyPem: string | undefined
}

/**
 * Build the manifest for a release directory, signing it when a key is supplied. A signed manifest and its assets are
 * verified against the key's own public half before being returned.
 * @param request - Release identity, asset directory and optional signing key.
 * @returns The manifest; unsigned manifests lack every `signature` and `manifestSignature`.
 */
export function createUpdateManifest(request: UpdateManifestRequest): UpdateManifest | UnsignedManifestDraft {
  const files = selectUpdateFiles(readdirSync(request.directory), request.version)
  const key = request.privateKeyPem
  const assets: Partial<Record<UpdatePlatformKey, UpdateAsset | UnsignedAssetDraft>> = {}
  const contents = new Map<UpdatePlatformKey, Buffer>()
  for (const platform of UPDATE_PLATFORM_KEYS) {
    const name = files[platform]
    const data = readFileSync(join(request.directory, name))
    contents.set(platform, data)
    const digest = { name, size: data.byteLength, sha256: sha256Hex(data) }
    assets[platform] = key === undefined ? digest : { ...digest, signature: signUpdatePayload(data, key) }
  }
  const draft = {
    schema: UPDATE_MANIFEST_SCHEMA,
    version: request.version,
    tag: request.tag,
    releaseUrl: `https://github.com/${request.repository}/releases/tag/${request.tag}`,
    publishedAt: request.publishedAt,
    assets,
  }
  if (key === undefined) return draft as UnsignedManifestDraft
  const manifest = signUpdateManifest(draft as UnsignedUpdateManifest, key)
  const publicKeys = [rawEd25519PublicKey(createPublicKey(createPrivateKey(key)))]
  const verified = verifyUpdateManifest(JSON.parse(JSON.stringify(manifest)), publicKeys)
  for (const platform of UPDATE_PLATFORM_KEYS) verifyUpdateAsset(contents.get(platform)!, verified.assets[platform]!, publicKeys)
  return manifest
}

/** Asset entry written when no signing key is configured. */
export type UnsignedAssetDraft = Omit<UpdateAsset, 'signature'>

/** Manifest written when no signing key is configured; the application rejects it. */
export interface UnsignedManifestDraft extends Omit<UnsignedUpdateManifest, 'assets'> {
  readonly assets: { readonly [K in UpdatePlatformKey]?: UnsignedAssetDraft }
}

function main(): void {
  const { values } = parseArgs({
    options: {
      dir: { type: 'string' },
      version: { type: 'string' },
      tag: { type: 'string' },
      repository: { type: 'string', default: process.env.GITHUB_REPOSITORY ?? 'Morrowmake/stitch-harness' },
    },
    allowPositionals: false,
  })
  if (values.dir === undefined || values.version === undefined || values.tag === undefined) {
    throw new Error('usage: node apps/desktop/scripts/sign-update-assets.ts --dir <assets> --version <version> --tag <tag> [--repository owner/name]')
  }
  const configured = process.env[UPDATE_SIGNING_KEY_ENV]
  const privateKeyPem = configured === undefined || configured.trim() === '' ? undefined : configured
  if (privateKeyPem === undefined) {
    process.stdout.write(`::warning::${UPDATE_SIGNING_KEY_ENV} is not set; ${UPDATE_MANIFEST_NAME} is unsigned and the in-app updater will reject this release\n`)
  } else {
    process.stdout.write(`Signing with update key ${rawEd25519PublicKey(createPublicKey(createPrivateKey(privateKeyPem)))}\n`)
  }
  const directory = resolve(values.dir)
  const manifest = createUpdateManifest({
    directory,
    version: values.version,
    tag: values.tag,
    repository: values.repository,
    publishedAt: new Date().toISOString().replace(/\.\d{3}Z$/u, 'Z'),
    privateKeyPem,
  })
  const path = join(directory, UPDATE_MANIFEST_NAME)
  writeFileSync(path, `${JSON.stringify(manifest, null, 2)}\n`)
  process.stdout.write(`Wrote ${path}\n`)
}

if (process.argv[1] !== undefined && import.meta.filename === resolve(process.argv[1])) main()
