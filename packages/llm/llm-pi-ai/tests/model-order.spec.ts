/**
 * Picker order of one provider's catalog: current models first and newest
 * first, with aliases, dated snapshots, and superseded versions flagged for
 * the "Older models" group. The catalogs below mirror pi-ai's Anthropic and
 * OpenAI entries in their A–Z catalog order.
 */

import { describe, expect, it } from 'vitest'
import { orderModels } from '../src/model-order.ts'

const models = (rows: ReadonlyArray<readonly [string, string]>): Array<{ id: string; name: string }> =>
  rows.map(([id, name]) => ({ id, name }))

/** `[current ids, older ids]`, each in picker order. */
function split(rows: ReadonlyArray<readonly [string, string]>): [string[], string[]] {
  const ordered = orderModels(models(rows))
  const ids = (older: boolean): string[] => ordered.filter(entry => entry.older === older).map(entry => entry.model.id)
  return [ids(false), ids(true)]
}

describe('model order', () => {
  it('puts the newest Claude models first and collapses aliases, snapshots, and superseded versions', () => {
    const [current, older] = split([
      ['claude-fable-5', 'Claude Fable 5'],
      ['claude-fable-5-1', 'Claude Fable 5.1'],
      ['claude-haiku-4-5', 'Claude Haiku 4.5 (latest)'],
      ['claude-haiku-4-5-20251001', 'Claude Haiku 4.5'],
      ['claude-haiku-5-5', 'Claude Haiku 5.5'],
      ['claude-opus-4-5', 'Claude Opus 4.5 (latest)'],
      ['claude-opus-4-5-20251101', 'Claude Opus 4.5'],
      ['claude-opus-4-6', 'Claude Opus 4.6'],
      ['claude-opus-4-8', 'Claude Opus 4.8'],
      ['claude-opus-5', 'Claude Opus 5'],
      ['claude-opus-5-5', 'Claude Opus 5.5'],
      ['claude-sonnet-4-5-20250929', 'Claude Sonnet 4.5'],
      ['claude-sonnet-5', 'Claude Sonnet 5'],
      ['claude-sonnet-5-5', 'Claude Sonnet 5.5'],
    ])

    expect(current).toEqual(['claude-opus-5-5', 'claude-sonnet-5-5', 'claude-haiku-5-5', 'claude-fable-5-1'])
    // Equal versions keep the lighter Haiku tier after Opus and Sonnet.
    expect(older).toEqual([
      'claude-fable-5', 'claude-opus-5', 'claude-sonnet-5', 'claude-opus-4-8', 'claude-opus-4-6',
      'claude-opus-4-5', 'claude-opus-4-5-20251101', 'claude-sonnet-4-5-20250929', 'claude-haiku-4-5', 'claude-haiku-4-5-20251001',
    ])
  })

  it('collapses GPT-4 and GPT-4o once GPT-5 and GPT-6 exist, and dated snapshots and -latest aliases always', () => {
    const [current, older] = split([
      ['gpt-4', 'GPT-4'],
      ['gpt-4-turbo', 'GPT-4 Turbo'],
      ['gpt-4.1-mini', 'GPT-4.1 mini'],
      ['gpt-4o', 'GPT-4o'],
      ['gpt-4o-2024-05-13', 'GPT-4o (2024-05-13)'],
      ['gpt-5', 'GPT-5'],
      ['gpt-5-chat-latest', 'GPT-5 Chat Latest'],
      ['gpt-5-mini', 'GPT-5 Mini'],
      ['gpt-5.4-mini', 'GPT-5.4 mini'],
      ['gpt-5.5', 'GPT-5.5'],
      ['gpt-5.5-pro', 'GPT-5.5 Pro'],
      ['gpt-5.6-sol', 'GPT-5.6 Sol'],
      ['gpt-6-sol', 'GPT-6 Sol'],
      ['gpt-6.1-sol', 'GPT-6.1 Sol'],
      ['o3', 'o3'],
      ['o3-mini', 'o3-mini'],
      ['o4-mini', 'o4-mini'],
    ])

    expect(current).toEqual(['gpt-6.1-sol', 'gpt-5.5', 'gpt-5.5-pro', 'gpt-5.4-mini', 'o4-mini', 'o3'])
    for (const id of ['gpt-4', 'gpt-4-turbo', 'gpt-4.1-mini', 'gpt-4o', 'gpt-4o-2024-05-13', 'gpt-5', 'gpt-5-chat-latest', 'gpt-5-mini', 'gpt-5.6-sol', 'gpt-6-sol', 'o3-mini']) {
      expect(older).toContain(id)
    }
    expect(older[0]).toBe('gpt-6-sol')
  })

  it('keeps unversioned models current after the versioned ones, in catalog order', () => {
    const [current, older] = split([
      ['mistral-nemo', 'Mistral Nemo'],
      ['mistral-large-3', 'Mistral Large 3'],
      ['mistral-large-latest', 'Mistral Large (latest)'],
      ['mistral-large-4', 'Mistral Large 4'],
      ['devstral-medium', 'Devstral Medium'],
    ])

    expect(current).toEqual(['mistral-large-4', 'mistral-nemo', 'devstral-medium'])
    expect(older).toEqual(['mistral-large-3', 'mistral-large-latest'])
  })
})
