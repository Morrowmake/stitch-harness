/** Startup preferences reuse authenticated Web RPC and read only shared settings. */
import { describe, expect, it, vi } from 'vitest'
import { connectDesktopHostPreferences } from '../src/host-preferences.ts'

function transport(preference?: string) {
  const namespaces: Array<{ ns: string; value: Record<string, unknown> }> = [
    { ns: 'locale', value: preference === undefined ? {} : { preference } },
  ]
  const send = vi.fn<NonNullable<Parameters<typeof connectDesktopHostPreferences>[2]>>(async (_input, init) => {
    const { rpcId } = JSON.parse(init!.body as string) as { rpcId: string }
    return Response.json({ type: 'server-response', rpcId, result: { ok: true, value: { namespaces } } })
  })
  return { send, namespaces }
}

const url = 'http://127.0.0.1:19387/'
const cookie = 'dsh-auth-fixture=signed'

describe('desktop Host preferences', () => {
  it.each(['light', 'dark', 'system'] as const)('reads the live %s theme', async (preference) => {
    const host = transport()
    host.namespaces.push({ ns: 'ui-theme', value: { preference } })
    const reader = connectDesktopHostPreferences(url, cookie, host.send)
    expect(await reader.read()).toEqual({ localePreference: null, themePreference: preference })
    host.namespaces.find(item => item.ns === 'ui-theme')!.value.preference = 'system'
    expect(await reader.read()).toMatchObject({ themePreference: 'system' })
  })

  it('falls back for an invalid optional theme without blocking startup', async () => {
    const host = transport()
    host.namespaces.push({ ns: 'ui-theme', value: { preference: 'invalid' } })
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    try {
      expect(await connectDesktopHostPreferences(url, cookie, host.send).read()).toMatchObject({ themePreference: 'system' })
      expect(warn).toHaveBeenCalledOnce()
    } finally { warn.mockRestore() }
  })

  it('reads the explicit language through one authenticated settings request', async () => {
    const host = transport('zh')
    expect(await connectDesktopHostPreferences(url, cookie, host.send).read()).toEqual({ localePreference: 'zh', themePreference: 'system' })
    expect(host.send).toHaveBeenCalledOnce()
    const [input, init] = host.send.mock.calls[0]!
    expect(input).toBe('http://127.0.0.1:19387/api/settings/describe')
    expect(init).toMatchObject({ redirect: 'error', headers: { cookie } })
    expect(init).not.toHaveProperty('credentials')
  })

  it('rejects unmatched RPC envelopes', async () => {
    const host = transport()
    host.send.mockResolvedValueOnce(Response.json({ type: 'server-response', rpcId: 'other', result: { ok: true } }))
    await expect(connectDesktopHostPreferences(url, cookie, host.send).read()).rejects.toThrow('Web RPC failed')
  })
})
