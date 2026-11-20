---
description: "The Web feedback surface: the Like/Dislike pair in the finalized assistant message's action row, the feedback dialog behind both ratings and `/feedback`, and its acknowledgement and failure toasts; for users and maintainers of the feedback experience."
kind: "package-reference"
---

# @deepseek-ai/dsh-client-ui-message-feedback

English | [中文](README.zh.md)

## Summary

This package is the Web GUI's feedback surface: the Like/Dislike pair in the finalized assistant message's action strip, the feedback dialog with its acknowledgement and failure toasts in the composer overlay, and a decoration that opens the dialog from a bare `/feedback`. Like and Dislike both open the dialog, which collects a category and an optional description before saving the selected rating as a note on this computer; nothing is sent unless the user separately reports on GitHub. One surface per Session backs every entry, so a single list read seeds the whole transcript and one dialog serves the Session and its messages. Ratings, categories, and notes are log-only Session events that never enter model context.

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

Mount this plugin alongside `ui-conversation` and `ui-commands`; the Like/Dislike pair then appears in the action row of each turn's closing assistant message, between copy and branch, and Feedback in the composer menu opens the same dialog. Mounting `session-log-export` also adds Feedback to the Session Header's more-actions menu. The rating glyphs use 16px boxes at the default content font size, matching the adjacent completion actions while retaining fixed 1px outline strokes. A recorded rating shows the filled glyph and stays visible without hover. Like and Dislike both open the **Leave feedback** dialog: seven category chips and a detail box are optional, and **Save note** records the selected judgment with whatever was filled in. A line under the button says the note is saved on this computer only and nothing is sent, and the toast repeats that and points to **Report on GitHub** as the way to tell the Stitch team. Clicking the recorded rating retracts it without opening the dialog. A bare `/feedback`, picked from the menu or typed and sent without text, opens the same dialog for the Session; `/feedback <text>` keeps the Host command path and its acknowledgement row.

### Reporting on GitHub

**Report on GitHub…** under Save note turns the dialog into an issue preview. Its first line says the report creates a public issue anyone can read on `github.com/<repository>`, with the repository taken from the Host's [`sessionFeedback.draftIssue`](../../feedback/command-feedback/README.md#reporting-on-github) reply (`Morrowmake/stitch-harness`), and that nothing is sent until the user picks an option. Below an editable title, the body — the remark and a details list of its category, the Stitch version, and the OS — renders as formatted text; **Edit text** swaps it for the raw Markdown field and **Show preview** swaps back. The **Include session id** box is off by default and adds or removes a `- Session id: …` line. Two actions send the report, each recording the feedback first as Save note would: the primary **Open on GitHub** opens the prefilled new-issue page in a new tab and never runs `gh`; **File with my GitHub account**, explained underneath as using the GitHub command-line app (`gh`) signed in on this computer, files the issue directly and opens it, or opens the prefilled page with a toast to finish there when `gh` is missing, signed out, or fails. **Back** returns to the form with the draft intact. A typed `/feedback <text>` that the Host recorded opens the same preview for that text; sending it files the issue without recording the remark again, and closing it sends nothing.

### Failures

A rating or list-load failure shows inline in the row; a submission failure shows in a warning toast while the dialog stays open so the draft can be corrected. Only finalized messages reach the message entry — an interruption-frozen partial carries no `messageId` and therefore no feedback controls.

Access: the rating buttons render only while the current Peer may call `messageFeedback/put` on the Session; the `/feedback` decoration has no Client check, and the Host refuses a submission without access.

-----

The feedback dialog uses the shared modal heading spacing. Category chips form a tight group, details follow as a separate field, and the Save note action has a larger separation than the gaps within either input group; the one-line notes under Save note and File with my GitHub account use the caption color.

<a id="understand-the-implementation"></a>
## Understand the implementation

<details>
<summary>Implementation internals — click to expand</summary>

