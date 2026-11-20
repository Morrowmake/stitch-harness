/**
 * The provider picker's pure decisions: which cloud section lists a hosted provider and under which name (the Host's
 * most-used-first order kept), and the route id a custom endpoint takes from its host name.
 */
import { describe, expect, it } from 'vitest'
import type { HostedProvider } from '../src/client/operations.ts'
import { routeIdFor } from '../src/client/ProviderStep.tsx'
import { hostedSections } from '../src/client/provider-order.ts'

const hosted: HostedProvider[] = [
  { provider: 'openai', displayName: 'OpenAI', planName: 'ChatGPT Plus/Pro (OpenAI)', simpleKey: true },
  { provider: 'openai-codex', displayName: 'OpenAI Codex (legacy)', planName: 'ChatGPT Plus/Pro, Codex (legacy)', simpleKey: false },
  { provider: 'anthropic', displayName: 'Anthropic (Claude)', planName: 'Claude Pro/Max (Anthropic)', simpleKey: true },
  { provider: 'google', displayName: 'Google Gemini', simpleKey: true },
  { provider: 'github-copilot', displayName: 'GitHub Copilot', planName: 'GitHub Copilot', simpleKey: false },
  { provider: 'xai', displayName: 'xAI (Grok)', planName: 'SuperGrok / X Premium (xAI)', simpleKey: true },
  { provider: 'amazon-bedrock', displayName: 'Amazon Bedrock', simpleKey: false },
]

describe('hosted sections', () => {
  it('list sign-in plans under Subscriptions and key-paid APIs under API access, keeping the Host order', () => {
    const { subscriptions, apiAccess } = hostedSections(hosted)
    expect(subscriptions.map(entry => [entry.provider.provider, entry.name])).toEqual([
      ['openai', 'ChatGPT Plus/Pro (OpenAI)'],
      ['openai-codex', 'ChatGPT Plus/Pro, Codex (legacy)'],
      ['anthropic', 'Claude Pro/Max (Anthropic)'],
      ['github-copilot', 'GitHub Copilot'],
      ['xai', 'SuperGrok / X Premium (xAI)'],
    ])
    expect(apiAccess.map(entry => [entry.provider.provider, entry.name])).toEqual([
      ['openai', 'OpenAI'],
      ['anthropic', 'Anthropic (Claude)'],
      ['google', 'Google Gemini'],
      ['xai', 'xAI (Grok)'],
      // No sign-in and no single key: still listed, its key goes through pi-ai's prompts.
      ['amazon-bedrock', 'Amazon Bedrock'],
    ])
  })

  it('are empty without providers', () => {
    expect(hostedSections([])).toEqual({ subscriptions: [], apiAccess: [] })
  })
})

describe('custom endpoint route ids', () => {
  it('derive a stable id from the host name, unique when repeated', () => {
    expect(routeIdFor('gpu-box.tail1234.ts.net', new Set())).toBe('gpu-box-tail1234-ts-net')
    expect(routeIdFor('192.168.1.20', new Set())).toBe('host-192-168-1-20')
    expect(routeIdFor('Studio.local', new Set(['studio-local']))).toBe('studio-local-2')
    expect(routeIdFor('studio.local', new Set(['studio-local', 'studio-local-2']))).toBe('studio-local-3')
    expect(routeIdFor('fd7a::1', new Set())).toBe('fd7a-1')
    expect(routeIdFor('…', new Set())).toBe('custom')
  })
})
