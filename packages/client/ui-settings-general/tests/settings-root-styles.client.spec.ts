/** Settings carrier geometry is independent of contributed launcher markup. */
import { readFileSync } from 'node:fs'
import { expect, it } from 'vitest'

const css = readFileSync(new URL('../src/client/SettingsRoot.module.css', import.meta.url), 'utf8')

it('keeps the indicator carrier full-width without inspecting account state', () => {
  expect(css).toMatch(/\.triggerRow\s*\{[^}]*width: 100%;[^}]*margin: 4px 0;/)
  expect(css).not.toContain('data-signed-out')
  expect(css).toMatch(/\.triggerRow\.railRow\s*\{[^}]*width: 36px;/)
})

it('wraps a long section label in the rail instead of cutting it off', () => {
  const label = /\n\.navLabel\s*\{([^}]*)\}/.exec(css)?.[1] ?? ''
  expect(label).not.toMatch(/white-space: nowrap|text-overflow/)
  expect(label).toContain('overflow-wrap: break-word;')
  expect(label).toContain('hyphens: auto;')
  const cell = /\n\.navCell\s*\{([^}]*)\}/.exec(css)?.[1] ?? ''
  expect(cell).toContain('min-height: 40px;')
  expect(cell).not.toMatch(/(?:^|\s)height:/)
})
