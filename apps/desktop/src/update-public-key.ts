/**
 * Ed25519 public keys trusted to sign Stitch update manifests and assets (raw 32-byte keys, base64).
 *
 * The matching PKCS#8 PEM private key is the GitHub Actions secret `STITCH_RELEASE_SIGNING_KEY`; new key pairs come
 * from `apps/desktop/scripts/generate-update-signing-key.ts <path outside the repo>`. When this list is empty the app
 * can still find releases, but 'Update now' is unavailable and the update dialog only offers 'Download' (the release
 * page): nothing is ever installed without a verified signature. To rotate, add the new key and keep the previous one
 * listed for at least one release.
 */
export const UPDATE_PUBLIC_KEYS: readonly string[] = ['ppFbqPy6O7dU+JdNwEALjUPNJPOraRDvVxv4mJxcJjE=']
