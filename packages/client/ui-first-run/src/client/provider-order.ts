/**
 * How the provider picker splits the hosted providers into its two cloud
 * sections. The Host already lists them most-used first under recognisable
 * names; this only decides which section shows which.
 */
import type { HostedProvider } from './operations.ts'

/** One hosted provider as one picker section lists it. */
export interface HostedEntry {
  readonly provider: HostedProvider
  /** The name this section shows. */
  readonly name: string
}

/** The two cloud sections of the picker. */
export interface HostedSections {
  /** Providers that take a browser sign-in with an existing plan, under the plan's name. */
  readonly subscriptions: readonly HostedEntry[]
  /** Providers that take an API key (pasted or through pi-ai's prompts), under the API's name. */
  readonly apiAccess: readonly HostedEntry[]
}

/**
 * Split hosted providers into the picker's two sections, keeping the Host's
 * order. A provider with both a sign-in and a key (Anthropic) appears in both;
 * one with only a sign-in (the legacy Codex route) only under subscriptions.
 * @param providers - the hosted providers in the Host's order.
 * @returns both sections.
 */
export function hostedSections(providers: readonly HostedProvider[]): HostedSections {
  const subscriptions: HostedEntry[] = []
  const apiAccess: HostedEntry[] = []
  for (const provider of providers) {
    if (provider.planName !== undefined) subscriptions.push({ provider, name: provider.planName })
    if (provider.simpleKey || provider.planName === undefined) apiAccess.push({ provider, name: provider.displayName })
  }
  return { subscriptions, apiAccess }
}
