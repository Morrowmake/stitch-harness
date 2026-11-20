/** Shipped profile templates, optional bundles, and the component sets the templates and picker select. */

import { describe, expect, it } from 'vitest'
import {
  closeBundleChanges, COMPONENT_BUNDLES, COMPONENT_HOST_BUNDLES, COMPONENT_PRESETS, COMPONENTS, matchComponentPreset,
  OPTIONAL_BUNDLES, PROFILE_TEMPLATES,
} from '../src/index.ts'

const component = (id: string): string => `@deepseek-ai/dsh-component-${id}`

describe('Shipped profile templates', () => {
  it('stack each mode bundle on base, the Web templates adding their component set', () => {
    expect(PROFILE_TEMPLATES).toEqual({
      acp: { bundles: ['@deepseek-ai/dsh-base', '@deepseek-ai/dsh-acp-app'] },
      web: { bundles: [...COMPONENT_HOST_BUNDLES, ...COMPONENT_PRESETS.standard] },
      'web-minimal': { bundles: [...COMPONENT_HOST_BUNDLES, ...COMPONENT_PRESETS.minimal] },
      headless: { bundles: ['@deepseek-ai/dsh-base', '@deepseek-ai/dsh-headless'] },
      sdk: { bundles: ['@deepseek-ai/dsh-base', '@deepseek-ai/dsh-sdk-app'] },
      'sdk-minimal': { bundles: ['@deepseek-ai/dsh-sdk-minimal'] },
    })
  })

  it('ships the native subagent integrations as optional bundles, never as components', () => {
    expect(OPTIONAL_BUNDLES).toEqual(expect.arrayContaining(['@deepseek-ai/dsh-subagent-claude-code', '@deepseek-ai/dsh-subagent-codex']))
    expect(OPTIONAL_BUNDLES.filter(name => COMPONENT_BUNDLES.includes(name))).toEqual([])
  })
})

describe('Component sets', () => {
  it('names one package per component and keeps Minimal inside the always-available core plus its own panels', () => {
    expect(new Set(COMPONENT_BUNDLES).size).toBe(COMPONENTS.length)
    expect(COMPONENT_PRESETS.minimal).toEqual(['files', 'terminal', 'browser', 'jobs', 'workspace-tracking', 'context-helpers', 'presets', 'short-prompt'].map(component))
    expect(COMPONENT_PRESETS.standard).not.toContain(component('short-prompt'))
    expect(COMPONENTS.filter(item => item.requires.length > 0).map(item => [item.id, item.requires]))
      .toEqual([['agent-teams', ['subagents']], ['workflows', ['subagents']]])
  })

  it('classifies a bundle list by its component set, ignoring every other bundle', () => {
    expect(matchComponentPreset([...COMPONENT_HOST_BUNDLES, ...COMPONENT_PRESETS.standard, OPTIONAL_BUNDLES[0]!]))
      .toEqual({ preset: 'standard', enabled: COMPONENT_PRESETS.standard })
    expect(matchComponentPreset([...COMPONENT_PRESETS.minimal].reverse()).preset).toBe('minimal')
    expect(matchComponentPreset(COMPONENT_PRESETS.minimal.slice(1))).toEqual({ preset: 'custom', enabled: COMPONENT_PRESETS.minimal.slice(1) })
  })
})

describe('Prerequisite closure', () => {
  const requires: Record<string, string[]> = { teams: ['agents'], flows: ['agents'], deep: ['flows'] }
  const requiresOf = (name: string): string[] => requires[name] ?? []

  it('enables what a selection needs and disables what needs a deselected bundle', () => {
    expect(closeBundleChanges({ teams: true }, [], requiresOf)).toEqual({ teams: true, agents: true })
    expect(closeBundleChanges({ agents: false }, ['agents', 'teams', 'flows', 'deep', 'other'], requiresOf))
      .toEqual({ agents: false, teams: false, flows: false, deep: false })
    expect(closeBundleChanges({ deep: true }, [], requiresOf)).toEqual({ deep: true, flows: true, agents: true })
  })

  it('lets an explicit prerequisite removal win over an explicit dependent request', () => {
    expect(closeBundleChanges({ agents: false, teams: true }, ['agents'], requiresOf)).toEqual({ agents: false, teams: false })
    expect(closeBundleChanges({ flows: false, deep: true }, [], requiresOf)).toEqual({ flows: false, deep: false })
  })

  it('reports requested names even when they change nothing', () => {
    expect(closeBundleChanges({ agents: true }, ['agents'], requiresOf)).toEqual({ agents: true })
  })
})
