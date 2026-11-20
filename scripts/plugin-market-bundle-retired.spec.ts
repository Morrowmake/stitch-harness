/** Profiles that selected the retired plugin market bundle load cleanly, and their saved index sources still apply. */

import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { describe, expect, it, onTestFinished } from 'vitest'
import { composeEntries, initProfile, loadProfileDirectory, readProfileManifest } from '../packages/boot/app-boot/src/profile.ts'
import { OPTIONAL_BUNDLES, PROFILE_TEMPLATES, RETIRED_BUNDLES } from '../packages/util/official-bundles/src/bundles.ts'
import { createPluginProfile } from '../apps/desktop/src/project-manager.ts'

const root = resolve(import.meta.dirname, '..')
const INSTALL_ANCHOR = join(root, 'apps', 'cli', 'package.json')
const RETIRED = '@deepseek-ai/dsh-experimental-plugin-market-bundle'

/** The index sources the Discover dialog saved under the retired bundle: its former default, community indexes included. */
const SAVED_INDEXES = [
  'https://raw.githubusercontent.com/Morrowmake/stitch-plugins/main/index.json',
  'https://awesome-dsh-plugin.com/index.json',
  'https://cdn.dsh.so/market/index.json',
]

/** A profile of the given shape that selects the retired bundle and carries the row override Settings wrote for it. */
function legacyProfile(surface: 'web' | 'desktop'): string {
  const home = mkdtempSync(join(tmpdir(), 'stitch-retired-market-'))
  onTestFinished(() => { rmSync(home, { recursive: true, force: true }) })
  const dir = join(home, 'profiles', surface)
  if (surface === 'desktop') createPluginProfile(dir)
  else initProfile(dir, PROFILE_TEMPLATES.web!.bundles)
  const manifest = readProfileManifest('test', dir)
  manifest.dsh = { ...manifest.dsh, profile: { bundles: [...manifest.dsh?.profile?.bundles ?? [], RETIRED] } }
  writeFileSync(join(dir, 'package.json'), `${JSON.stringify(manifest, undefined, 2)}\n`)
  writeFileSync(join(dir, 'cordis.patch.yml'), [
    '- id: plugin-market',
    '  config:',
    '    indexes:',
    ...SAVED_INDEXES.map(url => `      - ${url}`),
    '',
  ].join('\n'))
  return dir
}

describe.each(['web', 'desktop'] as const)('%s profile that selected the retired plugin market bundle', (surface) => {
  it('drops the selection, skips nothing, and applies the saved index sources to the Web composition row', () => {
    const dir = legacyProfile(surface)

    const profile = loadProfileDirectory('test', dir, INSTALL_ANCHOR)

    expect(profile.skippedBundles).toEqual([])
    expect(profile.layers.map(layer => layer.packageName)).not.toContain(RETIRED)
    expect(readProfileManifest('test', dir).dsh?.profile?.bundles).not.toContain(RETIRED)
    const warnings: string[] = []
    const rows = composeEntries([...profile.layers.map(layer => layer.patches), profile.patches], warning => warnings.push(warning))
    expect(warnings).toEqual([])
    const market = rows.filter(row => row.id === 'plugin-market')
    expect(market).toHaveLength(1)
    expect(market[0]).toMatchObject({ id: 'plugin-market', name: '@deepseek-ai/dsh-plugin-market', config: { indexes: SAVED_INDEXES } })
    // The Web row keeps its profile guard; the override replaces only its config.
    expect(market[0]?.disabled).toBeDefined()
    expect(rows.filter(row => row.id === 'ui-plugin-market')).toEqual([{ id: 'ui-plugin-market', name: '@deepseek-ai/dsh-client-ui-plugin-market' }])
    // A second load finds nothing left to rewrite.
    const rewritten = readFileSync(join(dir, 'package.json'), 'utf8')
    loadProfileDirectory('test', dir, INSTALL_ANCHOR)
    expect(readFileSync(join(dir, 'package.json'), 'utf8')).toBe(rewritten)
  })
})

it('leaves the plugin inventory nothing to list under the retired name', () => {
  // The plugin manager lists the profile selection, the installation's bundle dependencies, and the optional bundles.
  const installation = JSON.parse(readFileSync(INSTALL_ANCHOR, 'utf8')) as { dependencies?: Record<string, string> }
  expect(RETIRED_BUNDLES.has(RETIRED)).toBe(true)
  expect(Object.keys(installation.dependencies ?? {})).not.toContain(RETIRED)
  expect(OPTIONAL_BUNDLES).not.toContain(RETIRED)
})
