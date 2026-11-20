/** Preset card heading layout, asserted against the stylesheet on disk. */
import { readFileSync } from 'node:fs'
import { expect, it } from 'vitest'

const css = readFileSync(new URL('../src/client/AgentPresetSection.module.css', import.meta.url), 'utf8')

it('wraps a long preset name and moves its badge below instead of truncating the name', () => {
  const identity = /\n\.cardIdentity\s*\{([^}]*)\}/.exec(css)?.[1] ?? ''
  expect(identity).toContain('flex-wrap: wrap;')
  const name = /\n\.cardName\s*\{([^}]*)\}/.exec(css)?.[1] ?? ''
  expect(name).not.toMatch(/white-space: nowrap|text-overflow/)
  expect(name).toContain('overflow-wrap: break-word;')
})
