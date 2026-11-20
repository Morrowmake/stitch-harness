import { spawnSync } from 'node:child_process'
import { mkdtempSync, readFileSync, readdirSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { runInNewContext } from 'node:vm'
import * as yaml from 'js-yaml'
import { describe, expect, it } from 'vitest'

const root = resolve(import.meta.dirname, '..')
const nativeWindowsPnpmDestination = '${{ runner.temp }}/setup-pnpm-js-${{ github.run_id }}-${{ github.run_attempt }}-${{ github.job }}'
const workflowDirectory = resolve(root, '.github/workflows')
const workflowFiles = readdirSync(workflowDirectory).filter(name => name.endsWith('.yml')).sort()
// Standard GitHub-hosted images only: no self-hosted pools, larger runners, or third-party runners.
const hostedRunners = new Set([
  'ubuntu-latest', 'ubuntu-24.04', 'ubuntu-24.04-arm',
  'macos-latest', 'macos-14', 'macos-15', 'macos-15-intel',
  'windows-latest', 'windows-2025',
])
// First-party Pages actions publish only major tags; every other action pins an exact release.
const majorOnlyActions = new Set(['actions/configure-pages@v6', 'actions/upload-pages-artifact@v5', 'actions/deploy-pages@v5'])

describe('CI workflow', () => {
  it('runs build, test, and lint on hosted Ubuntu for pull requests and master pushes', () => {
    const workflow = loadWorkflow('.github/workflows/ci.yml')
    if (!isRecord(workflow.on) || !isRecord(workflow.jobs)) throw new TypeError('CI must define triggers and jobs')
    expect(Object.keys(workflow.on).sort()).toEqual(['pull_request', 'push', 'workflow_dispatch'])
    expect(workflow.on.push).toEqual({ branches: ['master'] })
    expect(workflow.permissions).toEqual({ contents: 'read' })
    expect(workflow.concurrency).toEqual({
      group: '${{ github.workflow }}-${{ github.ref }}',
      'cancel-in-progress': "${{ github.event_name == 'pull_request' }}",
    })
    expect(Object.keys(workflow.jobs).sort()).toEqual(['all-checks-passed', 'build', 'lint', 'test'])
    for (const [name, command] of [['build', 'pnpm run build'], ['test', 'pnpm run test'], ['lint', 'pnpm run lint']] as const) {
      const job = workflowJob(workflow, name)
      if (!Array.isArray(job.steps)) throw new TypeError(`${name} must define steps`)
      const steps = job.steps.filter(isRecord)
      expect(job['runs-on']).toBe('ubuntu-24.04')
      expect(job).not.toHaveProperty('if')
      expect(steps.slice(0, 4)).toEqual([
        { uses: 'actions/checkout@v7.0.1', with: { 'persist-credentials': false } },
        { uses: 'pnpm/action-setup@v5.0.0' },
        { uses: 'actions/setup-node@v7.0.0', with: { 'node-version': 24, cache: 'pnpm' } },
        { name: 'Install (immutable)', run: 'pnpm install --frozen-lockfile' },
      ])
      expect(steps.at(-1)).toMatchObject({ run: command })
      expect(steps.filter(step => step.run === command)).toHaveLength(1)
    }
  })

  it('reports one stable verdict over every CI job without outliving a cancelled run', () => {
    for (const [file, name, event] of [['ci.yml', 'all-checks-passed', 'push'], ['ci-python.yml', 'python-checks-passed', 'pull_request']] as const) {
      const workflow = loadWorkflow('.github/workflows/' + file)
      const verdict = workflowJob(workflow, name)
      if (!isRecord(workflow.jobs) || !Array.isArray(verdict.needs) || !Array.isArray(verdict.steps) || typeof verdict.if !== 'string') {
        throw new TypeError(`${file} must define the ${name} verdict`)
      }
      expect((verdict.needs as unknown[]).map(String).sort()).toEqual(Object.keys(workflow.jobs).filter(id => id !== name).sort())
      expect(verdict['runs-on']).toMatch(/^ubuntu-/u)
      const failure = verdict.steps.filter(isRecord).find(step => step.name === 'Fail if any needed job did not succeed')
      if (typeof failure?.if !== 'string') throw new TypeError(`${name} must fail on unsuccessful needs`)
      expect(failure.run).toContain('exit 1')
      for (const result of ['success', 'failure', 'skipped', 'cancelled']) {
        const results = verdict.needs.map(() => 'success')
        results[0] = result
        expect(evaluateCondition(verdict.if, false, results, event)).toBe(true)
        expect(evaluateCondition(verdict.if, true, results, event)).toBe(false)
        expect(evaluateCondition(failure.if, false, results, event)).toBe(result !== 'success')
      }
    }
  })

  it('prepares confinement before the unit suite and grants the hosted test budget', () => {
    const job = workflowJob(loadWorkflow('.github/workflows/ci.yml'), 'test')
    if (!Array.isArray(job.steps)) throw new TypeError('CI test job must define steps')
    const steps = job.steps.filter(isRecord)
    const preparation = steps.findIndex(step => step.run === 'bash scripts/prepare-ci-bubblewrap.sh')
    const test = steps.findIndex(step => step.run === 'pnpm run test')
    expect(preparation).toBeGreaterThanOrEqual(0)
    expect(test).toBeGreaterThan(preparation)
    expect(steps[preparation]).not.toHaveProperty('continue-on-error', true)
    expect(job.env).toEqual({ STITCH_COVERAGE_TEST_TIMEOUT_MS: '90000' })
  })

  it('keeps the library build scripts the release rehearsals call', () => {
    const scripts = JSON.parse(readFileSync(resolve(root, 'package.json'), 'utf8')) as { scripts: Record<string, string> }
    const hostSteps = scripts.scripts['build:lib:host']!.split(' && ')
    expect(hostSteps[0]).toBe('tsx scripts/compile-referenced-projects.ts host-libraries')
    expect(hostSteps).toContain('node --max-old-space-size=8192 ./node_modules/typescript/bin/tsc -p tsconfig.host.json')
    expect(hostSteps.at(-1)).toBe('pnpm --filter @deepseek-ai/dsh-desktop run bundle')
    expect(scripts.scripts['build:lib:client']).toContain('tsc -b tsconfig.client.json')
    expect(scripts.scripts.typecheck).toBe('tsx scripts/build.ts --scope typecheck')
  })

  it('selects artifact builds only for PR release and API rehearsals', () => {
    const official = "${{ github.event_name == 'pull_request' && 'pnpm run build:artifacts --profile official' || 'pnpm run build:official' }}"
    const vendor = "${{ github.event_name == 'pull_request' && 'pnpm exec tsx scripts/compile-referenced-projects.ts host-libraries' || 'pnpm run build:lib:host' }}"
    for (const [file, jobName, expected] of [
      ['release.yml', 'pack', official],
      ['release-vendor.yml', 'pack', vendor],
      ['e2e.yml', 'e2e', official],
    ] as const) {
      const job = workflowJob(loadWorkflow('.github/workflows/' + file), jobName)
      if (!Array.isArray(job.steps)) throw new TypeError(`${jobName} must define steps`)
      const step = job.steps.filter(isRecord).find(candidate => typeof candidate.run === 'string'
        && (candidate.run.includes('build:artifacts') || candidate.run.includes('host-libraries')))
      expect(step?.run).toBe(expected)
      for (const event of ['pull_request', 'push', 'workflow_dispatch']) {
        const expression = expected.slice('${{ '.length, -' }}'.length)
        const selected: unknown = runInNewContext(expression, { github: { event_name: event } }, { timeout: 1000 })
        expect(selected).toBe(event === 'pull_request'
          ? file === 'release-vendor.yml'
            ? 'pnpm exec tsx scripts/compile-referenced-projects.ts host-libraries'
            : 'pnpm run build:artifacts --profile official'
          : file === 'release-vendor.yml' ? 'pnpm run build:lib:host' : 'pnpm run build:official')
      }
    }
  })

  it('selects PR artifact compilation inside the Python executable builder', () => {
    const job = workflowJob(loadWorkflow('.github/workflows/build-exe-for-python-sdk.yml'), 'build')
    if (!Array.isArray(job.steps)) throw new TypeError('Python runtime builder must define steps')
    const steps = job.steps.filter(isRecord)
    const execute = steps.find(step => step.name === 'Build single-exe')
    expect(steps.some(step => step.run === 'pnpm run build:artifacts')).toBe(false)
    expect(execute).toMatchObject({
      env: { STITCH_BUILD_CLIENT_PROFILE: 'official' },
    })
    if (typeof execute?.run !== 'string') throw new TypeError('Python executable builder must define a command')
    const expression = [...execute.run.matchAll(/\$\{\{ ([^{}]+) \}\}/g)]
      .map(match => match[1]).find(value => value?.startsWith('inputs.ci'))
    expect(expression).toBe("inputs.ci && github.event_name == 'pull_request' && '--build-artifacts' || ''")
    if (expression === undefined) throw new TypeError('Python executable builder must select its build mode')
    for (const ci of [false, true]) {
      for (const event of ['pull_request', 'push', 'workflow_dispatch']) {
        const context = { inputs: { ci }, github: { event_name: event } }
        const selected: unknown = runInNewContext(expression, context, { timeout: 1000 })
        expect(selected).toBe(ci && event === 'pull_request' ? '--build-artifacts' : '')
      }
    }
  })

  it.each(['e2e.yml', 'release.yml', 'release-vendor.yml'])(
    '%s cancels superseded validation runs without crossing workflow or ref boundaries', (name) => {
      const workflow = loadWorkflow('.github/workflows/' + name)
      expect(workflow.concurrency).toEqual({
        group: '${{ github.workflow }}-${{ github.ref }}',
        'cancel-in-progress': true,
      })
    },
  )

  it('cancels reusable CI builds without cancelling release-owned builds', () => {
    const workflow = loadWorkflow('.github/workflows/build-exe-for-python-sdk.yml')
    expect(workflow.concurrency).toEqual({
      group: 'build-single-exe-${{ github.workflow }}-${{ github.ref }}',
      'cancel-in-progress': '${{ !inputs.release }}',
    })
  })

  it('does not cancel release or deployment transactions', () => {
    for (const name of ['python-release.yml', 'docs-pages.yml']) {
      expect(loadWorkflow('.github/workflows/' + name).concurrency).toMatchObject({ 'cancel-in-progress': false })
    }
  })

  it('isolates the python SDK exe pnpm setup destination per job', () => {
    const workflow: unknown = yaml.load(readFileSync(resolve(root, '.github/workflows/build-exe-for-python-sdk.yml'), 'utf8'))
    if (!isRecord(workflow) || !isRecord(workflow.jobs)) throw new TypeError('build-exe-for-python-sdk.yml must define jobs')
    const setups: Array<{ step: unknown }> = []
    for (const job of Object.values(workflow.jobs)) {
      if (!isRecord(job) || !Array.isArray(job.steps)) continue
      for (const step of job.steps) {
        if (!isRecord(step) || typeof step.uses !== 'string' || !step.uses.startsWith('pnpm/action-setup@')) continue
        setups.push({ step })
      }
    }
    expect(setups.length).toBeGreaterThan(0)
    for (const { step } of setups) {
      expect(step).toMatchObject({
        with: { dest: nativeWindowsPnpmDestination },
      })
    }
  })

  it('runs the darwin unit parity inventory at the CI test budget', () => {
    const test = workflowJob(loadWorkflow('.github/workflows/ci.yml'), 'test')
    if (!isRecord(test.env) || typeof test.env.STITCH_COVERAGE_TEST_TIMEOUT_MS !== 'string') {
      throw new TypeError('the CI test job must grant STITCH_COVERAGE_TEST_TIMEOUT_MS')
    }
    const unitDarwin = workflowJob(loadWorkflow('.github/workflows/sandbox.yml'), 'unit-darwin')
    if (!Array.isArray(unitDarwin.steps)) throw new TypeError('unit-darwin job must define steps')
    const unit = unitDarwin.steps.filter(isRecord).find(step => step.name === 'Unit tests (darwin parity)')
    // The whole unit inventory on a shared hosted runner pays the same
    // scheduling delay on both platforms, so the two budgets cannot drift apart.
    expect(unit).toMatchObject({
      run: 'pnpm run check:ci:unit',
      env: { STITCH_COVERAGE_TEST_TIMEOUT_MS: test.env.STITCH_COVERAGE_TEST_TIMEOUT_MS },
    })
  })

  it('splits both Wine TypeScript faces and retains their aggregate heap budgets', () => {
    const wineGates = readFileSync(resolve(root, 'scripts/wine-windows-gates.sh'), 'utf8')

    const references = wineGates.indexOf(
      'wine_node "$scratch/logs/host-references.log" --import tsx/esm scripts/compile-referenced-projects.ts host',
    )
    const aggregate = wineGates.indexOf(
      'wine_node "$scratch/logs/host-tsc.log" --max-old-space-size=8192 "$tsc_js" -p tsconfig.host.json --pretty false',
    )
    const metadata = wineGates.indexOf('wine_node "$scratch/logs/host-typert.log" --import tsx/esm scripts/generate-typert.ts')
    expect(metadata).toBeGreaterThan(-1)
    expect(references).toBeGreaterThan(metadata)
    expect(aggregate).toBeGreaterThan(references)
    expect(wineGates).not.toContain('-b tsconfig.host.json')
    const clientReferences = wineGates.indexOf('wine_node "$scratch/logs/client-references.log" --import tsx/esm scripts/compile-referenced-projects.ts client')
    const clientAggregate = wineGates.indexOf('wine_node "$scratch/logs/client-tsc.log" --max-old-space-size=8192 "$tsc_js" -p tsconfig.client.json --pretty false')
    expect(clientReferences).toBeGreaterThan(aggregate)
    expect(clientAggregate).toBeGreaterThan(clientReferences)
    expect(wineGates).not.toContain('-b tsconfig.client.json')
    expect(wineGates).toContain('  "$scratch/logs/client-references.log" \\')
  })

  it('keeps supported LSP source under native Windows coverage', () => {
    const config = readFileSync(resolve(root, 'vitest.config.ts'), 'utf8')

    expect(config).not.toContain('packages/lsp/lsp-stdio/src/connection.ts')
    expect(config).not.toContain('packages/lsp/lsp-stdio/src/index.ts')
    expect(config).not.toContain('packages/lsp/lsp-stdio/src/instance.ts')
  })

  it('requires release-shaped Python runtime validation on Linux and Windows x64 in CI Python', () => {
    const workflow = loadWorkflow('.github/workflows/ci-python.yml')
    const pythonRuntime = workflowJob(workflow, 'python-runtime')
    const aggregate = workflowJob(workflow, 'python-checks-passed')
    if (!Array.isArray(aggregate.needs)) {
      throw new TypeError('CI Python aggregate must define required job dependencies')
    }

    expect(pythonRuntime).toMatchObject({
      if: "github.event_name == 'pull_request'",
      name: 'python runtime / release-shaped matrix',
      uses: './.github/workflows/build-exe-for-python-sdk.yml',
      with: { targets: 'node24-linux-x64,node24-win-x64', ci: true },
      secrets: {
        DEEPSEEK_API_KEY_EXTERNAL: '${{ secrets.DEEPSEEK_API_KEY_EXTERNAL }}',
      },
    })
    expect(aggregate.needs).toEqual(['python-sdk', 'python-runtime'])
    const ci = loadWorkflow('.github/workflows/ci.yml')
    if (!isRecord(ci.jobs)) throw new TypeError('ci.yml must define jobs')
    expect(ci.jobs).not.toHaveProperty('python-runtime')
  })

  it('builds SSH executables only for explicit manual or release requests', () => {
    for (const file of workflowFiles.filter(name => name !== 'publish-ssh-helper.yml')) {
      const workflow = loadWorkflow('.github/workflows/' + file)
      if (!isRecord(workflow.jobs)) continue
      expect(Object.values(workflow.jobs), file).not.toContainEqual(expect.objectContaining({ uses: './.github/workflows/build-exe-for-ssh-helper.yml' }))
    }
    const workflow = loadWorkflow('.github/workflows/build-exe-for-ssh-helper.yml')
    if (!isRecord(workflow.on)) throw new Error('SSH builder must define triggers')
    expect(Object.keys(workflow.on).sort()).toEqual(['workflow_call', 'workflow_dispatch'])
  })

  it('requires SSH helper acceptance before uploading artifacts or publishing', () => {
    const workflow = loadWorkflow('.github/workflows/build-exe-for-ssh-helper.yml')
    const build = workflowJob(workflow, 'build')
    if (!Array.isArray(build.steps)) throw new Error('SSH build must define its verification steps')
    const steps = build.steps.filter(isRecord)
    const artifact = steps.findIndex(step => String(step.run).includes('scripts/verify-ssh-helper-artifact.ts'))
    const transport = steps.findIndex(step => String(step.run).includes('scripts/verify-ssh-helper-ssh.ts'))
    const landlock = steps.findIndex(step => String(step.run).includes('--backend=landlock-run'))
    const upload = steps.findIndex(step => String(step.uses).startsWith('actions/upload-artifact@'))
    expect(artifact).toBeGreaterThan(-1)
    expect(landlock).toBeGreaterThan(artifact)
    expect(transport).toBeGreaterThan(artifact)
    expect(upload).toBeGreaterThan(transport)
    for (const index of [artifact, transport, landlock, upload]) expect(steps[index]).not.toHaveProperty('continue-on-error', true)
    const publish = loadWorkflow('.github/workflows/publish-ssh-helper.yml')
    expect(publish.permissions).toEqual({ contents: 'read' })
    expect(workflowJob(publish, 'build')).toMatchObject({ needs: 'validate', with: { release: true } })
    const verify = workflowJob(publish, 'verify')
    expect(verify.needs).toEqual(['validate', 'build'])
    expect(verify).not.toHaveProperty('if')
    expect(verify).not.toHaveProperty('permissions')
    if (!Array.isArray(verify.steps)) throw new Error('Release verification must define steps')
    const verification = verify.steps.findIndex(step => isRecord(step) && String(step.run).includes('scripts/ssh-helper/release.ts'))
    const checksums = verify.steps.findIndex(step => isRecord(step) && String(step.uses).startsWith('actions/upload-artifact@'))
    expect(verification).toBeGreaterThan(-1)
    expect(checksums).toBeGreaterThan(verification)
    expect(verify.steps[verification]).not.toHaveProperty('continue-on-error', true)
    const publication = workflowJob(publish, 'publish')
    expect(publication).toMatchObject({ if: 'inputs.publish', needs: ['validate', 'verify'], permissions: { contents: 'write' } })
    for (const requested of [false, true]) {
      expect(runInNewContext(String(publication.if), { inputs: { publish: requested } }, { timeout: 1000 })).toBe(requested)
    }
  })

  it('validates any ref by default but refuses publication without the matching SSH release tag', () => {
    const workflow = loadWorkflow('.github/workflows/publish-ssh-helper.yml')
    if (!isRecord(workflow.on)) throw new Error('SSH release must define triggers')
    expect(Object.keys(workflow.on)).toEqual(['workflow_dispatch'])
    expect(workflowEvent(workflow, 'workflow_dispatch').inputs).toMatchObject({ publish: { type: 'boolean', default: false } })
    const validate = workflowJob(workflow, 'validate')
    expect(validate.steps).toContainEqual(expect.objectContaining({ id: 'source', env: { PUBLISH: '${{ inputs.publish }}' } }))
    const source = nodeStepSource(validate, 'source')
    const evaluate = (publish: boolean, type: string, name: string): string => {
      let output = ''
      runInNewContext(source, {
        process: { env: { PUBLISH: String(publish), GITHUB_REF_TYPE: type, GITHUB_REF_NAME: name, GITHUB_OUTPUT: 'output' } },
        readFileSync: () => JSON.stringify({ version: '1.2.3' }),
        execFileSync: () => `${'a'.repeat(40)}\n`,
        appendFileSync: (_path: string, text: string) => { output += text },
      }, { timeout: 1000 })
      return output
    }
    const expected = `version=1.2.3\ncommit=${'a'.repeat(40)}\n`
    expect(evaluate(false, 'branch', 'worktree/helper')).toBe(expected)
    expect(evaluate(false, 'tag', 'arbitrary-tag')).toBe(expected)
    expect(evaluate(true, 'tag', 'stitch-v1.2.3')).toBe(expected)
    for (const [type, name] of [['branch', 'stitch-v1.2.3'], ['tag', 'stitch-v1.2.2'], ['tag', 'dsh-v1.2.3'], ['tag', 'python-v1.2.3']] as const) {
      expect(() => evaluate(true, type, name)).toThrow('Publication requires the matching stitch-v<version> tag')
    }
  })

  it('validates the SSH native matrix before allocating runners', () => {
    const plan = workflowJob(loadWorkflow('.github/workflows/build-exe-for-ssh-helper.yml'), 'plan')
    const source = nodeStepSource(plan, 'targets')
    const evaluate = (requested: string): unknown => {
      let output = ''
      runInNewContext(source, {
        process: { env: { REQUESTED_TARGETS: requested, GITHUB_OUTPUT: 'output' } },
        appendFileSync: (_path: string, text: string) => { output += text },
      }, { timeout: 1000 })
      return JSON.parse(output.slice('matrix='.length))
    }
    expect(evaluate('')).toHaveLength(4)
    expect(evaluate('node24-linux-arm64')).toEqual([{ target: 'node24-linux-arm64', runner: 'ubuntu-24.04-arm' }])
    for (const invalid of ['node24-linux-arm64,node24-linux-arm64', 'node24-win-x64', 'node24-linux-x64,', ' ']) {
      expect(() => evaluate(invalid)).toThrow('Invalid or duplicate')
    }
  })

  it('keeps every Vitest project process-isolated on native Windows', () => {
    const config = readFileSync(resolve(root, 'vitest.config.ts'), 'utf8')

    expect(config).not.toContain("pool: process.platform === 'win32' ? 'threads' : 'forks'")
    expect(config.match(/pool: 'forks'/g)).toHaveLength(2)
  })

  it('applies the lane test budget inside every Vitest project', () => {
    // Each inline project spreads coverageTestTimeoutOptions, the only route
    // for STITCH_COVERAGE_TEST_TIMEOUT_MS into projects; the behavior itself is
    // pinned by scripts/lane-test-budget.spec.ts.
    const config = readFileSync(resolve(root, 'vitest.config.ts'), 'utf8')

    expect(config).toContain('const laneTestBudget = coverageTestTimeoutOptions(process.env[COVERAGE_TEST_TIMEOUT_ENV])')
    expect(config.match(/^ {10}\.\.\.laneTestBudget,$/gm)).toHaveLength(2)
  })
})

describe('GitHub-hosted runners', () => {
  it.each(workflowFiles)('%s carries no self-hosted, larger-runner, third-party, or upstream-only references', (file) => {
    const text = readFileSync(resolve(workflowDirectory, file), 'utf8')
    expect(text).not.toMatch(/self-hosted|vm-backup|blacksmith|dsh-(?:ubuntu|windows|win|mac)-/u)
    expect(text).not.toMatch(/macos-15-(?:large|xlarge)|STITCH_CI_FAILOVER/u)
    expect(text).not.toMatch(/deepseek-harness-check|deepseek-harness\/deepseek-harness|create-github-app-token/u)
  })

  it.each(workflowFiles)('%s runs every job on a standard hosted label', (file) => {
    const workflow = loadWorkflow('.github/workflows/' + file)
    if (!isRecord(workflow.jobs)) throw new TypeError(`${file} must define jobs`)
    for (const [name, job] of Object.entries(workflow.jobs)) {
      if (!isRecord(job) || job.uses !== undefined) continue
      const runsOn = job['runs-on']
      if (typeof runsOn !== 'string') throw new TypeError(`${file} ${name} must select one runner label`)
      const matrixKey = /^\$\{\{ matrix\.([\w-]+) \}\}$/u.exec(runsOn)?.[1]
      if (matrixKey === undefined) {
        expect(hostedRunners, `${file} ${name}: ${runsOn}`).toContain(runsOn)
        continue
      }
      const matrix = isRecord(job.strategy) ? job.strategy.matrix : undefined
      // Matrices computed by a planning job are covered by the text check above.
      if (!isRecord(matrix) || typeof matrix.include === 'string') continue
      const rows = Array.isArray(matrix.include) ? matrix.include.filter(isRecord) : []
      const labels = [...rows.map(row => row[matrixKey]), ...Array.isArray(matrix[matrixKey]) ? matrix[matrixKey] as unknown[] : []]
      expect(labels.length, `${file} ${name} must list its runner labels`).toBeGreaterThan(0)
      for (const label of labels) expect(hostedRunners, `${file} ${name}: ${String(label)}`).toContain(label)
    }
  })

  it.each(workflowFiles)('%s pins every action to an exact release', (file) => {
    const workflow = loadWorkflow('.github/workflows/' + file)
    if (!isRecord(workflow.jobs)) throw new TypeError(`${file} must define jobs`)
    for (const job of Object.values(workflow.jobs)) {
      if (!isRecord(job) || !Array.isArray(job.steps)) continue
      for (const step of job.steps.filter(isRecord)) {
        if (typeof step.uses !== 'string' || step.uses.startsWith('./') || majorOnlyActions.has(step.uses)) continue
        expect(step.uses, file).toMatch(/^[\w.-]+\/[\w./-]+@v\d+\.\d+\.\d+$/u)
      }
    }
  })

  it('maps every native Python runtime target to a hosted runner in every mode', () => {
    const workflow = loadWorkflow('.github/workflows/build-exe-for-python-sdk.yml')
    const build = workflowJob(workflow, 'build')
    const plan = workflowJob(workflow, 'plan')
    expect(build['runs-on']).toBe('${{ matrix.runner }}')
    expect(plan['runs-on']).toBe('ubuntu-latest')
    expect(workflowJob(workflow, 'sdk-wheel')['runs-on']).toBe('ubuntu-latest')
    const planText = JSON.stringify(plan.steps)
    for (const [target, runner] of [
      ['node24-linux-x64', 'ubuntu-latest'],
      ['node24-linux-arm64', 'ubuntu-24.04-arm'],
      ['node24-macos-arm64', 'macos-latest'],
      ['node24-macos-x64', 'macos-15-intel'],
      ['node24-win-x64', 'windows-2025'],
    ] as const) {
      expect(hostedRunners).toContain(runner)
      expect(planText).toMatch(new RegExp(`${target}\\)\\s+runner=${runner} ;;`, 'u'))
    }
  })
})

describe('bubblewrap preparation script', () => {
  it('pins bubblewrap to a recorded Launchpad build and excludes Ubuntu pool downloads', () => {
    const script = readFileSync(resolve(root, 'scripts/prepare-ci-bubblewrap.sh'), 'utf8')
    const url = /^readonly BUBBLEWRAP_URL="([^"]+)"$/mu.exec(script)?.[1]

    expect(url).toMatch(
      /^https:\/\/launchpad\.net\/ubuntu\/\+source\/bubblewrap\/[^/]+\/\+build\/\d+\/\+files\/bubblewrap_[^/]+_amd64\.deb$/u,
    )
    // Ubuntu removes superseded versions from its live package pool.
    expect(script).not.toMatch(/https?:\/\/[^/'"\s]+\/ubuntu(?:-ports)?\/pool\//u)
  })

  it('verifies the archive against the pinned digest', () => {
    const script = readFileSync(resolve(root, 'scripts/prepare-ci-bubblewrap.sh'), 'utf8')

    expect(script).toMatch(/^readonly BUBBLEWRAP_SHA256='[0-9a-f]{64}'$/mu)
    expect(script).toContain('acquire_verified_archive "$BUBBLEWRAP_URL" "$BUBBLEWRAP_SHA256" "$archive"')
  })

  it.each(['ci.yml:test', 'e2e.yml:e2e'])('%s caches the verified archive around its preparation', (lane) => {
    const [name, jobName] = lane.split(':') as [string, string]
    const script = readFileSync(resolve(root, 'scripts/prepare-ci-bubblewrap.sh'), 'utf8')
    expect(script).toContain('readonly BUBBLEWRAP_CACHE_DIR="${HOME}/.cache/dsh-ci/bubblewrap"')
    const cache = {
      path: '~/.cache/dsh-ci/bubblewrap',
      key: "bubblewrap-${{ runner.os }}-${{ runner.arch }}-${{ hashFiles('scripts/prepare-ci-bubblewrap.sh') }}",
    }
    const job = workflowJob(loadWorkflow('.github/workflows/' + name), jobName)
    if (!Array.isArray(job.steps)) throw new TypeError(`${lane} must define steps`)
    const steps = job.steps.filter(isRecord)
    const preparation = steps.findIndex(step => step.run === 'bash scripts/prepare-ci-bubblewrap.sh')
    expect(preparation).toBeGreaterThan(0)
    expect(steps[preparation - 1]).toEqual({
      name: 'Restore verified bubblewrap archive',
      id: 'bubblewrap-cache',
      uses: 'actions/cache/restore@v6.1.0',
      with: cache,
    })
    expect(steps[preparation + 1]).toEqual({
      name: 'Save verified bubblewrap archive',
      if: "steps.bubblewrap-cache.outputs.cache-hit != 'true'",
      uses: 'actions/cache/save@v6.1.0',
      with: cache,
    })
  })
})

describe('DeepSeek e2e workflow', () => {
  it('prepares bubblewrap from the pinned payload without a package transaction', () => {
    const workflow = loadWorkflow('.github/workflows/e2e.yml')
    const e2e = workflowJob(workflow, 'e2e')
    if (!Array.isArray(e2e.steps)) throw new TypeError('DeepSeek e2e workflow must define steps')

    const steps = e2e.steps.filter(isRecord)
    expect(steps.find(step => step.name === 'Prepare bubblewrap (unrestrict userns)')).toMatchObject({
      run: 'bash scripts/prepare-ci-bubblewrap.sh',
    })
    expect(JSON.stringify(steps)).not.toContain('apt-get')
  })

  it('bounds profile subprocess fan-out to the tested e2e default', () => {
    const workflow = loadWorkflow('.github/workflows/e2e.yml')
    const e2e = workflowJob(workflow, 'e2e')
    if (!Array.isArray(e2e.steps)) throw new TypeError('DeepSeek e2e workflow must define steps')

    const step = e2e.steps.filter(isRecord).find(candidate => candidate.name === 'E2E tests (real DeepSeek API)')
    expect(step).toMatchObject({ env: { STITCH_E2E_MAX_WORKERS: 6 } })
  })

  it('runs the real-API suite only when its secret reaches the run', () => {
    const workflow = loadWorkflow('.github/workflows/e2e.yml')
    const key = workflowJob(workflow, 'key')
    const e2e = workflowJob(workflow, 'e2e')
    if (!Array.isArray(key.steps)) throw new TypeError('e2e key job must define steps')
    expect(e2e).toMatchObject({ needs: 'key', if: "needs.key.outputs.present == 'true'", 'runs-on': 'ubuntu-latest' })
    expect(key.outputs).toEqual({ present: '${{ steps.key.outputs.present }}' })
    const detect = key.steps.filter(isRecord).find(step => step.id === 'key')
    expect(detect).toMatchObject({ env: { DEEPSEEK_API_KEY: '${{ secrets.DEEPSEEK_API_KEY_EXTERNAL }}' } })
    if (process.platform === 'win32' || typeof detect?.run !== 'string') return
    for (const value of ['', 'secret']) {
      const outputs = runShellStep(detect.run, { DEEPSEEK_API_KEY: value })
      expect(outputs).toBe(`present=${value === '' ? 'false' : 'true'}\n`)
    }
  })
})

describe('Python release workflows', () => {
  it('builds and validates the complete wheel set without any publication path', () => {
    const workflow = loadWorkflow('.github/workflows/python-release.yml')
    const build = workflowJob(workflow, 'build')
    const pythonCompat = workflowJob(workflow, 'python-compat')
    const validate = workflowJob(workflow, 'validate')
    if (!isRecord(workflow.on) || !isRecord(workflow.jobs) || !Array.isArray(pythonCompat.steps) || !Array.isArray(validate.steps)) {
      throw new TypeError('Python release workflow must define triggers and release steps')
    }

    expect(workflow.on).toEqual({ workflow_dispatch: null })
    expect(workflow.permissions).toEqual({ contents: 'read' })
    expect(Object.keys(workflow.jobs).sort()).toEqual(['build', 'python-compat', 'validate'])
    expect(build).toMatchObject({
      uses: './.github/workflows/build-exe-for-python-sdk.yml',
      with: {
        targets: 'node24-linux-x64,node24-linux-arm64,node24-macos-arm64,node24-macos-x64,node24-win-x64',
        release: true,
      },
    })
    expect(pythonCompat.strategy).toMatchObject({ matrix: { python: ['3.10', '3.14'] } })
    const pythonCompatSteps = JSON.stringify(pythonCompat.steps)
    expect(pythonCompatSteps).toContain('dist/stitch_harness-$VERSION-py3-none-any.whl')
    expect(pythonCompatSteps).toContain('dist/stitch_harness_runtime_bin-$VERSION-py3-none-manylinux_2_28_x86_64.whl')
    expect(pythonCompatSteps).not.toContain('--find-links')
    const validateSteps = JSON.stringify(validate.steps)
    expect(validateSteps).toContain('100000000')
    expect(validate.steps.filter(isRecord).at(-1)).toMatchObject({
      uses: 'actions/upload-artifact@v7.0.1',
      with: { name: 'python-release-${{ steps.version.outputs.version }}', path: 'dist/*' },
    })
    const text = JSON.stringify(workflow)
    expect(text).not.toMatch(/pypi-publish|id-token|PYPI_PUBLISHER|PUBLIC_PYPI|environment|secrets\./u)
  })

  it('exposes the native wheel builder to the release caller with normalized versions', () => {
    const workflow = loadWorkflow('.github/workflows/build-exe-for-python-sdk.yml')
    expect(Object.keys(workflow.on as Record<string, unknown>).sort()).toEqual(['workflow_call', 'workflow_dispatch'])
    const call = workflowEvent(workflow, 'workflow_call')
    const plan = workflowJob(workflow, 'plan')
    const build = workflowJob(workflow, 'build')
    if (!isRecord(call.inputs) || !isRecord(call.secrets) || !Array.isArray(plan.steps) || !Array.isArray(build.steps)) {
      throw new TypeError('Python wheel builder must define workflow_call inputs and plan steps')
    }

    const buildSteps: unknown[] = build.steps
    const manylinuxAddon = buildSteps.find(step => isRecord(step) && step.name === 'Rebuild Linux node-pty against manylinux 2.28')
    const macosCheck = buildSteps.find(step => isRecord(step) && step.name === 'Check macOS payload architecture and deployment target')
    const manylinuxSmoke = buildSteps.find(step => isRecord(step) && step.name === 'Run wheel in a manylinux 2.28 container')
    const cleanVenvPosix = buildSteps.find(step => isRecord(step) && step.name === 'Install local SDK and runtime wheels into a clean venv (POSIX)')
    const cleanVenvWindows = buildSteps.find(step => isRecord(step) && step.name === 'Install local SDK and runtime wheels into a clean venv (Windows)')
    const installedKeylessPosix = buildSteps.find(step => isRecord(step) && step.name === 'Run installed-wheel keyless black-box tests (POSIX)')
    const installedKeylessWindows = buildSteps.find(step => isRecord(step) && step.name === 'Run installed-wheel keyless black-box tests (Windows)')
    const realApiPreflightPosix = buildSteps.find(step => isRecord(step) && step.name === 'Preflight installed-wheel real API test (POSIX)')
    const realApiPreflightWindows = buildSteps.find(step => isRecord(step) && step.name === 'Preflight installed-wheel real API test (Windows)')
    const installedRealApiPosix = buildSteps.find(step => isRecord(step) && step.name === 'Run installed-wheel real API black-box test (POSIX)')
    const installedRealApiWindows = buildSteps.find(step => isRecord(step) && step.name === 'Run installed-wheel real API black-box test (Windows)')
    if (!isRecord(macosCheck) || typeof macosCheck.run !== 'string'
      || !isRecord(cleanVenvPosix) || !isRecord(cleanVenvWindows)
      || !isRecord(installedKeylessPosix) || !isRecord(installedKeylessWindows)
      || !isRecord(realApiPreflightPosix) || !isRecord(realApiPreflightWindows)
      || !isRecord(installedRealApiPosix) || !isRecord(installedRealApiWindows)) {
      throw new TypeError('Python wheel builder must define native POSIX and Windows installed-wheel steps')
    }
    expect(call.inputs).toHaveProperty('targets')
    expect(call.inputs).toMatchObject({
      ci: { type: 'boolean', default: false },
      release: { type: 'boolean', default: false },
    })
    expect(call.secrets).toMatchObject({
      DEEPSEEK_API_KEY_EXTERNAL: { required: false },
    })
    expect(workflow.concurrency).toMatchObject({
      group: 'build-single-exe-${{ github.workflow }}-${{ github.ref }}',
    })
    expect(build.defaults).toBeUndefined()
    expect(plan.if).toContain('inputs.ci')
    expect(plan.if).toContain('inputs.release')
    expect(JSON.stringify(plan.steps)).toContain('pep440_version')
    const workflowJson = JSON.stringify(workflow)
    expect(workflowJson).toContain('macosx_14_0_arm64')
    expect(workflowJson).toContain('macosx_14_0_x86_64')
    expect(workflowJson).toContain('node24-macos-x64')
    expect(workflowJson).toContain('macos-15-intel')
    expect(workflowJson).toContain('win_amd64')
    expect(workflowJson).toContain('node24-win-x64')
    expect(workflowJson).toContain('windows-2025')
    expect(workflowJson).toContain('dist-python/$SDK_WHEEL')
    expect(workflowJson).toContain('dist-python/$RUNTIME_WHEEL')
    expect(workflowJson).toContain('/work/dist-python/$SDK_WHEEL')
    expect(workflowJson).toContain('/work/dist-python/$RUNTIME_WHEEL')
    expect(workflowJson).not.toContain('--find-links dist-python')
    expect(workflowJson).not.toContain('--find-links /work/dist-python')
    expect(workflowJson).not.toContain('cygpath')
    expect(manylinuxAddon).toMatchObject({ if: "runner.os == 'Linux'" })
    expect(JSON.stringify(manylinuxAddon)).toContain('manylinux_2_28_x86_64')
    expect(JSON.stringify(manylinuxAddon)).toContain('manylinux_2_28_aarch64')
    expect(JSON.stringify(manylinuxAddon)).toContain('npm_config_build_from_source=true pnpm --config.verifyDepsBeforeRun=false run install')
    expect(JSON.stringify(manylinuxAddon)).toContain('pnpm_setup_root')
    expect(JSON.stringify(manylinuxAddon)).toContain('$pnpm_setup_root:$pnpm_setup_root:ro')
    expect(JSON.stringify(manylinuxAddon)).toContain('node-pty-glibc-versions.txt')
    expect(JSON.stringify(manylinuxAddon)).toContain('le 2.28')
    expect(macosCheck).toMatchObject({ if: "runner.os == 'macOS'" })
    expect(macosCheck.run).toContain('scripts/check-macos-deployment-target.py')
    expect(macosCheck.run).toContain('lipo "$payload" -verify_arch')
    expect(macosCheck.run).toContain('$EXE-rg')
    expect(macosCheck.run).toContain('$EXE-spawn-helper')
    expect(JSON.stringify(installedKeylessPosix)).toContain('--scenario all')
    expect(JSON.stringify(installedKeylessPosix)).toContain('env -u PYTHONPATH')
    expect(JSON.stringify(installedKeylessWindows)).toContain('--scenario all --installed-wheel')
    expect(installedKeylessWindows).toMatchObject({ if: "runner.os == 'Windows'", shell: 'pwsh' })
    expect(cleanVenvWindows).toMatchObject({ if: "runner.os == 'Windows'", shell: 'pwsh' })
    expect(JSON.stringify(cleanVenvWindows)).toContain('Scripts\\\\python.exe')
    expect(realApiPreflightPosix).toMatchObject({
      env: { DEEPSEEK_API_KEY: '${{ secrets.DEEPSEEK_API_KEY_EXTERNAL }}' },
    })
    expect(String(realApiPreflightPosix.if)).toContain('inputs.ci')
    expect(String(realApiPreflightPosix.if)).toContain('head.repo.fork')
    expect(String(realApiPreflightPosix.if)).toContain('dependabot[bot]')
    expect(realApiPreflightWindows).toMatchObject({ shell: 'pwsh' })
    for (const step of [installedRealApiPosix, installedRealApiWindows]) {
      expect(step).toMatchObject({
        env: {
          DEEPSEEK_API_KEY: '${{ secrets.DEEPSEEK_API_KEY_EXTERNAL }}',
          DEEPSEEK_BASE_URL: 'https://api.deepseek.com/anthropic',
        },
      })
    }
    expect(JSON.stringify(installedRealApiPosix)).toContain('--scenario sdk-live')
    expect(JSON.stringify(installedRealApiPosix)).toContain('-u STITCH_RUNTIME_MODE')
    expect(installedRealApiWindows).toMatchObject({ shell: 'pwsh' })
    expect(JSON.stringify(installedRealApiWindows)).toContain('--scenario sdk-live --installed-wheel')
    expect(manylinuxSmoke).toMatchObject({ if: "runner.os == 'Linux'" })
  })

  it.each([
    ['POSIX', 'posix', "runner.os != 'Windows'"],
    ['Windows', 'windows', "runner.os == 'Windows'"],
  ])('runs native command regressions through the installed %s wheels', (platform, suffix, condition) => {
    const build = workflowJob(loadWorkflow('.github/workflows/build-exe-for-python-sdk.yml'), 'build')
    if (!Array.isArray(build.steps)) throw new TypeError('Python wheel builder must define steps')
    const steps = build.steps.filter(isRecord)
    const installIndex = steps.findIndex(step => step.id === `smoke-venv-${suffix}`)
    const testIndex = steps.findIndex(step => step.name === `Run installed-wheel native command tests (${platform})`)
    expect(installIndex).toBeGreaterThanOrEqual(0)
    expect(testIndex).toBeGreaterThan(installIndex)
    const install = steps[installIndex]
    const test = steps[testIndex]
    expect(install?.run).toContain('pytest>=8.0')
    expect(test).toMatchObject({ if: condition })
    expect(test).not.toHaveProperty('continue-on-error')
    expect(test?.run).toContain(`"\${{ steps.smoke-venv-${suffix}.outputs.python }}" -I`)
    expect(test?.run).toContain('run_installed_commands.py')
    if (platform === 'Windows') {
      expect(test).toHaveProperty('shell', 'pwsh')
      expect(test?.run).toContain('if ($LASTEXITCODE -ne 0) { throw')
    }
  })

  it('uses the shared macOS deployment-target check in GitLab', () => {
    const workflow = loadWorkflow('.gitlab-ci.yml')
    const runtimeWheel = workflow['.runtime-wheel']
    if (!isRecord(runtimeWheel) || !Array.isArray(runtimeWheel.script)) {
      throw new TypeError('GitLab CI must define the runtime wheel script')
    }
    const runtimeScript: unknown[] = runtimeWheel.script
    const macosCheck = runtimeScript.find(
      step => typeof step === 'string' && step.includes('${PLATFORM#macos-}'),
    )
    if (typeof macosCheck !== 'string') {
      throw new TypeError('GitLab CI must check the macOS deployment target')
    }

    expect(macosCheck).toContain('scripts/check-macos-deployment-target.py')
    expect(macosCheck).toContain('lipo "$payload" -verify_arch')
    expect(macosCheck).toContain('"$EXE" "$EXE-rg" "$EXE-spawn-helper"')
  })

  it('builds the macOS x64 wheel on the matching GitLab runner', () => {
    const workflow = loadWorkflow('.gitlab-ci.yml')
    const macosX64 = workflow['runtime-macos-x64']
    const publish = workflow['publish-python']
    if (!isRecord(macosX64) || !isRecord(publish) || !Array.isArray(publish.needs)) {
      throw new TypeError('GitLab CI must define the macOS x64 runtime and publication jobs')
    }

    expect(macosX64.tags).toEqual(['macos-x64'])
    expect(macosX64.variables).toMatchObject({ PKG_TARGET: 'node24-macos-x64', PLATFORM: 'macos-x64' })
    expect(publish.needs).toContainEqual({ job: 'runtime-macos-x64', artifacts: true })
    expect(JSON.stringify(publish.script)).toContain('macosx_14_0_x86_64.whl')
  })

  it('builds and black-box tests the Windows x64 wheel in GitLab', () => {
    const workflow = loadWorkflow('.gitlab-ci.yml')
    const windows = workflow['runtime-windows-x64']
    const publish = workflow['publish-python']
    if (!isRecord(windows) || !Array.isArray(windows.before_script) || !Array.isArray(windows.script)
      || !isRecord(publish) || !Array.isArray(publish.needs)) {
      throw new TypeError('GitLab CI must define the Windows runtime and aggregate publication jobs')
    }

    expect(windows.tags).toEqual(['windows-x64'])
    expect(windows.variables).toMatchObject({ PKG_TARGET: 'node24-win-x64', PLATFORM: 'win-x64' })
    expect(JSON.stringify(windows.before_script)).toContain('.ci-python\\\\Scripts')
    expect(JSON.stringify(windows.before_script)).toContain('[IO.Path]::PathSeparator')
    expect(JSON.stringify(windows.script)).toContain('win_amd64.whl')
    expect(JSON.stringify(windows.script)).toContain('--scenario all --installed-wheel')
    expect(publish.needs).toContainEqual({ job: 'runtime-windows-x64', artifacts: true })
  })
})

describe('npm release rehearsals', () => {
  it('keeps pack and dependency verification in the PR release workflows on hosted Linux', () => {
    for (const file of ['release.yml', 'release-vendor.yml']) {
      const workflow = loadWorkflow(`.github/workflows/${file}`)
      if (!isRecord(workflow.jobs) || !isRecord(workflow.on)) throw new TypeError(`${file} must define on and jobs`)
      expect(Object.keys(workflow.on).sort()).toEqual(['pull_request', 'push', 'workflow_dispatch'])
      expect(Object.keys(workflow.jobs).sort()).toEqual(file === 'release.yml' ? ['dependencies', 'pack'] : ['pack'])
      for (const job of Object.values(workflow.jobs)) expect(job).toMatchObject({ 'runs-on': 'ubuntu-24.04' })
      expect(JSON.stringify(workflow)).not.toContain('secrets.')
    }
  })

  it('runs dependency policy and npm layout checks in the Stitch release workflow', () => {
    const dependencies = workflowJob(loadWorkflow('.github/workflows/release.yml'), 'dependencies')
    if (!Array.isArray(dependencies.steps)) throw new TypeError('Stitch release workflow must define dependency steps')
    const commands = dependencies.steps.flatMap(step =>
      isRecord(step) && typeof step.run === 'string' ? [step.run] : [])
    // Both verifications run from one step so the lane pays their longer half.
    const combined = commands.find(command => command.includes('verify-package-dependencies'))
    expect(combined).toContain('verify-npm-install-layout')
    expect(combined).toContain('wait "$dependencies_pid"')
    expect(commands).not.toContain('pnpm run verify-package-dependencies')
    expect(commands).not.toContain('pnpm run verify-npm-install-layout')
  })
})

describe('Documentation site publication', () => {
  it('keeps Pages deployment dispatch-only from the matching stitch-v tag', () => {
    const workflow = loadWorkflow('.github/workflows/docs-pages.yml')
    const build = workflowJob(workflow, 'build')
    const deploy = workflowJob(workflow, 'deploy')
    if (!isRecord(workflow.on) || !isRecord(workflow.env) || !Array.isArray(build.steps)) {
      throw new TypeError('Documentation deployment must define on, env, and build steps')
    }

    // The site presents a released snapshot: a merge must never publish it, and
    // publication must never appear as a PR check.
    expect(Object.keys(workflow.on)).toEqual(['workflow_dispatch'])
    expect(build['runs-on']).toBe('ubuntu-24.04')
    const steps = build.steps.filter(isRecord)
    const verify = steps.find(step => step.name === 'Verify release tag')
    const verifyScript = verify?.run
    if (typeof verifyScript !== 'string') throw new TypeError('Documentation deployment must verify its release tag')
    expect(workflow.env.DOCS_REPOSITORY_REF).toBe('master')
    expect(deploy.environment).toMatchObject({ name: 'github-pages' })
    if (process.platform === 'win32') return

    const { version } = JSON.parse(readFileSync(resolve(root, 'package.json'), 'utf8')) as { version: string }
    const verdict = (type: string, name: string): number | null =>
      spawnSync('bash', ['-c', verifyScript], { cwd: root, env: { ...process.env, GITHUB_REF_TYPE: type, GITHUB_REF_NAME: name }, encoding: 'utf8' }).status
    expect(verdict('tag', `stitch-v${version}`)).toBe(0)
    for (const [type, name] of [['branch', `stitch-v${version}`], ['tag', `dsh-v${version}`], ['tag', 'stitch-v0.0.0'], ['branch', 'master']] as const) {
      expect(verdict(type, name), `${type} ${name}`).not.toBe(0)
    }
  })
})

describe('Git hooks', () => {
  it('leaves frozen Agent Note sidecars to the archive verifier', () => {
    const lefthook = loadWorkflow('lefthook.yml')

    for (const hookName of ['pre-commit', 'pre-merge-commit']) {
      const hook = lefthook[hookName]
      if (!isRecord(hook) || !Array.isArray(hook.jobs)) {
        throw new TypeError(`lefthook must define ${hookName} jobs`)
      }
      const pairing: unknown = hook.jobs.find(
        (job: unknown) => isRecord(job) && job.name === 'translation pairing (staged records)',
      )

      expect(pairing).toMatchObject({ exclude: ['.agents/notes/archived/**'] })
    }
  })
})

function loadWorkflow(path: string): Record<string, unknown> {
  const workflow: unknown = yaml.load(readFileSync(resolve(root, path), 'utf8'))
  if (!isRecord(workflow)) throw new TypeError(`${path} must define a workflow`)
  return workflow
}

function nodeStepSource(job: Record<string, unknown>, id: string): string {
  if (!Array.isArray(job.steps)) throw new Error('Node workflow job must define steps')
  const step: unknown = job.steps.find(value => isRecord(value) && value.id === id)
  if (!isRecord(step) || typeof step.run !== 'string') throw new Error(`Missing Node workflow step: ${id}`)
  const source = step.run.split("<<'JS'\n")[1]?.split('\nJS')[0]?.replace(/^import .*;\n/gm, '')
  if (source === undefined) throw new Error(`Workflow step ${id} must contain an executable Node script`)
  return source
}

function workflowEvent(workflow: Record<string, unknown>, event: string): Record<string, unknown> {
  if (!isRecord(workflow.on) || !isRecord(workflow.on[event])) {
    throw new TypeError(`workflow must define the ${event} event`)
  }
  return workflow.on[event]
}

function workflowJob(workflow: Record<string, unknown>, job: string): Record<string, unknown> {
  if (!isRecord(workflow.jobs) || !isRecord(workflow.jobs[job])) {
    throw new TypeError(`workflow must define the ${job} job`)
  }
  return workflow.jobs[job]
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

// These boolean/string cases share Actions and JavaScript semantics. GitHub
// supplies status functions; this probe is not a general Actions interpreter.
function evaluateCondition(expression: string, cancelled: boolean, results: string[], event: string): boolean {
  const source = expression.trim().replace(/^[$][{][{]|[}][}]$/g, '')
    .replaceAll('needs.*.result', 'results')
  return runInNewContext(source, {
    cancelled: () => cancelled,
    always: () => true,
    contains: (values: string[], value: string) => values.includes(value),
    results,
    github: { event_name: event },
  }, { timeout: 1000 }) as boolean
}

function runShellStep(run: string, env: Record<string, string>): string {
  const output = join(mkdtempSync(join(tmpdir(), 'ci-workflow-step-')), 'output')
  try {
    const result = spawnSync('bash', ['-c', run], { env: { ...process.env, ...env, GITHUB_OUTPUT: output }, encoding: 'utf8' })
    expect(result.status, result.stderr).toBe(0)
    return readFileSync(output, 'utf8')
  } finally {
    rmSync(dirname(output), { recursive: true, force: true })
  }
}
