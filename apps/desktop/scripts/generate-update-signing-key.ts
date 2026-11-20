/**
 * Create the ed25519 key pair that signs in-app update assets. The private key (PKCS#8 PEM) goes to a new file outside
 * the repository, for the `STITCH_RELEASE_SIGNING_KEY` Actions secret; the raw public key (base64) is what the
 * application embeds in `src/update-public-key.ts`.
 *
 * Usage: node apps/desktop/scripts/generate-update-signing-key.ts <private-key-path>
 */
import { generateKeyPairSync, type KeyObject } from 'node:crypto'
import { existsSync, realpathSync, writeFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { dirname, isAbsolute, relative, resolve } from 'node:path'

const REPOSITORY_ROOT = resolve(import.meta.dirname, '../../..')

/**
 * Encode an ed25519 public key in the embedded format.
 * @param key - Ed25519 public or private key object.
 * @returns Base64 of the raw 32-byte public key.
 */
export function rawEd25519PublicKey(key: KeyObject): string {
  if (key.asymmetricKeyType !== 'ed25519') throw new Error('update signing: the key is not an ed25519 key')
  const { x } = key.export({ format: 'jwk' })
  if (typeof x !== 'string') throw new Error('update signing: the key has no public component')
  return Buffer.from(x, 'base64url').toString('base64')
}

/**
 * Reject a destination inside the repository, where the key could be committed or packed.
 * @param path - Requested private key path.
 * @param root - Repository root.
 * @returns The absolute destination.
 */
export function updateSigningKeyDestination(path: string, root: string = REPOSITORY_ROOT): string {
  const destination = resolve(path.startsWith('~/') ? `${homedir()}${path.slice(1)}` : path)
  if (!existsSync(dirname(destination))) throw new Error(`update signing: directory ${dirname(destination)} does not exist`)
  const parent = realpathSync(dirname(destination))
  const inside = relative(realpathSync(root), parent)
  if (inside === '' || (!inside.startsWith('..') && !isAbsolute(inside))) {
    throw new Error('update signing: write the private key outside the repository, for example ~/.stitch-update-signing-key.pem')
  }
  return destination
}

/**
 * Generate one signing key pair.
 * @returns PKCS#8 PEM private key and base64 raw public key.
 */
export function generateUpdateSigningKey(): { privateKeyPem: string; publicKey: string } {
  const { privateKey, publicKey } = generateKeyPairSync('ed25519')
  return {
    privateKeyPem: privateKey.export({ format: 'pem', type: 'pkcs8' }).toString(),
    publicKey: rawEd25519PublicKey(publicKey),
  }
}

function main(): void {
  const [path, ...rest] = process.argv.slice(2)
  if (path === undefined || rest.length > 0) {
    throw new Error('usage: node apps/desktop/scripts/generate-update-signing-key.ts <private-key-path outside the repository>')
  }
  const destination = updateSigningKeyDestination(path)
  const { privateKeyPem, publicKey } = generateUpdateSigningKey()
  // `wx` refuses to replace an existing key; 0600 keeps it private to this account.
  writeFileSync(destination, privateKeyPem, { flag: 'wx', mode: 0o600 })
  process.stdout.write([
    `Private key written to ${destination} (mode 0600). Keep it out of the repository and back it up.`,
    '',
    `Public key: ${publicKey}`,
    'Add it to UPDATE_PUBLIC_KEYS in apps/desktop/src/update-public-key.ts.',
    '',
    'Store the private key as the release workflow secret:',
    `  gh secret set STITCH_RELEASE_SIGNING_KEY --repo Morrowmake/stitch-harness < ${JSON.stringify(destination)}`,
    '',
  ].join('\n'))
}

if (process.argv[1] !== undefined && import.meta.filename === resolve(process.argv[1])) main()
