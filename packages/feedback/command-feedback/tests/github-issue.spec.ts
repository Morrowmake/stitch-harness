/**
 * GitHub issue reporting: the preview names only the remark, category,
 * version, and OS; a confirmed issue is created through an authenticated `gh`
 * and otherwise falls back to a prefilled new-issue page that stays under the
 * URL bound; the Remote runs `gh` through a mounted subprocess seam.
 */
import { describe, expect, it, vi } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import SessionStore from '@deepseek-ai/dsh-session'
import CommandRuntime from '@deepseek-ai/dsh-commands'
import { SessionFeedbackService } from '@deepseek-ai/dsh-command-feedback'
import {
  DEFAULT_ISSUE_TITLE,
  FEEDBACK_REPOSITORY,
  ISSUE_TRUNCATION_NOTE,
  MAX_ISSUE_URL_LENGTH,
  draftFeedbackIssue,
  newIssueUrl,
  reportFeedbackIssue,
  type FeedbackProcessRunner,
  type FeedbackSubprocessSeam,
} from '../src/github-issue.ts'

const ENV = { version: '1.2.3', platform: 'Darwin 25.6.0 (darwin-arm64)' }
const ISSUE = { title: 'Diff view unreadable', body: 'The diff view is unreadable.' }
const CREATED = `https://github.com/${FEEDBACK_REPOSITORY}/issues/42`

/** Decode the title and body a prefilled page carries. */
function prefilled(url: string): { title: string | null; body: string | null } {
  const parsed = new URL(url)
  expect(`${parsed.origin}${parsed.pathname}`).toBe(`https://github.com/${FEEDBACK_REPOSITORY}/issues/new`)
  return { title: parsed.searchParams.get('title'), body: parsed.searchParams.get('body') }
}

describe('draftFeedbackIssue', () => {
  it('titles the issue with the first line and carries only the remark, category, version, and OS', () => {
    const draft = draftFeedbackIssue({ text: '  \nDiff view unreadable\nsecond line ', category: 'product-interaction' }, ENV)

    expect(draft).toEqual({
      title: 'Diff view unreadable',
      body: [
        'Diff view unreadable\nsecond line',
        '',
        '---',
        '- Category: product-interaction',
        '- Stitch version: 1.2.3',
        '- OS: Darwin 25.6.0 (darwin-arm64)',
      ].join('\n'),
    })
  })

  it('uses a generic title and placeholder for an empty remark', () => {
    const draft = draftFeedbackIssue({}, ENV)

    expect(draft.title).toBe(DEFAULT_ISSUE_TITLE)
    expect(draft.body).toContain('_No description provided._')
    expect(draft.body).toContain('- Category: none')
  })

  it('clips a long first line', () => {
    const draft = draftFeedbackIssue({ text: 'x'.repeat(200) }, ENV)

    expect(Array.from(draft.title)).toHaveLength(80)
    expect(draft.title.endsWith('…')).toBe(true)
  })
})

describe('newIssueUrl', () => {
  it('prefills the title and body verbatim when they fit', () => {
    expect(prefilled(newIssueUrl(ISSUE))).toEqual(ISSUE)
  })

  it('shortens an oversized body, says so, and stays under the bound', () => {
    const body = `${'é 漢字 '.repeat(3000)}TAIL`
    const url = newIssueUrl({ title: 'Long', body })

    expect(url.length).toBeLessThanOrEqual(MAX_ISSUE_URL_LENGTH)
    const carried = prefilled(url)
    expect(carried.title).toBe('Long')
    expect(carried.body?.endsWith(ISSUE_TRUNCATION_NOTE)).toBe(true)
    expect(body.startsWith(carried.body!.slice(0, -ISSUE_TRUNCATION_NOTE.length))).toBe(true)
    expect(carried.body!.length).toBeGreaterThan(1000)
  })

  it('replaces a blank title', () => {
    expect(prefilled(newIssueUrl({ title: '  ', body: 'b' })).title).toBe(DEFAULT_ISSUE_TITLE)
  })
})

/** A `gh` stand-in answering `auth status` and `issue create` in turn. */
function gh(
  auth: () => Promise<{ exitCode: number | null; stdout: string }>,
  create: () => Promise<{ exitCode: number | null; stdout: string }> = () => Promise.resolve({ exitCode: 0, stdout: `${CREATED}\n` }),
) {
  return vi.fn<FeedbackProcessRunner>((_file, args) => args[0] === 'auth' ? auth() : create())
}

