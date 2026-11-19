/** Process-wide outbound connection defaults a Host sets before any network work. */

import net from 'node:net'

/**
 * Per-address connection attempt budget, in milliseconds, for Node's
 * Happy-Eyeballs (`autoSelectFamily`) dialing. Node's 250 ms default abandons
 * an IPv4 address that answers more slowly than that once an unreachable IPv6
 * address has been tried, so outbound HTTPS fails with `ETIMEDOUT` where curl
 * succeeds.
 */
export const CONNECTION_ATTEMPT_TIMEOUT_MS = 1500

/**
 * Raise Node's default per-address connection attempt timeout to
 * {@link CONNECTION_ATTEMPT_TIMEOUT_MS}, never lowering a larger value set by
 * the environment or an embedder. Call once, early in Host startup.
 * @returns the timeout now in effect.
 */
export function raiseConnectionAttemptTimeout(): number {
  const timeout = Math.max(net.getDefaultAutoSelectFamilyAttemptTimeout(), CONNECTION_ATTEMPT_TIMEOUT_MS)
  net.setDefaultAutoSelectFamilyAttemptTimeout(timeout)
  return timeout
}
