/**
 * macOS sidebar surface in the dark palette: the column tint resolves to the
 * opaque themed sidebar fill, so the dark sidebar never shows a light native
 * vibrancy material through it. The light palette keeps its translucent tint.
 */
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import { parseRules } from './stylesheet-scan.ts'

const rules = parseRules(readFileSync(
  fileURLToPath(new URL('../src/styles/design-platform.css', import.meta.url)), 'utf8'))

/**
 * Last declaration of a property across rules whose only selector is `selector`.
 * @param selector - exact selector.
 * @param property - custom property name.
 * @returns the cascaded value, if any rule declares it.
 */
function declared(selector: string, property: string): string | undefined {
  return rules
    .filter(rule => rule.selectors.length === 1 && rule.selectors[0] === selector)
    .flatMap(rule => rule.declarations)
    .filter(([name]) => name === property)
    .at(-1)?.[1]
}

describe('macOS sidebar surface', () => {
  it('paints the dark sidebar with the opaque themed sidebar fill', () => {
    expect(declared('html[data-platform=\'darwin\'] body[data-ds-dark-theme]', '--dsw-specific-sidebar-tint'))
      .toBe('var(--dsw-specific-sidebar-fill)')
    const darkFill = declared('body[data-ds-dark-theme]', '--dsw-specific-sidebar-fill')
    expect(darkFill).toMatch(/^var\(--dsw-static-[a-z-]+-\d+\)$/)
  })

  it('keeps the light sidebar translucent so window vibrancy shows', () => {
    expect(declared('html[data-platform=\'darwin\'] body', '--dsw-specific-sidebar-tint')).toMatch(/transparent\)$/)
  })
})
