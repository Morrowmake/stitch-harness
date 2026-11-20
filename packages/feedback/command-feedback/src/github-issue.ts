/**
 * GitHub issue reporting for Session feedback: the editable preview a human
 * reviews, the prefilled new-issue page, and — only when the human explicitly
 * chooses it — the `gh issue create` attempt that falls back to that page.
 * The preview carries only the remark, its category, the Stitch version, and
 * the operating system; nothing here reads Session content.
 * @module @deepseek-ai/dsh-command-feedback/github-issue
 */

import { execFile } from 'node:child_process'
import { readFileSync } from 'node:fs'
import os from 'node:os'
import { fileURLToPath } from 'node:url'
import { REPOSITORY } from '@deepseek-ai/dsh-product'
import type {
  FeedbackCategory, SessionFeedbackIssue, SessionFeedbackIssueDraft, SessionFeedbackReportIssueRequest,
  SessionFeedbackReportIssueResult,
} from './types.ts'

/** The `owner/name` GitHub repository feedback issues are filed against. */
export const FEEDBACK_REPOSITORY = REPOSITORY

/** Upper bound on the length of a prefilled new-issue URL; browsers and GitHub reject much longer ones. */
export const MAX_ISSUE_URL_LENGTH = 7000

/** Title used when the human leaves the title blank or the remark has no text. */
export const DEFAULT_ISSUE_TITLE = 'Stitch feedback'

/** Body line standing in for a remark without text. */
export const NO_DESCRIPTION = 'No description provided.'

/** Line appended to a body cut down to fit the prefilled URL. */
export const ISSUE_TRUNCATION_NOTE = '\n\n(Stitch shortened this report to fit a browser link; add anything missing before submitting.)'

const TITLE_LENGTH = 80
const MAX_TITLE_LENGTH = 256
const AUTH_TIMEOUT_MS = 10_000
const CREATE_TIMEOUT_MS = 30_000
const OUTPUT_BYTES = 64 * 1024
const ISSUE_URL = /https:\/\/github\.com\/[^\s/]+\/[^\s/]+\/issues\/\d+/u

/** Exit facts and output of one finished `gh` run. */
export interface FeedbackProcessResult {
  /** Exit code; null when the process was killed, for example by its timeout. */
  readonly exitCode: number | null
  /** Collected standard output. */
  readonly stdout: string
}

/**
 * Run one executable with an argv array and no shell. Rejects when the
 * program cannot be started (for example, it is not installed); resolves with
 * a non-zero or null exit code when it fails or exceeds its timeout.
 */
export type FeedbackProcessRunner = (
  file: string,
  args: readonly string[],
  options: { readonly timeoutMs: number },
) => Promise<FeedbackProcessResult>

/** Facts about this installation that a preview names. */
export interface FeedbackEnvironment {
  /** Stitch version. */
  readonly version: string
  /** Operating system and architecture. */
  readonly platform: string
}

/** The `subprocess` seam members this module uses; see `@deepseek-ai/dsh-subprocess`. */
export interface FeedbackSubprocessSeam {
  spawn(spec: {
    argv: readonly string[]
    cwd: string
    stdio: { stdin: 'ignore'; stdout: { maxBytes: number }; stderr: { maxBytes: number } }
    graceMs: number
    signal?: AbortSignal
    env?: NodeJS.ProcessEnv
  }): {
    readonly collected: { readonly stdout?: { readFrom(fromByte: number): { text: string } } }
    readonly done: Promise<{ exitCode: number | null }>
  }
}

/** Credentials and configuration `gh` reads from the environment, forwarded past a scrubbed child environment. */
function ghEnvironment(): Record<string, string> {
  const env: Record<string, string> = { GH_PROMPT_DISABLED: '1', NO_COLOR: '1' }
  for (const key of ['GH_TOKEN', 'GITHUB_TOKEN', 'GH_CONFIG_DIR', 'GH_HOST']) {
    const value = process.env[key]
    if (value !== undefined) env[key] = value
  }
  return env
}

/**
 * Run a program through Node's `child_process.execFile`: argv array, no shell, bounded by a timeout.
 * @param file - program name resolved through PATH.
 * @param args - arguments passed verbatim.
 * @param options - the run's deadline.
 * @returns exit code and stdout; rejects when the program cannot start.
 */
export const execFileRunner: FeedbackProcessRunner = (file, args, options) => {
  const { timeoutMs } = options
  const { promise, resolve, reject } = Promise.withResolvers<FeedbackProcessResult>()
  execFile(file, [...args], {
    timeout: timeoutMs,
    windowsHide: true,
    maxBuffer: OUTPUT_BYTES,
    env: { ...process.env, ...ghEnvironment() },
  }, (error, stdout) => {
    if (error === null) {
      resolve({ exitCode: 0, stdout })
      return
    }
    // A string code on a child that was not killed is a start failure (ENOENT, EACCES, …).
    if (typeof error.code === 'string' && error.killed !== true) {
      reject(error)
      return
    }
    resolve({ exitCode: typeof error.code === 'number' ? error.code : null, stdout })
  })
  return promise
}

/**
 * Adapt the Host `subprocess` seam to a process runner; the deadline aborts the managed process.
 * @param subprocess - the mounted subprocess provider.
 * @returns a runner that rejects when the program cannot start.
 */
