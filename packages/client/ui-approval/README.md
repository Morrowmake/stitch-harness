---
description: "Browser approval UI that answers Host permission requests through the scoped interaction path."
kind: "package-reference"
---
# @deepseek-ai/dsh-client-ui-approval

English | [中文](README.zh.md)

## Summary

Browser approval presentation over the Agent-scoped Remote Event waterfall. The plugin publishes each pending request through `ctx.uiSession`, takes over the Conversation composer, optionally renders correlated Tool detail, and returns the user's decision to the waiting Host request. Use it when a browser must collect approval for a waiting Host operation.

## Table of Contents

- [Model Experience](#model-experience)
- [Known Limitations and Deferred Work](#known-limitations-and-deferred-work)
- [Dev Note](#dev-note)

-----

Focus the approval detail region to approve with Enter or deny with Escape. The mounted plugin reserves both keys against editable shortcuts. Enter on the focused Deny button retains its native deny action. Input controls and IME candidates keep their own keys. Keyboard and pointer actions share one pending-request lock; a withdrawn or replaced request cannot accept another answer, and an earlier failed answer cannot unlock its replacement.

A tool approval shows the requester's plain-language description. Its correlated Tool detail shows a shell command directly; any other Tool call keeps its raw arguments behind a collapsed **Details** disclosure. The actions are **Deny**, **Allow once**, and, when the request offers a chat grant, **Allow for this chat**, which answers `allowed-for-session` so later requests of the same kind in this chat proceed without a prompt. When offered, **Always allow** is the highlighted primary button. Otherwise, the current-request allow action is primary. Enter in the detail region always grants the limited scope: once for a tool approval, or the current session for CUA. Chat-wide and persistent access require explicitly activating their buttons. The shortcut reference uses Allow because the caller supplies that scope.

Callers can supply localized warning copy through the shared card's optional `warning` field, with paragraphs separated by blank lines (`\n\n`). Hovering or keyboard-focusing the tag opens a formatted nonmodal card; clicking or tapping also opens it. The pointer can cross into the card to read or select its text. Leaving both surfaces closes it after a short grace period unless keyboard focus remains inside. Moving focus outside, clicking outside, and Escape also dismiss it without rejecting the request. Hover does not move focus. Moving focus elsewhere also closes a hover-open card, including when a foreground modal takes focus. Switching away from the window or hiding the browser tab closes it without restoring focus. Foreground modals and input-method composition retain their keyboard handling. CSS anchors position the card above the tag with window-edge fallbacks and internal scrolling when space is limited.

<a id="model-experience"></a>
## Model Experience

None, as this package presents approval requests in the browser and registers nothing model-facing.

#### KV Cache effect

None; approval request and response rendering does not alter a model request.

## Known Limitations and Deferred Work

<a id="known-limitations-and-deferred-work"></a>

- The shared `conversation.approval.card` Factory presents deny, allow, an optional allow-for-this-chat action, and an optional always-allow action, with caller-owned scope, subject metadata and answer callbacks. Tool approvals offer the third choice only when the request offers a chat grant. Application consent can reuse the card without adopting tool-approval policy. Subject metadata enables left-aligned content; actions wrap when space runs out. Icons and labels identify the subject visually; the caller owns identity verification and saved grants.


<a id="dev-note"></a>
### Dev Note

<details>
<summary>Working context for maintainers — click to expand</summary>

None.

</details>