describe('reportFeedbackIssue', () => {
  it('creates the issue through an authenticated gh with an argv array', async () => {
    const run = gh(() => Promise.resolve({ exitCode: 0, stdout: '' }))

    await expect(reportFeedbackIssue(ISSUE, run)).resolves.toEqual({ kind: 'created', url: CREATED })
    expect(run.mock.calls.map(([file, args]) => [file, args])).toEqual([
      ['gh', ['auth', 'status', '--hostname', 'github.com']],
      ['gh', ['issue', 'create', '--repo', FEEDBACK_REPOSITORY, '--title', ISSUE.title, '--body', ISSUE.body]],
    ])
    for (const [, , options] of run.mock.calls) expect(options.timeoutMs).toBeGreaterThan(0)
  })

  it('falls back to the prefilled page when gh is unauthenticated, without creating anything', async () => {
    const run = gh(() => Promise.resolve({ exitCode: 1, stdout: '' }))

    const result = await reportFeedbackIssue(ISSUE, run)

    expect(result.kind).toBe('browser')
    expect(prefilled(result.url)).toEqual(ISSUE)
    expect(run).toHaveBeenCalledTimes(1)
  })

  it('falls back to the prefilled page when gh is missing', async () => {
    const run = gh(() => Promise.reject(Object.assign(new Error('spawn gh ENOENT'), { code: 'ENOENT' })))

    await expect(reportFeedbackIssue(ISSUE, run)).resolves.toMatchObject({ kind: 'browser' })
  })

  it('falls back to the prefilled page when gh times out', async () => {
    const authTimeout = gh(() => Promise.resolve({ exitCode: null, stdout: '' }))
    const createTimeout = gh(() => Promise.resolve({ exitCode: 0, stdout: '' }), () => Promise.resolve({ exitCode: null, stdout: '' }))

    await expect(reportFeedbackIssue(ISSUE, authTimeout)).resolves.toMatchObject({ kind: 'browser' })
    await expect(reportFeedbackIssue(ISSUE, createTimeout)).resolves.toMatchObject({ kind: 'browser' })
  })

  it('falls back when issue creation fails or prints no issue URL', async () => {
    const failed = gh(() => Promise.resolve({ exitCode: 0, stdout: '' }), () => Promise.resolve({ exitCode: 1, stdout: '' }))
    const silent = gh(() => Promise.resolve({ exitCode: 0, stdout: '' }), () => Promise.resolve({ exitCode: 0, stdout: 'done' }))

    await expect(reportFeedbackIssue(ISSUE, failed)).resolves.toMatchObject({ kind: 'browser' })
    await expect(reportFeedbackIssue(ISSUE, silent)).resolves.toMatchObject({ kind: 'browser' })
  })
})

describe('sessionFeedback issue Remote', () => {
  async function service(subprocess?: FeedbackSubprocessSeam): Promise<SessionFeedbackService> {
    const ctx = new Context()
    await ctx.plugin(CommandRuntime)
    await ctx.plugin(SessionStore)
    if (subprocess !== undefined) ctx.provide('subprocess', subprocess)
    await ctx.plugin(SessionFeedbackService)
    return ctx.get('sessionFeedback')!
  }

  it('drafts from the remark and the installation facts', async () => {
    const remote = await service()

    const draft = await remote.draftIssue({ text: 'slow', category: 'service-stability' })

    expect(draft.title).toBe('slow')
    expect(draft.body).toMatch(/^slow\n\n---\n- Category: service-stability\n- Stitch version: \S+\n- OS: .+$/u)
  })

  it('runs gh through the mounted subprocess seam without a shell', async () => {
    const spawn = vi.fn<FeedbackSubprocessSeam['spawn']>(spec => ({
      collected: { stdout: { readFrom: () => ({ text: spec.argv[1] === 'issue' ? CREATED : '' }) } },
      done: Promise.resolve({ exitCode: 0 }),
    }))
    const remote = await service({ spawn })

    await expect(remote.reportIssue(ISSUE)).resolves.toEqual({ kind: 'created', url: CREATED })
    expect(spawn.mock.calls.map(([spec]) => spec.argv[0])).toEqual(['gh', 'gh'])
    expect(spawn.mock.calls[1]?.[0].argv).toContain(ISSUE.body)
    expect(spawn.mock.calls[0]?.[0].signal).toBeInstanceOf(AbortSignal)
  })

  it('answers with the prefilled page when the seam cannot start gh', async () => {
    const spawn = vi.fn<FeedbackSubprocessSeam['spawn']>(() => ({
      collected: {},
      done: Promise.reject(new Error('executable not found: gh')),
    }))
    const remote = await service({ spawn })

    await expect(remote.reportIssue(ISSUE)).resolves.toMatchObject({ kind: 'browser' })
  })
})
