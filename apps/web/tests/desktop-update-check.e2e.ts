/** Built settings UI drives the update-check preference through a controlled Desktop carrier; no Electron or network is exercised. */
import { readFile } from 'node:fs/promises'
import { join } from 'node:path'
import { chromium } from 'playwright'
import { expect, it } from 'vitest'
import { DesktopUpdateSettings } from '../../desktop/src/update-settings.ts'
import type { DesktopUpdateCheckResult } from '../../desktop/src/ipc.ts'
import { launchWebScaffold, watchConsole } from './scaffold.ts'
import { openSettings } from './support.ts'

it('persists the on-by-default update-check preference and reports Check now', async () => {
  const scaffold = await launchWebScaffold({})
  try {
    const browser = await chromium.launch()
    try {
      const settings = new DesktopUpdateSettings(join(scaffold.harnessHome, 'shell'))
      const results: DesktopUpdateCheckResult[] = [
        { kind: 'current', version: '1.0.0' },
        { kind: 'available', version: '1.1.0', name: 'Stitch 1.1.0' },
        { kind: 'failed' },
      ]
      const page = await browser.newPage({ viewport: { width: 1280, height: 900 }, locale: 'en-US' })
      const tripwire = watchConsole(page)
      await page.exposeFunction('readPreference', () => settings.load())
      await page.exposeFunction('savePreference', async (enabled: boolean) => { await settings.save(enabled); return enabled })
      await page.exposeFunction('runCheck', () => results.shift() ?? { kind: 'failed' })
      await page.addInitScript(() => {
        const bridge = globalThis as typeof globalThis & {
          readPreference(): Promise<boolean>
          savePreference(enabled: boolean): Promise<boolean>
          runCheck(): Promise<DesktopUpdateCheckResult>
        }
        Object.assign(globalThis, { dshDesktop: { protocolVersion: 1, updates: {
          getPreference: () => bridge.readPreference(),
          setPreference: (enabled: boolean) => bridge.savePreference(enabled),
          subscribe: () => () => {},
          check: () => bridge.runCheck(),
        } } })
      })
      await page.goto(scaffold.authenticatedUrl, { waitUntil: 'load' })
      await openSettings(page, 'en')
      const row = page.getByRole('group', { name: 'Check for updates daily (contacts api.github.com)', exact: true })
      await row.getByText('On by default. Stitch checks GitHub Releases for a newer version at startup and once a day, and can install a signature-verified update in one click. No other data is sent.',
        { exact: true }).waitFor()
      const toggle = row.getByRole('switch', { name: 'Check for updates daily (contacts api.github.com)', exact: true })
      await expect.poll(() => toggle.getAttribute('aria-checked')).toBe('true')
      await toggle.click()
      await expect.poll(() => toggle.getAttribute('aria-checked')).toBe('false')
      expect(JSON.parse(await readFile(settings.path, 'utf8'))).toMatchObject({ updates: { checkForUpdates: false } })
      const checkNow = row.getByRole('button', { name: 'Check now', exact: true })
      await checkNow.click()
      await row.getByText('You’re up to date (1.0.0).', { exact: true }).waitFor()
      await checkNow.click()
      await row.getByText('Version 1.1.0 is available.', { exact: true }).waitFor()
      await checkNow.click()
      await row.getByText('Could not check for updates. Try again later.', { exact: true }).waitFor()
      await toggle.click()
      await expect.poll(() => toggle.getAttribute('aria-checked')).toBe('true')
      expect(await settings.load()).toBe(true)
      expect(tripwire.pageErrors).toEqual([])
      expect(tripwire.warnings).toEqual([])
    } finally { await browser.close() }
  } finally { await scaffold.close() }
})
