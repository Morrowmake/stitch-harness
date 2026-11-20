import { writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { clearAmbientProxyEnv } from '../../../../../../scripts/test-proxy-environment.ts'

/** Credential reference the fixture route resolves; its value is never checked by local model fixtures. */
export const MOCK_ROUTE_KEY_ENV = 'STITCH_TEST_API_KEY'

/** The provider route and model the fixture route serves. */
export const MOCK_ROUTE = { provider: 'mock', model: 'mock-model' } as const

/** A second model on the same fixture route, for tests that switch models. */
export const MOCK_ALT_MODEL = 'mock-model-alt'

/** The `llm-pi-ai` row serving {@link MOCK_ROUTE} as an Anthropic Messages route at `baseUrl`. */
export function mockRouteRow(baseUrl: string): object {
  return { id: 'llm-pi-ai', config: { providers: { [MOCK_ROUTE.provider]: {
    apiKeyEnv: MOCK_ROUTE_KEY_ENV, api: 'anthropic-messages', baseURL: baseUrl,
    models: [MOCK_ROUTE.model, MOCK_ALT_MODEL].map(id => ({ id, contextWindow: 131_072, maxTokens: 8192, input: ['text', 'image'] })),
  } } } }
}

/** Base-profile rows routing the default agent through {@link mockRouteRow}. */
export function mockRouteRows(baseUrl: string): object[] {
  return [{ id: 'agent-default-model', config: MOCK_ROUTE }, mockRouteRow(baseUrl)]
}

/** Write {@link mockRouteRows} as a launch patch under `dir` and return its path. */
export async function writeMockRoutePatch(dir: string, baseUrl: string): Promise<string> {
  const path = join(dir, 'mock-route.patch.yml')
  await writeFile(path, JSON.stringify(mockRouteRows(baseUrl)))
  return path
}

/** Isolate SDK profile processes from ambient profile, runtime and Node loader settings. */
export function profileEnvironment(root: string): NodeJS.ProcessEnv {
  const env = Object.fromEntries(Object.entries(process.env).filter(([key]) => !key.startsWith('STITCH_')))
  Object.assign(env, {
    STITCH_PERMISSION_MODE: 'danger-full-access',
    STITCH_AGENTS_HOME: join(root, 'agents'), STITCH_PRIMARY_RUNTIME: '',
    [MOCK_ROUTE_KEY_ENV]: 'keyless-profile-test',
    NODE_OPTIONS: '', NODE_PATH: '',
  })
  clearAmbientProxyEnv(env)
  return env
}