export function subprocessRunner(subprocess: FeedbackSubprocessSeam): FeedbackProcessRunner {
  return async (file, args, { timeoutMs }) => {
    const signal = AbortSignal.timeout(timeoutMs)
    const handle = subprocess.spawn({
      argv: [file, ...args],
      cwd: os.homedir(),
      stdio: { stdin: 'ignore', stdout: { maxBytes: OUTPUT_BYTES }, stderr: { maxBytes: OUTPUT_BYTES } },
      graceMs: 1000,
      signal,
      env: ghEnvironment(),
    })
    const outcome = await handle.done
    return {
      exitCode: signal.aborted ? null : outcome.exitCode,
      stdout: handle.collected.stdout?.readFrom(0).text ?? '',
    }
  }
}

/**
 * Read this installation's version and operating system.
 * @returns the package version (every workspace package shares the Stitch version) and the OS description.
 */
export function feedbackEnvironment(): FeedbackEnvironment {
  let manifest: unknown
  try {
    manifest = JSON.parse(readFileSync(fileURLToPath(new URL('../package.json', import.meta.url)), 'utf8'))
  } catch (_missingManifest) {
    // A bundle without its manifest still files the report, without a version.
  }
  const version = typeof manifest === 'object' && manifest !== null && 'version' in manifest && typeof manifest.version === 'string'
    ? manifest.version
    : 'unknown'
  return { version, platform: `${os.type()} ${os.release()} (${process.platform}-${process.arch})` }
}

/** Clip to a code-point length, marking the cut. */
function clip(text: string, length: number): string {
  const chars = Array.from(text)
  return chars.length <= length ? text : `${chars.slice(0, length - 1).join('').trimEnd()}…`
}

/**
 * Build the editable issue preview for one remark.
 * @param entry - the remark text and category the human supplied.
 * @param environment - the version and operating system to name.
 * @param repository - `owner/name` slug a confirmed issue is filed on.
 * @returns a title from the remark's first line, a plain Markdown body holding only the remark and a
 * details list of category, version, and OS, and the target repository.
 */
export function draftFeedbackIssue(
  entry: { readonly text?: string; readonly category?: FeedbackCategory },
  environment: FeedbackEnvironment,
  repository = FEEDBACK_REPOSITORY,
): SessionFeedbackIssueDraft {
  const text = entry.text?.trim() ?? ''
  const firstLine = text.split('\n').find(line => line.trim().length > 0)?.trim()
  return {
    title: firstLine === undefined ? DEFAULT_ISSUE_TITLE : clip(firstLine, TITLE_LENGTH),
    body: [
      text.length === 0 ? NO_DESCRIPTION : text,
      '',
      'Details:',
      '',
      `- Category: ${entry.category ?? 'none'}`,
      `- Stitch version: ${environment.version}`,
      `- OS: ${environment.platform}`,
    ].join('\n'),
    repository,
  }
}

/**
 * Build the prefilled GitHub new-issue URL, shortening the body (and saying so in it) to stay within
 * {@link MAX_ISSUE_URL_LENGTH}.
 * @param issue - the confirmed title and body.
 * @param repository - `owner/name` slug.
 * @returns a URL no longer than the limit.
 */
export function newIssueUrl(issue: SessionFeedbackIssue, repository = FEEDBACK_REPOSITORY): string {
  const title = clip(issue.title.trim() || DEFAULT_ISSUE_TITLE, MAX_TITLE_LENGTH)
  const url = (body: string) =>
    `https://github.com/${repository}/issues/new?${new URLSearchParams({ title, body }).toString()}`
  const full = url(issue.body)
  if (full.length <= MAX_ISSUE_URL_LENGTH) return full
  const chars = Array.from(issue.body)
  const shortened = (count: number) => `${chars.slice(0, count).join('').trimEnd()}${ISSUE_TRUNCATION_NOTE}`
  let low = 0
  let high = chars.length
  while (low < high) {
    const mid = Math.ceil((low + high) / 2)
    if (url(shortened(mid)).length <= MAX_ISSUE_URL_LENGTH) low = mid
    else high = mid - 1
  }
  return url(shortened(low))
}

/** Run once, treating a program that cannot start as absent. */
async function attempt(
  run: FeedbackProcessRunner, args: readonly string[], timeoutMs: number,
): Promise<FeedbackProcessResult | undefined> {
  try {
    return await run('gh', args, { timeoutMs })
  } catch {
    return undefined
  }
}

/**
 * Send a confirmed issue the way the human chose. `browser` only builds the prefilled new-issue page and never
 * runs `gh`. `github-cli` creates the issue with an installed and authenticated `gh` CLI; when `gh` is missing,
 * unauthenticated, failing, or timing out, the caller receives the prefilled page instead.
 * @param request - the title and body the human confirmed, and the chosen method.
 * @param run - process runner for `gh`; used only for `github-cli`.
 * @param repository - `owner/name` slug.
 * @returns the created issue URL, or the prefilled page URL.
 */
export async function reportFeedbackIssue(
  request: SessionFeedbackReportIssueRequest,
  run: FeedbackProcessRunner,
  repository = FEEDBACK_REPOSITORY,
): Promise<SessionFeedbackReportIssueResult> {
  const title = clip(request.title.trim() || DEFAULT_ISSUE_TITLE, MAX_TITLE_LENGTH)
  const browser = { kind: 'browser', url: newIssueUrl({ title, body: request.body }, repository) } as const
  if (request.via !== 'github-cli') return browser
  const auth = await attempt(run, ['auth', 'status', '--hostname', 'github.com'], AUTH_TIMEOUT_MS)
  if (auth?.exitCode !== 0) return browser
  const created = await attempt(
    run, ['issue', 'create', '--repo', repository, '--title', title, '--body', request.body], CREATE_TIMEOUT_MS,
  )
  const url = created?.exitCode === 0 ? ISSUE_URL.exec(created.stdout)?.[0] : undefined
  return url === undefined ? browser : { kind: 'created', url }
}
