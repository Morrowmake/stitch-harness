/** MCP resource and server-manager ownership across the resolved shipped profile templates. */

import { mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import { composeEntries, loadProfile } from '@deepseek-ai/dsh-app-boot'
import { PROFILE_TEMPLATES } from '@deepseek-ai/dsh-official-bundles'

const installAnchor = fileURLToPath(new URL('../package.json', import.meta.url))
const resourcePackage = '@deepseek-ai/dsh-mcp-resources'
/** Web templates keep MCP rows as placeholders the MCP component switches on; other templates mount them plainly. */
const mcpSwitch = (name: string): { disabled?: boolean } => PROFILE_TEMPLATES[name]!.bundles.includes('@deepseek-ai/dsh-web-app')
  ? { disabled: !PROFILE_TEMPLATES[name]!.bundles.includes('@deepseek-ai/dsh-component-mcp') }
  : {}

describe('shipped MCP resource composition', () => {
  it.each(Object.keys(PROFILE_TEMPLATES))('%s carries one shared resource consumer without a server', (name) => {
    const home = mkdtempSync(join(tmpdir(), 'dsh-profile-mcp-'))
    try {
      const profile = loadProfile('stitch', name, installAnchor, home)
      const warnings: string[] = []
      const rows = composeEntries([
        ...profile.layers.map(layer => layer.patches),
        profile.patches,
      ], message => warnings.push(message))

      expect(rows.filter(row => row.name === resourcePackage)).toEqual([
        { id: 'mcp-resources', name: resourcePackage, ...mcpSwitch(name) },
      ])
      expect(rows.filter(row => row.name === '@deepseek-ai/dsh-mcp-client')).toEqual([])
      expect(warnings).toEqual([])

      const owners = profile.layers.filter((layer) => {
        const manifest = JSON.parse(readFileSync(join(layer.packageDir, 'package.json'), 'utf8')) as {
          dependencies?: Record<string, string>
        }
        return manifest.dependencies?.[resourcePackage] !== undefined
      })
      // The MCP component, which switches the base row on in Web profiles, declares the package it owns too.
      expect(owners.map(owner => owner.packageName)).toEqual([
        name === 'sdk-minimal' ? '@deepseek-ai/dsh-sdk-minimal' : '@deepseek-ai/dsh-base',
        ...PROFILE_TEMPLATES[name]!.bundles.filter(bundle => bundle === '@deepseek-ai/dsh-component-mcp'),
      ])
    } finally {
      rmSync(home, { recursive: true, force: true })
    }
  })

  it.each(Object.keys(PROFILE_TEMPLATES))('%s mounts the server manager only with the Web application', (name) => {
    const home = mkdtempSync(join(tmpdir(), 'dsh-profile-mcp-'))
    try {
      const profile = loadProfile('stitch', name, installAnchor, home)
      const rows = composeEntries([...profile.layers.map(layer => layer.patches), profile.patches])
      expect(rows.filter(row => row.name === '@deepseek-ai/dsh-mcp-manager')).toEqual(name.startsWith('web')
        ? [{ id: 'mcp-manager', name: '@deepseek-ai/dsh-mcp-manager', inject: ['credentials'], ...mcpSwitch(name) }]
        : [])
    } finally {
      rmSync(home, { recursive: true, force: true })
    }
  })
})
