/**
 * How configuration surfaces present the installed catalog providers: the
 * order they list them in (most-used first) and the names people recognise
 * for a provider's API and for the plan its sign-in uses.
 */

import type { Provider } from '@earendil-works/pi-ai'

/**
 * Route ids by popularity; unlisted routes follow alphabetically by name. A
 * vendor's plan and its API share one position, so both sections a picker
 * derives from the order agree.
 */
const POPULARITY: readonly string[] = [
  'openai', 'anthropic',
  'google-gemini-cli', 'google-antigravity', 'google', 'google-vertex',
  'github-copilot', 'xai', 'openrouter', 'deepseek', 'mistral', 'groq', 'meta',
  'azure', 'amazon-bedrock', 'moonshotai', 'kimi-coding', 'zai', 'together', 'fireworks', 'cerebras',
  'huggingface', 'nvidia', 'vercel-ai-gateway', 'cloudflare-ai-gateway', 'cloudflare-workers-ai',
]

/**
 * Routes pi-ai keeps only for existing setups, superseded by another route:
 * `openai-codex` ("OpenAI Codex (legacy)") by `openai`, which now takes the
 * same ChatGPT sign-in. They still serve when a profile names them.
 */
const LEGACY: Readonly<Record<string, true>> = { 'openai-codex': true }

/**
 * Whether configuration surfaces offer a catalog route for a new setup.
 * @param provider - the installed catalog provider.
 * @returns false for a legacy route.
 */
export function offeredForNewSetups(provider: Provider): boolean {
  return LEGACY[provider.id] !== true
}

/** API names where pi-ai's provider name does not say what people call it. */
const API_NAMES: Readonly<Record<string, string>> = {
  anthropic: 'Anthropic (Claude)',
  google: 'Google Gemini',
  xai: 'xAI (Grok)',
  'openai-codex': 'OpenAI Codex (legacy)',
}

/** Plan names where pi-ai's sign-in name does not say what people call it. */
const PLAN_NAMES: Readonly<Record<string, string>> = {
  openai: 'ChatGPT Plus/Pro (OpenAI)',
  'openai-codex': 'ChatGPT Plus/Pro, Codex (legacy)',
  anthropic: 'Claude Pro/Max (Anthropic)',
  'google-gemini-cli': 'Gemini Code Assist (Google)',
  'google-antigravity': 'Antigravity (Google)',
  'github-copilot': 'GitHub Copilot',
  xai: 'SuperGrok / X Premium (xAI)',
  'kimi-coding': 'Kimi Code (Moonshot AI)',
  meta: 'Meta AI (Muse)',
  openrouter: 'OpenRouter',
}

/**
 * The name a configuration surface shows for a catalog route's API.
 * @param provider - the installed catalog provider.
 * @returns the recognisable name.
 */
export function apiNameOf(provider: Provider): string {
  return API_NAMES[provider.id] ?? provider.name
}

/**
 * The name of the plan a catalog route's sign-in uses.
 * @param provider - the installed catalog provider.
 * @returns the plan name, or `undefined` when the route has no sign-in.
 */
export function planNameOf(provider: Provider): string | undefined {
  const oauth = provider.auth.oauth
  return oauth === undefined ? undefined : PLAN_NAMES[provider.id] ?? oauth.name
}

/**
 * Order catalog providers for configuration surfaces: by popularity, then by name.
 * @param providers - the installed catalog providers.
 * @returns a new array in presentation order.
 */
export function presentationOrder(providers: readonly Provider[]): Provider[] {
  const rank = (provider: Provider): number => {
    const index = POPULARITY.indexOf(provider.id)
    return index === -1 ? POPULARITY.length : index
  }
  return [...providers].sort((a, b) => rank(a) - rank(b) || apiNameOf(a).localeCompare(apiNameOf(b), 'en'))
}
