/**
 * The plugin indexes Stitch knows by address: its own index, which is the only default source, and the community
 * indexes Discover offers to add. Browser-safe: Discover reads this module through the package's `./indexes` entry.
 * @module @deepseek-ai/dsh-plugin-market/indexes
 */
import { PLUGIN_INDEX_REPOSITORY } from '@deepseek-ai/dsh-product'

/**
 * The Stitch plugin index: a direct JSON address generated from the `Morrowmake/stitch-plugins` repository. Nothing is
 * fetched until Discover or the tool reads it.
 */
export const DEFAULT_PLUGIN_INDEX = `https://raw.githubusercontent.com/${PLUGIN_INDEX_REPOSITORY}/main/index.json`

/** The id of a community index Stitch offers by name. */
export type CommunityPluginIndexId = 'awesome-plugins' | 'plugin-market-cdn'

/** A community index Stitch offers; it is never a default source, and Stitch does not review its plugins. */
export interface CommunityPluginIndex {
  readonly id: CommunityPluginIndexId
  readonly url: string
  /** The harness its plugins are written for; their `engines.dsh` ranges name versions of that harness. */
  readonly harness: 'deepseek-harness'
}

/** The DeepSeek Harness community indexes, in the order Discover offers them. */
export const COMMUNITY_PLUGIN_INDEXES: readonly CommunityPluginIndex[] = [
  { id: 'awesome-plugins', url: 'https://awesome-dsh-plugin.com/index.json', harness: 'deepseek-harness' },
  { id: 'plugin-market-cdn', url: 'https://cdn.dsh.so/market/index.json', harness: 'deepseek-harness' },
]

/**
 * Whether an index source is the Stitch plugin index; every other source is a community index that Stitch does not
 * review.
 * @param url - a configured index source URL.
 * @returns true only for {@link DEFAULT_PLUGIN_INDEX}.
 */
export function isStitchPluginIndex(url: string): boolean {
  return url === DEFAULT_PLUGIN_INDEX
}

/**
 * Find the community index Stitch knows at an address.
 * @param url - a configured index source URL.
 * @returns the known community index, or undefined for the Stitch index and any address the user added.
 */
export function knownCommunityIndex(url: string): CommunityPluginIndex | undefined {
  return COMMUNITY_PLUGIN_INDEXES.find(index => index.url === url)
}
