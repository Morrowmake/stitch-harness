---
description: "Records a persistence type transition and its compatibility acknowledgement."
kind: persistence-change
---

# 2026-11-20-remove-deleted-producer-variants

English | [中文](2026-11-20-remove-deleted-producer-variants.zh.md)

## Summary

Removes the source and principal variants of deleted producers: the action-cards attribution kind leaves MessageSource, and the LiveShare share-viewer principal leaves the user-rpc and retry-rpc sources. user/message, developer/message, agent/inbox/spliced, and session/title-llm-request change through those shared types. The DeepSeek search provider was deleted, but its web/deepseek-search-llm-request event stays declared in core so its root is unchanged.

## Table of Contents

- [Declaration](#declaration)
- [Compatibility](#compatibility)
- [Verification](#verification)
- [Dev Note](#dev-note)

<a id="declaration"></a>
## Declaration

```yaml persistence-change
schemaVersion: 1
id: 2026-11-20-remove-deleted-producer-variants
baseline: false
changes:
  - root: "event:agent/inbox/spliced"
    previous: "2026-11-05-timeline-priority-notice"
    after: "ff5ecef767e0ac46173e102b4d6656ef1353792d8ac535b807eaebdd1b9edfc5"
    decision: same-version
  - root: "event:developer/message"
    previous: "2026-11-05-timeline-priority-notice"
    after: "95d83f4951c21ea13ec356d46f397af6ee70e4a5f7c0b5da039c93f9cbad1c6a"
    decision: same-version
  - root: "event:session/title-llm-request"
    previous: "2026-11-05-timeline-priority-notice"
    after: "86be807d4d6276ede2e5a1bdce4d4c60c745564f1c19a8614cc439f2b045a2dc"
    decision: same-version
  - root: "event:user/message"
    previous: "2026-11-05-timeline-priority-notice"
    after: "4f9a1782ea5dd2bd9c3f8b4cb7d847b4ac519d8321035ae8738d074509ddba9e"
    decision: same-version
```

<a id="compatibility"></a>
## Compatibility

New readers keep reading old records. action-cards was a qualified attribution-only kind, and LiveShare wrote share-viewer only as attribution metadata. No reader validates either value: format V4 restore checks only that a source kind is a nonempty string, so both reach the restored Session unchanged and the restored surface keeps both messages. Released logs contain web/deepseek-search-llm-request without the ignorable marker, so it stays in SessionEventMap and KNOWN_SESSION_EVENT_TYPES. Otherwise format V4 restore would reject those logs as containing an unknown event type. Older readers also read new records: every remaining variant was already accepted, and no writer produces the removed ones.

<a id="verification"></a>
## Verification

pnpm exec vitest run packages/session/session-format-v0-to-v1/tests/validation.spec.ts packages/session/session-format-catalog/tests: 67 tests passed. A temporary catalog spec appended a user/message whose source carries a share-viewer principal, a developer/message with an action-cards source, and a web/deepseek-search-llm-request event. It restored them through sessionFormatCatalog.createRestore with strict current validation and Session.fromRestore, and asserted that both sources were retained on the surface. It passed.

<a id="dev-note"></a>
## Dev Note

None.
