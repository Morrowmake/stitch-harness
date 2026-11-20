---
description: "Session feedback: the `/feedback` command, the `sessionFeedback` Host Remote behind the Web feedback dialog, and the fixed category taxonomy; for users and maintainers choosing, composing, or debugging feedback capture."
kind: "package-reference"
---

# @deepseek-ai/dsh-command-feedback

English | [中文](README.zh.md)

## Summary

`dsh-command-feedback` lets a user tell the harness what they think of a session. `/feedback` plus a remark saves it as a note on this computer and says that nothing was sent; the Web dialog saves a category and optional description through the `sessionFeedback` Host Remote. Recording never starts model work, and the model never sees the remark. Feedback stays in the local Session log until the user explicitly sends a previewed GitHub report, a public issue on the Stitch repository, either as a prefilled page in the browser or — only on request — through the `gh` CLI. The package owns the shared category taxonomy and ships with the standard `stitch` base; headless, ACP, and JSON-RPC have no slash commands.

## Table of Contents

- [Use this package](#use-this-package)
- [Understand the implementation](#understand-the-implementation)
- [Further Exploration](#further-exploration)
- [Model Experience](#model-experience)
- [Known Limitations and Deferred Work](#known-limitations-and-deferred-work)
- [Dev Note](#dev-note)

-----

<a id="use-this-package"></a>
## Use this package

Users can record feedback from the Web client out of the box: the `/feedback` command ships with the standard `stitch` base, needs no configuration, and works in any conversation. A custom app gets the same command by mounting the Session store, command registry, and this plugin together.

### The `/feedback` command

Type `/feedback` followed by your remark and send it. A successful entry is acknowledged in plain words, without the session id:

| Input | Result |
|---|---|
| `/feedback the diff view is unreadable` | Record the remark and acknowledge with `Note saved on this computer. Nothing was sent.` |
| `/feedback` | A usage error: `The note is empty. Type your note after the command, for example: /feedback The answer missed my question.` Whitespace-only input counts as empty. |

The command menu describes it as `Save a note about this chat or report a problem`, with the input hint `<note>`.

Surrounding whitespace is trimmed, but the remark is otherwise kept exactly as typed: no truncation, case folding, or command parsing — `/feedback /plan felt slow` records that literal text. Each command records its own entry; nothing is merged or replaced.

<a id="the-web-feedback-dialog"></a>
### The Web feedback dialog

In the Web client a bare `/feedback` — picked from the composer menu or typed and sent without text — opens the feedback dialog instead of the usage error. The dialog offers the seven categories below and a free-text box; every field is optional and an empty note is accepted. **Save note** records through `sessionFeedback.record`, which appends the same `feedback/record` event to the local Session log without command bookkeeping and without an acknowledgement row; nothing is sent anywhere, and the dialog says so next to the button and in its toast.

| Category id | Meaning |
|---|---|
| `task-result` | The outcome of the task |
| `instruction-following` | Understanding and following instructions |
| `product-interaction` | Product features and interaction |
| `service-stability` | Stability and speed |
| `resource-cost` | Resource usage and cost |
| `security-privacy-permission` | Security, privacy, and permissions |
| `other` | Anything else |

The ids are durable log vocabulary shared with per-message feedback; each surface owns its localized labels.

<a id="reporting-on-github"></a>
### Reporting on GitHub

The Web dialog's **Report on GitHub…** button, and a typed `/feedback <text>` once the Host has recorded it, open a preview of a GitHub issue. The preview states that it creates a public issue anyone can read on the repository named by the `FEEDBACK_REPOSITORY` constant in [`src/github-issue.ts`](src/github-issue.ts), `Morrowmake/stitch-harness`; the client reads that name from the `draftIssue` reply rather than repeating it. Nothing leaves the machine until the user picks one of two actions; closing the preview sends nothing. Either action records the remark first (unless `/feedback <text>` already did) and then calls `reportIssue` with the chosen method.

| Remote method | Result |
|---|---|
| `sessionFeedback.draftIssue({ text?, category? })` | `{ title, body, repository }`: the title is the remark's first line (at most 80 characters) or `Stitch feedback`; the body holds only the remark (or `No description provided.`) and a `Details:` list of the category, the Stitch version, and the OS. Sends nothing. |
| `sessionFeedback.reportIssue({ title, body, via: 'browser' })` | `{ kind: 'browser', url }` with a prefilled new-issue page the client opens in a new tab. Never runs `gh`. This is the dialog's primary **Open on GitHub** action. |
| `sessionFeedback.reportIssue({ title, body, via: 'github-cli' })` | `{ kind: 'created', url }` when `gh` filed the issue, or `{ kind: 'browser', url }` with the prefilled page when it could not. Used only by the explicit **File with my GitHub account** action. |

The body never carries session content, session ids, paths, or model names. The preview's **Include session id** box, off by default, appends a `- Session id: …` line the user can see and edit before sending.

With `via: 'github-cli'`, `reportIssue` runs `gh auth status --hostname github.com` and then `gh issue create --repo Morrowmake/stitch-harness --title <title> --body <body>` as argv arrays without a shell, with 10 s and 30 s deadlines. It uses the Host `subprocess` provider when one is mounted, otherwise Node's `execFile`; `GH_TOKEN`, `GITHUB_TOKEN`, `GH_CONFIG_DIR`, and `GH_HOST` are forwarded and prompts are disabled. When `gh` is missing, unauthenticated, fails, times out, or prints no issue URL, the answer is the prefilled `https://github.com/Morrowmake/stitch-harness/issues/new?title=…&body=…` page instead. Any other `via` value is treated as `browser`. That URL stays within 7000 characters: an oversized body is cut and ends with a note saying Stitch shortened it.

### Recording feedback from your own UI

Feedback does not have to come from the slash command or the dialog: any UI, hook, or host integration can record a remark directly through `recordFeedback` or the `sessionFeedback` Remote, with the same guarantees and without a model turn. A custom app that wants the slash command mounts the Session store, the command registry, and this plugin; the Session store is what the `sessionFeedback` Remote resolves live Sessions from:

```yaml
- id: session
  name: '@deepseek-ai/dsh-session'
- id: commands
  name: '@deepseek-ai/dsh-commands'
- id: command-feedback
  name: '@deepseek-ai/dsh-command-feedback'
```

The Web client ships the command. Headless mode, ACP automation, and JSON-RPC provide no slash commands, so `/feedback` is unavailable there.

-----

<a id="understand-the-implementation"></a>
## Understand the implementation

<details>
<summary>Implementation internals — click to expand</summary>

### Design concept

The remark is one append-only fact in the session log, owned by the event rather than by the trigger that produced it: feedback can arrive from the command, the dialog, or any integration, so the fact must not depend on the slash command. The command keeps its own bookkeeping payload-free, so the remark text exists in exactly one place in the log, and the event never surfaces to the model.

### How a remark is recorded

The producer trims the text, records blank text as absent, and writes one event into the session log even when the entry carries neither text nor category; the `/feedback` handler rejects empty input itself and is otherwise a thin wrapper over that same producer, and the `sessionFeedback.record` Remote resolves the live Session by id and calls it too, answering `session-not-found` when no live owner carries the id. Neither path starts model work. The write is eager but not flushed: the acknowledgement means the entry reached the log, not the disk. The exact producer contract lives in [`src/index.ts`](src/index.ts); the event payload, the taxonomy, and the Remote vocabulary live in [`src/types.ts`](src/types.ts).

### Source map

| File | Role |
|---|---|
| [`src/index.ts`](src/index.ts) | Plugin entry: `recordFeedback` producer, the `sessionFeedback` Remote service, `/feedback` command registration |
| [`src/github-issue.ts`](src/github-issue.ts) | `FEEDBACK_REPOSITORY`, the issue preview, the `gh` runners, and the prefilled new-issue URL with its truncation |
| [`src/types.ts`](src/types.ts) | `feedback/record` event declaration, the category taxonomy, and the Remote request and result types |

</details>

-----

<a id="further-exploration"></a>
## Further Exploration

Read these pages when the package-level contract is not enough. They cover the command registry, persistence, and identity facts this capture path relies on.

- [dsh-commands](../../interaction/commands/README.md) — the registry that discovers the global command and its `recordInput` semantics.
- [Session persistence subsystem](../../../docs/subsystems/persistence.md) — how appended events become durable and what a flush barrier means.
- [ui-message-feedback](../../client/ui-message-feedback/README.md) — the Web feedback dialog that records through the `sessionFeedback` Remote.
- [Feedback package map](../README.md) — where log-only capture sits next to per-message feedback.

-----

<a id="model-experience"></a>
## Model Experience

### Human `/feedback` capture

#### What the model sees

Nothing. The slash input, the dialog, `feedback/record`, and the acknowledgement are absent from model requests. The feedback event and registry lifecycle records are log-only and carry no `surfaceOp`, so they never reach the ordered surface, `deriveMessages()`, or a system prompt. Recording feedback during a turn does not change that turn's remaining requests.

#### Token effect

Zero direct token effect. Neither an accepted entry nor a usage error adds model tokens, in the recording turn or any later one.

#### KV Cache effect

Independent of the model request path. Recording appends to the session log only, leaving an already-reusable request prefix untouched. Nothing this package contributes can invalidate cache reuse.

## Known Limitations and Deferred Work

<a id="known-limitations-and-deferred-work"></a>


These limits define where session feedback is a poor fit or behaves differently than a user might expect. They are current package constraints, not a task backlog.

- **No feedback retrieval or management surface** — there is no retrieval, aggregation, or model-facing tool for `feedback/record`.
- **Category and text only** — an entry carries at most one category and one free-text string, with no severity or referenced-event link.
- **Live Sessions only through the Remote** — `sessionFeedback.record` answers `session-not-found` for a Session no live owner carries; the Web dialog reports that failure when its Session retires while it is open.
- **No amend or withdraw** — the session log is append-only and this package adds no tombstone, so a mistaken entry stays recorded and can only be superseded by a later one.
- **No explicit durability barrier** — the acknowledgement follows the append, not a flush, so an entry recorded immediately before a crash can be lost with any other unflushed tail. A consumer that needs a barrier awaits `ctx.sessions.flush(session)`.
- **GitHub reports leave the machine** — a sent report is a public issue on GitHub under the user's browser session or `gh` account; the remark cannot be withdrawn through Stitch.
- **A late `gh` success can duplicate** — when `gh issue create` exceeds its deadline after GitHub already accepted the issue, the user is still offered the prefilled page and can file it twice.
- **Shortened browser reports** — a body too long for the prefilled URL is cut; the user pastes anything missing on the GitHub page.
- **Web only among the shipped entry points** — headless mode, ACP automation, and JSON-RPC provide no command adapter, so `/feedback` is unavailable there.

<a id="dev-note"></a>
### Dev Note

<details>
<summary>Working context for maintainers — click to expand</summary>

This Dev Note is working context for maintainers; it is explicitly non-authoritative. Shipped behavior, limits, and rationale live in the sections above and the package code.

- The acknowledgement sentences and the category order are pinned by [`tests/command-feedback.spec.ts`](tests/command-feedback.spec.ts); changing them changes user-visible copy.
- The issue body format, the `gh` argv, and the URL bound are pinned by [`tests/github-issue.spec.ts`](tests/github-issue.spec.ts). A rebrand repoints `FEEDBACK_REPOSITORY` alone.
- A retrieval surface remains the open direction behind the first limitation; nothing in the current contract reserves a format for it.

</details>
