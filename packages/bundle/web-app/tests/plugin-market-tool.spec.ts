/** The plugin-market-tool component opens the Creator preset's plugin_market tool row; without it the row is gone. */

import { fileURLToPath } from 'node:url'
import type { EntryOptions } from '@deepseek-ai/cordis-plugin-loader'
import { loadOverlayPatches } from '@deepseek-ai/dsh-app-boot'
import { gateRows } from '@deepseek-ai/dsh-agent-preset-registry/src/components.ts'
import { describe, expect, it } from 'vitest'

/** A preset's child rows as the registry composes them for the enabled components. */
function presetRows(file: string, id: string, enabled: readonly string[]): EntryOptions[] {
  const [patch] = loadOverlayPatches('test', fileURLToPath(new URL(`../presets/${file}`, import.meta.url)))
  const preset = patch?.insert?.find(row => row.id === id)
  if (preset === undefined) throw new Error(`missing ${id}`)
  return gateRows((preset.config as { plugins: EntryOptions[] }).plugins, new Set(enabled)) as EntryOptions[]
}

describe('plugin-market-tool component', () => {
  it('composes the Creator preset without the plugin_market tool row unless the component is on', () => {
    expect(presetRows('cordis.patch.yml', 'preset-cordis', []).map(row => row.id)).not.toContain('tool-plugin-market')
    const row = presetRows('cordis.patch.yml', 'preset-cordis', ['plugin-market-tool']).find(item => item.id === 'tool-plugin-market')
    expect(row).toMatchObject({ name: '@deepseek-ai/dsh-plugin-market/tools' })
    // The profile guard stays: the tool needs the profile-backed pluginMarket service.
    expect(row?.disabled).toBeDefined()
  })

  it('leaves the Standard and PTC rows switched off with the component on', () => {
    for (const [file, id] of [['standard.patch.yml', 'preset-standard'], ['ptc.patch.yml', 'preset-ptc']] as const) {
      const row = presetRows(file, id, ['plugin-market-tool']).find(item => item.id === 'tool-plugin-market')
      expect(row?.disabled).toBe(true)
    }
  })
})
