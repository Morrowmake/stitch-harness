/** Shipped profile templates, optional bundles, and the component sets the templates and picker select. */

import { describe, expect, it } from 'vitest'
import {
  BUNDLE_SECTIONS, closeBundleChanges, COMPONENT_BUNDLES, COMPONENT_HOST_BUNDLES, COMPONENT_PRESETS, COMPONENTS, EXPERIMENTAL_BUNDLES,
  HIDDEN_BUNDLES, matchComponentPreset, OPTIONAL_BUNDLES, PLUGIN_SECTIONS, PROFILE_TEMPLATES, RETIRED_BUNDLES,
} from '../src/index.ts'

const component = (id: string): string => `@deepseek-ai/dsh-component-${id}`

describe('Shipped profile templates', () => {
  it('stack each mode bundle on base, the Web templates adding their component set', () => {
    expect(PROFILE_TEMPLATES).toEqual({
      acp: { bundles: ['@deepseek-ai/dsh-base', '@deepseek-ai/dsh-acp-app'] },
      web: { bundles: [...COMPONENT_HOST_BUNDLES, ...COMPONENT_PRESETS.standard] },
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

describe('Plugin list presentation', () => {
  it('files every listed official plugin under a purpose, and plumbing under advanced', () => {
    const listed = [...COMPONENT_BUNDLES, ...OPTIONAL_BUNDLES].filter(name => !HIDDEN_BUNDLES.has(name))
    expect(listed.filter(name => BUNDLE_SECTIONS[name] === undefined)).toEqual([])
    expect(Object.values(BUNDLE_SECTIONS).every(section => PLUGIN_SECTIONS.includes(section))).toBe(true)
    expect(Object.keys(BUNDLE_SECTIONS).filter(name => BUNDLE_SECTIONS[name] === 'advanced').map(name => name.replace(component(''), '')))
      .toEqual(['search-tools', 'jobs', 'workspace-tracking', 'context-helpers', 'presets', 'short-prompt', 'plugin-market-tool'])
  })

  it('marks no component experimental, and retires the plugin market bundle the Web composition replaced', () => {
    expect(COMPONENT_BUNDLES.filter(name => EXPERIMENTAL_BUNDLES.has(name))).toEqual([])
    expect(RETIRED_BUNDLES).toContain('@deepseek-ai/dsh-experimental-plugin-market-bundle')
    expect(OPTIONAL_BUNDLES).not.toContain('@deepseek-ai/dsh-experimental-plugin-market-bundle')
    expect(EXPERIMENTAL_BUNDLES).not.toContain('@deepseek-ai/dsh-experimental-plugin-market-bundle')
  })
})

describe('Component sets', () => {
  it('names one package per component and leaves the short prompt out of Standard', () => {
    expect(new Set(COMPONENT_BUNDLES).size).toBe(COMPONENTS.length)
    expect(COMPONENT_PRESETS.standard).not.toContain(component('short-prompt'))
    expect(COMPONENTS.filter(item => item.requires.length > 0).map(item => [item.id, item.requires]))
      .toEqual([['agent-teams', ['subagents']], ['workflows', ['subagents']]])
  })

  it('classifies a bundle list by its component set, ignoring every other bundle', () => {
    expect(matchComponentPreset([...COMPONENT_HOST_BUNDLES, ...COMPONENT_PRESETS.standard, OPTIONAL_BUNDLES[0]!]))
      .toEqual({ preset: 'standard', enabled: COMPONENT_PRESETS.standard })
    expect(matchComponentPreset([...COMPONENT_PRESETS.standard].reverse()).preset).toBe('standard')
    expect(matchComponentPreset(COMPONENT_PRESETS.standard.slice(1))).toEqual({ preset: 'custom', enabled: COMPONENT_PRESETS.standard.slice(1) })
    expect(matchComponentPreset(COMPONENT_HOST_BUNDLES)).toEqual({ preset: 'custom', enabled: [] })
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
