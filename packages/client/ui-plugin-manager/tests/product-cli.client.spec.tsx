// @vitest-environment jsdom
/** The program section of the Claude Code and Codex bundles: each status as a person reads it, and what each button asks. */
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { PluginInstallRequestId, ProductCliStatus } from '@deepseek-ai/dsh-api-remotes/client'
import { ProductCliSection } from '../src/client/ProductCliSection.tsx'
import type { ProductCliState, ProductCliTask } from '../src/client/product-cli-store.ts'
import { en, type PluginManagerLocaleKey } from '../src/client/locales.ts'
import type { Translate } from '../src/client/presentation.ts'

afterEach(cleanup)

const t = ((key: PluginManagerLocaleKey, params?: Record<string, string>): string =>
  Object.entries(params ?? {}).reduce((text, [name, value]) => text.replaceAll(`{${name}}`, value), en[key])) as Translate

const CLAUDE = '@deepseek-ai/dsh-subagent-claude-code'

const MISSING: ProductCliStatus = {
  id: 'claude-code', bundle: CLAUDE, displayName: 'Claude Code', available: false,
  tooOld: [], minimumVersion: '2.0.0', download: { version: '2.1.328', sizeBytes: 191_000_000 }, downloaded: false,
  installCommand: 'npm install -g @anthropic-ai/claude-code',
}
const INSTALLED: ProductCliStatus = { ...MISSING, available: true, source: 'installed', path: '/usr/local/bin/claude', version: '2.1.328' }
const { version: _version, ...UNVERSIONED } = INSTALLED
const { source: _source, path: _path, ...UNLOCATED } = INSTALLED
const REQUEST = 'request-1' as PluginInstallRequestId

function renderSection(clis: readonly ProductCliStatus[], tasks: ProductCliState['tasks'] = {}, status: ProductCliState['status'] = 'ready', bundle = CLAUDE) {
  const props = {
    ensure: vi.fn(), retryRead: vi.fn(), download: vi.fn(), cancel: vi.fn(), remove: vi.fn(),
  }
  render(<ProductCliSection bundle={bundle} state={{ status, clis, tasks }} t={t} {...props} />)
  return props
}

/** The status row's text. */
const statusText = (): string => screen.getByRole('status').textContent ?? ''