The package contributes the `feedback` entry (order 10) of `conversation.chat.assistant-actions`, declared by ui-conversation and rendered inside the finalized assistant message's IconActions row, and the `feedback-dialog` entry (order 2) of `conversation.input.overlay`, which renders the Modal and Toast primitives through body portals and centers the toast over the composer card it mounts inside. The `feedbackUi.openSession(sessionId)` Client service opens that same Session-scoped dialog without recording feedback; the Header menu and command decoration both use it. The `/feedback` decoration is an `action` registered through `ctx.commandUi.decorate`, so a menu pick or a bare Enter consumes the trigger token and opens the dialog while an argued line still reaches the Host command.

Per Session, one `MessageFeedbackController` backs every message control and one `FeedbackDialogController` owns the dialog draft, the submission, and the toast sequence. The message controller reads `messageFeedback.list` once, deferred to the first hover or focus rather than fired on mount, and serializes mutations so each carries the version last observed; a `version-conflict` reply carries the authoritative item and reconciles the view without refetching. Before either rating action proceeds, the row checks the committed item: the matching rating calls `retract`, which rechecks the rating in the serialized queue and becomes a no-op after a concurrent change, while any other state opens the dialog with the requested rating. The dialog controller submits by target: a message target puts that rating with the dialog's note and category through the message controller, and the Session target records through `ctx.remote.sessionFeedback`. Success closes the draft and raises the acknowledgement toast; a late success from a superseded draft raises that toast without closing the new draft; a failure keeps the draft open and raises a longer-lived warning toast.

The dialog controller's issue preview drafts through `sessionFeedback.draftIssue` and keeps the title, body, target repository, Session id opt-in, the method last chosen, and whether the remark is already recorded. Each send action records first when needed, marks the preview recorded so a retry after a failed report does not record twice, and then calls `sessionFeedback.reportIssue` with `via: 'browser'` or `via: 'github-cli'`; a `browser` answer to a `github-cli` request raises the finish-on-GitHub toast. Only `https://github.com/` answers are opened, with `noopener,noreferrer`. The preview renders the body through the shared `MarkdownText` primitive. The typed-remark preview listens to the `command/executed` event of [ui-commands](../ui-commands/README.md) for a successful `feedback` command and takes the remark from its submitted line.

</details>

-----

<a id="further-exploration"></a>
## Further Exploration

Read these pages when the feedback surface is not enough. They move from the browser strip to the Session-log backends and the conversation shell.

- [dsh-message-feedback](../../feedback/message-feedback/README.md) — the Session-log backend that owns per-item compare-and-set and persistence.
- [dsh-command-feedback](../../feedback/command-feedback/README.md) — the `/feedback` command, the `sessionFeedback` Remote, and the category taxonomy.
- [ui-commands](../ui-commands/README.md) — the command decoration contract the `/feedback` row goes through.
- [ui-conversation](../ui-conversation/README.md) — declares the assistant-actions strip and the composer overlay.
- [Client package map](../README.md) — adjacent browser UI packages.

-----

<a id="model-experience"></a>
## Model Experience

None, as ratings, categories, and notes are log-only events, not model input. Optional Session-log delivery uses request metadata rather than model context.

#### KV Cache effect

None; feedback mutations leave the model-visible history unchanged.

## Known Limitations and Deferred Work

<a id="known-limitations-and-deferred-work"></a>


These limits define the current feedback surface. They are current package constraints, not a general rating comparison or a task backlog.

- **Note size is a Host policy** — the deployment configures `maxNoteBytes` (8192 in the Web bundle) and the Host rejects an oversized note with `note-too-large`. The dialog does not pre-check the limit, so an oversized description for a message fails on submit rather than while typing; a Session remark has no bound.
- **No cross-tab push** — a second tab's rating becomes visible on reconnect or on the next conflict reply, not immediately; the controller does not consume feedback log events.
- **Chat view only** — the trajectory and waterfall views render no feedback controls even though their assistant nodes carry the same `messageId`.
- **Popup blockers** — the GitHub page opens after the Host answers, outside the click's user gesture, so a strict popup blocker can stop it; the success toast still shows.

<a id="dev-note"></a>
### Dev Note

<details>
<summary>Working context for maintainers — click to expand</summary>

None.

</details>
