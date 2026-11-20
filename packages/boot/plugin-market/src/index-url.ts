/** Index source URL validation shared by `setIndexes` and the per-use check of configured sources. */
import { parseGitMarketIndexSource } from '@deepseek-ai/dsh-plugin-market-index/source'
import { RemoteError } from '@deepseek-ai/dsh-typert-protocol'
import { PLUGIN_INDEX_REPOSITORY } from '@deepseek-ai/dsh-product'

/**
 * The Stitch plugin index, the `indexes` default: a direct JSON address generated from the
 * `Morrowmake/stitch-plugins` repository. Nothing is fetched until Discover or the tool reads it.
 */
export const DEFAULT_PLUGIN_INDEX = `https://raw.githubusercontent.com/${PLUGIN_INDEX_REPOSITORY}/main/index.json`

/**
 * DeepSeek Harness (DSH) plugin indexes, whose plugins Stitch runs; listed after
 * {@link DEFAULT_PLUGIN_INDEX} and, like it, fetched only when read.
 */
export const DEEPSEEK_HARNESS_PLUGIN_INDEXES = [
  'https://awesome-dsh-plugin.com/index.json',
  'https://cdn.dsh.so/market/index.json',
] as const

/** The `indexes` default, in display order: the Stitch index, then the DeepSeek Harness indexes. */
export const DEFAULT_PLUGIN_INDEXES: readonly string[] = [DEFAULT_PLUGIN_INDEX, ...DEEPSEEK_HARNESS_PLUGIN_INDEXES]

/**
 * Validate and normalize one index source URL.
 * @param text - URL as configured or entered.
 * @returns the URL's serialization.
 * @throws {RemoteError} `plugin-market/invalid-index-url` for an invalid HTTP(S) or Git index address.
 */
export function normalizeIndexUrl(text: string): string {
  if (text.trimStart().startsWith('git+')) {
    try {
      return parseGitMarketIndexSource(text.trim()).url
    } catch (error) {
      const message = error instanceof Error && !(error instanceof TypeError) ? error.message : 'Use a valid Git repository address'
      throw new RemoteError('plugin-market/invalid-index-url', message, { url: '', reason: 'git-source' })
    }
  }
  let url: URL
  try {
    url = new URL(text.trim())
  } catch {
    // Unparseable text: report the rule instead of the parser message.
    throw new RemoteError('plugin-market/invalid-index-url', `Not an absolute URL: ${text}`, { url: text, reason: 'not-absolute' })
  }
  if (url.protocol !== 'https:' && url.protocol !== 'http:') {
    throw new RemoteError('plugin-market/invalid-index-url', `Index URLs use http or https: ${text}`, { url: text, reason: 'scheme' })
  }
  if (url.username !== '' || url.password !== '' || url.href.includes('#')) {
    throw new RemoteError('plugin-market/invalid-index-url', `Index URLs carry no credentials or fragment: ${text}`, { url: text, reason: 'credentials-or-fragment' })
  }
  return url.href
}
