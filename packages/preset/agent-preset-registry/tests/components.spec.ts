import { afterEach, describe, expect, it, vi } from 'vitest'
import type { Context } from '@deepseek-ai/cordis'
import * as ComponentMarker from '../src/component.ts'
import { agentOn, declare, harness, plugin } from './harness.ts'

const contexts: Context[] = []
afterEach(async () => { for (const ctx of contexts.splice(0)) await ctx.fiber.dispose() })
async function setup() {
  const ctx = await harness()
  contexts.push(ctx)
  // The Loader imports a path natively, which resolves the marker's workspace imports to unbuilt `lib`
  // outputs; a builtin keeps the source marker without native package resolution.
  ctx.loader.builtins.component = ComponentMarker
  return ctx
}

/** Mount or disable the `component-x` marker row in the Host Loader tree. */
async function setMarker(ctx: Context, enabled: boolean) {
  await ctx.loader.root.update([{ id: 'component-x', name: 'cordis:component', config: { id: 'x' }, disabled: !enabled }])
}

async function tools(ctx: Context, session: string) {
  return ctx.tools.schemas(await agentOn(ctx, session)).map(row => row.name).sort()
}

describe('component gates', () => {
  it('mounts gated rows by marker presence and re-composes when the marker toggles', async () => {
    const ctx = await setup()
    await declare(ctx, {
      id: 'standard',
      plugins: [
        { name: plugin('contribute'), config: { tool: 'always' } },
        { name: plugin('contribute'), config: { tool: 'with-x' }, component: 'x' },
        { name: plugin('contribute'), config: { tool: 'without-x' }, component: '!x' },
      ] as never,
    })
    expect(await tools(ctx, 'off')).toEqual(['always', 'without-x'])
    await setMarker(ctx, true)
    await vi.waitFor(async () => { expect(await tools(ctx, `on-${Math.random()}`)).toEqual(['always', 'with-x']) })
    await setMarker(ctx, false)
    await vi.waitFor(async () => { expect(await tools(ctx, `off-${Math.random()}`)).toEqual(['always', 'without-x']) })
  })

  it('hides a definition whose own gate fails from the roster', async () => {
    const ctx = await setup()
    await declare(ctx, { id: 'standard', plugins: [{ name: plugin('contribute'), config: { tool: 'standard' } }] })
    await declare(ctx, { id: 'gated', component: 'x', plugins: [{ name: plugin('contribute'), config: { tool: 'gated' } }] })
    const ids = async () => (await ctx.agentPresets.list()).map(row => row.id).sort()
    expect(await ids()).toEqual(['standard'])
    await setMarker(ctx, true)
    await vi.waitFor(async () => { expect(await ids()).toEqual(['gated', 'standard']) })
    await setMarker(ctx, false)
    await vi.waitFor(async () => { expect(await ids()).toEqual(['standard']) })
  })
})
