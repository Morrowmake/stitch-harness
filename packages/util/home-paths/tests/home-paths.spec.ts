import { mkdir, mkdtemp, realpath, rm, symlink, writeFile } from 'node:fs/promises'
import { homedir, tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  AGENTS_HOME_DIR_NAME,
  DEFAULT_AGENTS_HOME_DISPLAY,
  DEFAULT_DSH_HOME_DISPLAY,
  DSH_HOME_DIR_NAME,
  agentsHomeDisplay,
  canonicalizeWatchPath,
  defaultAgentsHome,
  defaultDshHome,
  dshCachePath,
  dshHomeDisplay,
  dshHomePath,
  dshPath,
  expandHomePath,
  readProductEnv,
  resolveAgentsHome,
  resolveDshHome,
} from '@deepseek-ai/dsh-home-paths'

afterEach(() => {
  vi.unstubAllEnvs()
})

describe('dsh path helpers', () => {
  it('owns the shared default Stitch home directory name', () => {
    expect(DSH_HOME_DIR_NAME).toBe('.stitch')
    expect(DEFAULT_DSH_HOME_DISPLAY).toBe('~/.stitch')
    expect(defaultDshHome()).toBe(join(homedir(), '.stitch'))
  })

  it('expands tilde paths without changing non-tilde paths', () => {
    expect(expandHomePath('~')).toBe(homedir())
    expect(expandHomePath('~/.stitch')).toBe(join(homedir(), '.stitch'))
    expect(expandHomePath('~\\.stitch')).toBe(join(homedir(), '.stitch'))
    expect(expandHomePath('/tmp/.stitch')).toBe('/tmp/.stitch')
    expect(expandHomePath('~other/.stitch')).toBe('~other/.stitch')
  })

  it('resolves explicit path before STITCH_HOME and the default', () => {
    const envHome = join(homedir(), 'env-dsh')

    expect(resolveDshHome('/tmp/explicit-dsh', { STITCH_HOME: '~/env-dsh' })).toBe(resolve('/tmp/explicit-dsh'))
    expect(resolveDshHome(undefined, { STITCH_HOME: '~/env-dsh' })).toBe(envHome)
    expect(resolveDshHome(undefined, {})).toBe(defaultDshHome())
  })

  it('treats an empty or whitespace-only STITCH_HOME as unset', () => {
    expect(resolveDshHome(undefined, { STITCH_HOME: '' })).toBe(defaultDshHome())
    expect(resolveDshHome(undefined, { STITCH_HOME: '   ' })).toBe(defaultDshHome())
  })

  it('falls back to DeepSeek Harness DSH_* variables only when the STITCH_* one is absent', () => {
    expect(readProductEnv('SESSION_ID', { DSH_SESSION_ID: 'dsh' })).toBe('dsh')
    expect(readProductEnv('SESSION_ID', { STITCH_SESSION_ID: 'stitch', DSH_SESSION_ID: 'dsh' })).toBe('stitch')
    expect(readProductEnv('SESSION_ID', {})).toBeUndefined()
    expect(resolveDshHome(undefined, { DSH_HOME: '/tmp/dsh-home' })).toBe(resolve('/tmp/dsh-home'))
    expect(resolveDshHome(undefined, { STITCH_HOME: '/tmp/stitch-home', DSH_HOME: '/tmp/dsh-home' })).toBe(resolve('/tmp/stitch-home'))
    expect(resolveAgentsHome(undefined, { DSH_AGENTS_HOME: '/tmp/dsh-agents' })).toBe(resolve('/tmp/dsh-agents'))
    expect(resolveAgentsHome(undefined, { STITCH_AGENTS_HOME: '/tmp/a', DSH_AGENTS_HOME: '/tmp/b' })).toBe(resolve('/tmp/a'))
  })

  it('joins child segments onto the resolved STITCH_HOME', () => {
    vi.stubEnv('STITCH_HOME', '~/env-dsh')
    expect(dshHomePath()).toBe(join(homedir(), 'env-dsh'))
    expect(dshHomePath('storages', 'cache')).toBe(join(homedir(), 'env-dsh', 'storages', 'cache'))
  })

  it('labels a resolved home by whether it is the default root', () => {
    expect(dshHomeDisplay(resolve(defaultDshHome()))).toBe('~/.stitch')
    expect(dshHomeDisplay('/some/other/root')).toBe('$STITCH_HOME')
  })

  it('owns the shared default agents home directory name', () => {
    expect(AGENTS_HOME_DIR_NAME).toBe('.agents')
    expect(DEFAULT_AGENTS_HOME_DISPLAY).toBe('~/.agents')
    expect(defaultAgentsHome()).toBe(join(homedir(), '.agents'))
  })

  it('resolves an explicit agents home before STITCH_AGENTS_HOME and the default', () => {
    const envHome = join(homedir(), 'env-agents')

    expect(resolveAgentsHome('/tmp/explicit-agents', { STITCH_AGENTS_HOME: '~/env-agents' })).toBe(resolve('/tmp/explicit-agents'))
    expect(resolveAgentsHome(undefined, { STITCH_AGENTS_HOME: '~/env-agents' })).toBe(envHome)
    expect(resolveAgentsHome(undefined, {})).toBe(defaultAgentsHome())
  })

  it('treats an empty or whitespace-only STITCH_AGENTS_HOME as unset', () => {
    expect(resolveAgentsHome(undefined, { STITCH_AGENTS_HOME: '' })).toBe(defaultAgentsHome())
    expect(resolveAgentsHome(undefined, { STITCH_AGENTS_HOME: '   ' })).toBe(defaultAgentsHome())
  })

  it('labels a resolved agents home by whether it is the default root', () => {
    expect(agentsHomeDisplay(resolve(defaultAgentsHome()))).toBe('~/.agents')
    expect(agentsHomeDisplay('/some/other/root')).toBe('$STITCH_AGENTS_HOME')
  })

  it.each([
    [undefined, join(homedir(), '.stitch')],
    ['', join(homedir(), '.stitch')],
    ['   ', join(homedir(), '.stitch')],
    ['~/env-dsh', join(homedir(), 'env-dsh')],
    ['./relative-dsh', resolve('./relative-dsh')],
  ] as const)('resolves cache paths with STITCH_HOME=%j', (home, expectedHome) => {
    vi.stubEnv('STITCH_HOME', home)
    try {
      expect(dshCachePath()).toBe(join(expectedHome, 'cache'))
      expect(dshCachePath('models', 'index.json')).toBe(join(expectedHome, 'cache', 'models', 'index.json'))
    } finally {
      vi.unstubAllEnvs()
    }
  })

  it('resolves configured cache homes before the environment', () => {
    vi.stubEnv('STITCH_HOME', '~/env-dsh')
    try {
      expect(dshCachePath({ dshHome: '~/explicit-dsh' })).toBe(join(homedir(), 'explicit-dsh', 'cache'))
      expect(dshCachePath({ dshHome: './explicit-dsh' }, 'attachments', 'request-images'))
        .toBe(resolve('./explicit-dsh/cache/attachments/request-images'))
      expect(dshCachePath({}, 'attachments')).toBe(join(homedir(), 'env-dsh', 'cache', 'attachments'))
    } finally {
      vi.unstubAllEnvs()
    }
  })

  it.each([
    [undefined, join(homedir(), '.stitch')],
    ['', join(homedir(), '.stitch')],
    ['~/env-dsh', join(homedir(), 'env-dsh')],
    ['./relative-dsh', resolve('./relative-dsh')],
  ] as const)('resolves category paths with STITCH_HOME=%j', (home, expectedHome) => {
    vi.stubEnv('STITCH_HOME', home)
    for (const category of ['config', 'data', 'state', 'cache', 'backup'] as const) {
      expect(dshPath(category)).toBe(join(expectedHome, category))
      expect(dshPath(category, 'owner', 'file.json')).toBe(join(expectedHome, category, 'owner', 'file.json'))
    }
  })

  it('resolves a configured category home before the environment', () => {
    vi.stubEnv('STITCH_HOME', '~/env-dsh')
    expect(dshPath({ category: 'state', dshHome: '~/explicit-dsh' }, 'logs')).toBe(join(homedir(), 'explicit-dsh', 'state', 'logs'))
    expect(dshPath({ category: 'data', dshHome: undefined })).toBe(join(homedir(), 'env-dsh', 'data'))
  })

  it('canonicalizes a watcher ancestor while preserving a missing suffix', async () => {
    const root = await mkdtemp(join(tmpdir(), 'dsh-watch-path-'))
    const target = join(root, 'target')
    const alias = join(root, 'alias')
    try {
      await mkdir(target)
      await symlink(target, alias, process.platform === 'win32' ? 'junction' : 'dir')
      await expect(canonicalizeWatchPath(alias)).resolves.toBe(await realpath(target))
      await expect(canonicalizeWatchPath(join(alias, 'later', 'config.yml'))).resolves.toBe(
        join(await realpath(target), 'later', 'config.yml'),
      )
      const file = join(root, 'file')
      await writeFile(file, 'not a directory')
      await expect(canonicalizeWatchPath(join(file, 'child'))).rejects.toMatchObject({ code: 'ENOTDIR' })
    } finally {
      await rm(root, { recursive: true, force: true })
    }
  })
})