describe('ProductCliSection', () => {
  it('renders nothing and reads nothing for a bundle that runs no product CLI', () => {
    const { ensure } = renderSection([], {}, 'idle', 'dsh-better-sidebar')
    expect(document.querySelector('section')).toBeNull()
    expect(ensure).not.toHaveBeenCalled()
  })

  it('reads the statuses when it opens, and offers a retry for a failed read', () => {
    const { ensure, retryRead } = renderSection([], {}, 'loading')
    expect(ensure).toHaveBeenCalledOnce()
    expect(screen.getByRole('heading', { name: en.productCliTitle })).toBeTruthy()
    expect(statusText()).toBe(en.productCliChecking)
    cleanup()
    const failed = renderSection([], {}, 'error')
    expect(statusText()).toContain(en.productCliReadFailed)
    fireEvent.click(screen.getByRole('button', { name: en.retry }))
    expect(failed.retryRead).toHaveBeenCalledOnce()
    expect(retryRead).not.toHaveBeenCalled()
  })

  it.each([
    [INSTALLED, 'Using your installed Claude Code 2.1.328 at /usr/local/bin/claude'],
    [{ ...INSTALLED, source: 'configured' as const }, 'Using Claude Code 2.1.328 from the configured path /usr/local/bin/claude'],
    [{ ...UNVERSIONED, source: 'bundled' as const }, 'Using the Claude Code that ships with Stitch at /usr/local/bin/claude'],
    [UNLOCATED, 'Using your installed Claude Code 2.1.328 at '],
  ])('names the executable it uses (%#) and offers no download', (cli, text) => {
    const { download } = renderSection([cli])
    expect(statusText()).toBe(text)
    expect(screen.queryByRole('button')).toBeNull()
    expect(document.querySelector('[data-product-cli-command]')).toBeNull()
    expect(download).not.toHaveBeenCalled()
  })

  it('offers the download by size and the command to install it yourself when nothing is installed', () => {
    const { download } = renderSection([MISSING])
    expect(statusText()).toContain('Claude Code is not installed')
    fireEvent.click(screen.getByRole('button', { name: 'Download (about 191 MB)' }))
    expect(download).toHaveBeenCalledWith('claude-code')
    expect(screen.getByText(en.productCliInstallYourself, { exact: false })).toBeTruthy()
    expect(document.querySelector('[data-product-cli-command]')?.textContent).toBe('npm install -g @anthropic-ai/claude-code')
    expect(document.querySelector('[data-product-cli-too-old]')).toBeNull()
  })

  it('names each install that is too old with the version it needs', () => {
    renderSection([{ ...MISSING, tooOld: [{ path: '/opt/claude', version: '1.0.3' }, { path: '/usr/bin/claude', version: '1.9.0' }] }])
    const lines = [...document.querySelectorAll('[data-product-cli-too-old]')].map(line => line.textContent)
    expect(lines).toEqual([
      'Claude Code 1.0.3 at /opt/claude is too old; this plugin needs 2.0.0 or later.',
      'Claude Code 1.9.0 at /usr/bin/claude is too old; this plugin needs 2.0.0 or later.',
    ])
    expect(screen.getByRole('button', { name: 'Download (about 191 MB)' })).toBeTruthy()
  })

  it('shows only the install command where Stitch has no download for this system', () => {
    renderSection([{ ...MISSING, download: null }])
    expect(statusText()).toContain('Stitch has no download of Claude Code for this system.')
    expect(screen.queryByRole('button')).toBeNull()
    expect(document.querySelector('[data-product-cli-command]')).not.toBeNull()
  })

  it.each([
    [{ phase: 'downloading', receivedBytes: 95_500_000, totalBytes: 191_000_000 }, 'Downloading… 50%'],
    [{ phase: 'downloading', receivedBytes: 0, totalBytes: 0 }, en.productCliDownloadStarting],
    [{ phase: 'verifying', receivedBytes: 191_000_000, totalBytes: 191_000_000 }, en.productCliVerifying],
    [{ phase: 'installing', receivedBytes: 191_000_000, totalBytes: 191_000_000 }, en.productCliInstalling],
  ] as const)('reports a running download (%o) and cancels it', (progress, text) => {
    const { cancel, download } = renderSection([MISSING], { 'claude-code': { kind: 'download', requestId: REQUEST, cancelling: false, ...progress } })
    expect(statusText()).toContain(text)
    fireEvent.click(screen.getByRole('button', { name: en.cancel }))
    expect(cancel).toHaveBeenCalledWith('claude-code')
    expect(screen.queryByRole('button', { name: /Download/ })).toBeNull()
    expect(download).not.toHaveBeenCalled()
  })

  it('disables Cancel while a cancellation is pending', () => {
    renderSection([MISSING], { 'claude-code': { kind: 'download', requestId: REQUEST, phase: 'downloading', receivedBytes: 1, totalBytes: 2, cancelling: true } })
    expect(statusText()).toContain(en.productCliCancelling)
    expect(screen.getByRole('button', { name: en.cancel })).toHaveProperty('disabled', true)
  })

  it.each([
    ['network', en.productCliFailedNetwork],
    ['integrity', en.productCliFailedIntegrity],
    ['unsupported-platform', 'There is no Claude Code download for this system.'],
    ['filesystem', en.productCliFailedFilesystem],
    ['busy', 'Another download of Claude Code is already running.'],
    ['cancelled', en.productCliFailedCancelled],
    ['other', en.productCliFailedOther],
  ] as const)('explains a %s download failure and retries the download', (failure, text) => {
    const { download } = renderSection([MISSING], { 'claude-code': { kind: 'failed', action: 'download', failure } })
    expect(statusText()).toContain(text)
    fireEvent.click(screen.getByRole('button', { name: en.retry }))
    expect(download).toHaveBeenCalledWith('claude-code')
    expect(document.querySelector('[data-product-cli-command]')).not.toBeNull()
  })

  it('says Stitch downloaded the copy in use and removes it', () => {
    const downloaded: ProductCliStatus = { ...INSTALLED, source: 'downloaded', path: '/stitch/claude', downloaded: true }
    const { remove } = renderSection([downloaded])
    expect(statusText()).toContain('Using Claude Code 2.1.328 downloaded by Stitch')
    fireEvent.click(screen.getByRole('button', { name: en.productCliRemove }))
    expect(remove).toHaveBeenCalledWith('claude-code')
  })

  it('offers removal of a leftover download beside the download button, and of one on a system without downloads', () => {
    renderSection([{ ...MISSING, downloaded: true }])
    expect(screen.getByRole('button', { name: en.productCliRemove })).toBeTruthy()
    expect(screen.getByRole('button', { name: 'Download (about 191 MB)' })).toBeTruthy()
    cleanup()
    renderSection([{ ...MISSING, downloaded: true, download: null }])
    expect(screen.getByRole('button', { name: en.productCliRemove })).toBeTruthy()
  })

  it('reports a running removal and retries a failed one', () => {
    renderSection([{ ...INSTALLED, downloaded: true }], { 'claude-code': { kind: 'remove' } })
    expect(statusText()).toBe(en.productCliRemoving)
    expect(screen.queryByRole('button')).toBeNull()
    cleanup()
    const failed: ProductCliTask = { kind: 'failed', action: 'remove', failure: 'other' }
    const { remove } = renderSection([{ ...INSTALLED, downloaded: true }], { 'claude-code': failed })
    expect(statusText()).toContain(en.productCliRemoveFailed)
    fireEvent.click(screen.getByRole('button', { name: en.retry }))
    expect(remove).toHaveBeenCalledWith('claude-code')
  })
})
