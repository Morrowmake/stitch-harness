import { generateKeyPairSync } from 'node:crypto'

/** Fresh ed25519 key pair in the release formats: raw base64 public key and PKCS#8 PEM private key. */
export function releaseKey(): { publicKey: string; privateKey: string } {
  const pair = generateKeyPairSync('ed25519')
  return {
    publicKey: pair.publicKey.export({ format: 'der', type: 'spki' }).subarray(-32).toString('base64'),
    privateKey: pair.privateKey.export({ format: 'pem', type: 'pkcs8' }).toString(),
  }
}
