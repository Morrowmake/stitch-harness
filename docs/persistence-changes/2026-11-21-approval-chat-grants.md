---
description: "Records a persistence type transition and its compatibility acknowledgement."
kind: persistence-change
---

# 2026-11-21-approval-chat-grants

English | [中文](2026-11-21-approval-chat-grants.zh.md)

## Summary

Records chat-scoped approval grants: `approval/asked` gains an optional `grant` action class, and `approval/decided.outcome` gains `allowed-for-session`.

## Table of Contents

- [Declaration](#declaration)
- [Compatibility](#compatibility)
- [Verification](#verification)
- [Dev Note](#dev-note)

<a id="declaration"></a>
## Declaration

```yaml persistence-change
schemaVersion: 1
id: 2026-11-21-approval-chat-grants
baseline: false
changes:
  - root: "event:approval/asked"
    previous: "2026-09-11-initial"
    after: "691adf02c7bbd4406e9e24a275dbdea51f7eb3170bb170c436563ed28e536b83"
    decision: same-version
  - root: "event:approval/decided"
    previous: "2026-09-11-initial"
    after: "fa6275475e282f8f4572e01fc7500303efa8d8d3f46130ba917d0f9101479e56"
    decision: same-version
```

<a id="compatibility"></a>
## Compatibility

Existing records remain valid: an absent `grant` means the request offered only a one-shot grant, which is what every earlier ask offered, and every earlier outcome literal keeps its meaning. A newer reader folds chat grants only from an `allowed-for-session` decision paired with an ask that offered `grant`, so older logs yield no grants. An older reader keeps both events log-only, ignores the extra field, and never folds grants from either event; it therefore asks again for actions a newer writer allowed for the chat, which is the fail-closed direction. The `approvalState` projection moves to state version 2, so checkpoints written by either version are refolded from the log by the other instead of being reinterpreted.

<a id="verification"></a>
## Verification

pnpm exec vitest run packages/interaction/user-approval packages/sandbox/sandbox/tests/escalation.spec.ts packages/boot/plugin-manager/tests/tools.spec.ts: all tests passed, including chat-grant scope, fork-cut, never-policy precedence, and replacement-service recovery cases.

<a id="dev-note"></a>
## Dev Note

None.
