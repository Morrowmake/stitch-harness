/**
 * Claude subscription usage (`anthropic` OAuth accounts) from the OAuth usage
 * endpoint — the source of Claude Code's `/usage` screen.
 *
 * Portions derived from dsh-plugin-subscriptions
 * (https://github.com/V1ki/dsh-plugin-subscriptions), Copyright (c) 2026 V1ki,
 * MIT License.
 *
 * @module dsh-llm-pi-ai/accounts/usage/claude
 */

import { attributionHeaders } from '@deepseek-ai/dsh-llm'
import type { UsageWindowView } from '../types.ts'
import { parseInstant, usageEndpointError } from './http.ts'
import type { FetchedUsage, FetchFn, UsageAuth } from './http.ts'

/** Anthropic's OAuth usage endpoint for a Claude subscription account. */
export const CLAUDE_USAGE_URL = 'https://api.anthropic.com/api/oauth/usage'

const SESSION_MS = 5 * 3600_000
const WEEKLY_MS = 7 * 24 * 3600_000

function legacyWindow(value: unknown, kind: 'session' | 'weekly', scope?: string): UsageWindowView | undefined {
  if (typeof value !== 'object' || value === null) return undefined
  const bucket = value as { utilization?: unknown; resets_at?: unknown }
  if (typeof bucket.utilization !== 'number' || !Number.isFinite(bucket.utilization)) return undefined
  const resetsAt = parseInstant(bucket.resets_at)
  return {
    kind,
    ...scope === undefined ? {} : { scope },
    usedPercent: bucket.utilization,
    durationMs: kind === 'session' ? SESSION_MS : WEEKLY_MS,
    ...resetsAt === undefined ? {} : { resetsAt },
  }
}

/** One entry of the modern `limits` array (subset). */
interface LimitEntry {
  kind?: unknown
  percent?: unknown
  resets_at?: unknown
  scope?: { model?: { display_name?: unknown } }
}

function limitsWindows(value: unknown): UsageWindowView[] {
  if (!Array.isArray(value)) return []
  const windows: UsageWindowView[] = []
  for (const raw of value as unknown[]) {
    if (typeof raw !== 'object' || raw === null) continue
    const entry = raw as LimitEntry
    if (typeof entry.percent !== 'number' || !Number.isFinite(entry.percent)) continue
    const kind: UsageWindowView['kind'] = entry.kind === 'session'
      ? 'session'
      : entry.kind === 'weekly_all' || entry.kind === 'weekly_scoped' ? 'weekly' : 'other'
    const scope = entry.scope?.model?.display_name
    const resetsAt = parseInstant(entry.resets_at)
    windows.push({
      kind,
      ...typeof scope === 'string' && scope.length > 0 ? { scope } : {},
      usedPercent: entry.percent,
      ...kind === 'weekly' ? { durationMs: WEEKLY_MS } : {},
      ...resetsAt === undefined ? {} : { resetsAt },
    })
  }
  return windows
}

/**
 * Fetch one Claude account's usage. Newer responses carry a `limits` array,
 * older ones flat `five_hour`/`seven_day*` buckets; the array wins when it
 * has entries.
 * @param auth - the account's current access token.
 * @param fetchFn - fetch implementation.
 * @param signal - caller cancellation.
 * @returns the mapped usage.
 * @throws {UsageFetchError} on a non-2xx answer.
 */
export async function fetchClaudeUsage(auth: UsageAuth, fetchFn: FetchFn, signal?: AbortSignal): Promise<FetchedUsage> {
  const response = await fetchFn(CLAUDE_USAGE_URL, {
    // pi-ai's Anthropic OAuth inference identity (`anthropic-messages.js`:
    // `x-app: cli` and the claude-code/oauth beta features) with the
    // `user-agent` the adapter forces onto every provider request — exactly
    // what this account's inference traffic already presents. No CLI version
    // is looked up anywhere.
    headers: {
      'accept': 'application/json',
      'anthropic-dangerous-direct-browser-access': 'true',
      'x-app': 'cli',
      'anthropic-beta': 'claude-code-20250219,oauth-2025-04-20',
      ...attributionHeaders(),
      'authorization': `Bearer ${auth.token}`,
    },
    ...signal === undefined ? {} : { signal },
  })
  if (!response.ok) throw usageEndpointError(response, 'claude usage')
  const payload = await response.json() as Record<string, unknown>
  const modern = limitsWindows(payload.limits)
  if (modern.length > 0) return { windows: modern }
  const windows = [
    legacyWindow(payload.five_hour, 'session'),
    legacyWindow(payload.seven_day, 'weekly'),
    legacyWindow(payload.seven_day_opus, 'weekly', 'Opus'),
    legacyWindow(payload.seven_day_sonnet, 'weekly', 'Sonnet'),
  ].filter(window => window !== undefined)
  return { windows }
}
