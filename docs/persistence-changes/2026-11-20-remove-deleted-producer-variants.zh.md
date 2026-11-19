---
description: "记录持久化类型更改及其兼容性确认。"
kind: persistence-change
---

# 2026-11-20-remove-deleted-producer-variants

[English](2026-11-20-remove-deleted-producer-variants.md) | 中文

## 概述

移除已删除生产方的 source 与 principal 变体：action-cards 归因类型离开 MessageSource，LiveShare 的 share-viewer principal 离开 user-rpc 与 retry-rpc source。user/message、developer/message、agent/inbox/spliced 与 session/title-llm-request 经由这些共享类型发生变化。DeepSeek 搜索提供者已删除，但其 web/deepseek-search-llm-request 事件仍在核心中声明，因此该 root 不变。

## 目录

- [声明](#declaration)
- [兼容性](#compatibility)
- [验证](#verification)
- [开发备注](#dev-note)

<a id="declaration"></a>
## 声明

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
## 兼容性

新读者仍能读取旧记录。action-cards 是经过限定的仅归因类型，LiveShare 写入的 share-viewer 也只是归因元数据。没有读者校验这两个值：格式 V4 恢复只检查 source kind 是非空字符串，所以两者原样进入恢复后的 Session，恢复后的 surface 也保留这两条消息。已发布日志中的 web/deepseek-search-llm-request 不带 ignorable 标记，因此它仍保留在 SessionEventMap 与 KNOWN_SESSION_EVENT_TYPES 中，否则格式 V4 恢复会以含有未知事件类型为由拒绝这些日志。旧读者也能读取新记录：剩余的每个变体此前都已被接受，也没有写入方再产生被移除的变体。

<a id="verification"></a>
## 验证

pnpm exec vitest run packages/session/session-format-v0-to-v1/tests/validation.spec.ts packages/session/session-format-catalog/tests：67 个测试通过。一个临时目录 spec 追加了 source 携带 share-viewer principal 的 user/message、带 action-cards source 的 developer/message，以及一条 web/deepseek-search-llm-request 事件；它通过使用严格当前校验的 sessionFormatCatalog.createRestore 与 Session.fromRestore 恢复这些事件，并断言两种 source 都保留在 surface 上。该 spec 通过。

<a id="dev-note"></a>
## 开发备注

无。
