---
description: "记录持久化类型更改及其兼容性确认。"
kind: persistence-change
---

# 2026-11-21-approval-chat-grants

[English](2026-11-21-approval-chat-grants.md) | 中文

## 概述

记录对话内审批授权：`approval/asked` 新增可选的 `grant` 操作类别，`approval/decided.outcome` 新增 `allowed-for-session`。

## 目录

- [声明](#declaration)
- [兼容性](#compatibility)
- [验证](#verification)
- [开发备注](#dev-note)

<a id="declaration"></a>
## 声明

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
## 兼容性

已有记录仍然有效：缺少 `grant` 表示请求只提供一次性授权，这与此前所有请求一致；原有结果字面量的含义均不变。新版读取方只从与提供了 `grant` 的请求配对的 `allowed-for-session` 决定中折叠对话内授权，因此旧日志不会产生任何授权。旧版读取方仍把两个事件视为仅日志记录，忽略新增字段，也不会从中折叠授权；因此对于新版写入方已在本对话内放行的操作，旧版会再次询问，属于以拒绝方式关闭的方向。`approvalState` 投影的状态版本升为 2，因此任一版本写入的检查点都会被另一版本从日志重新折叠，而不会被错误解读。

<a id="verification"></a>
## 验证

pnpm exec vitest run packages/interaction/user-approval packages/sandbox/sandbox/tests/escalation.spec.ts packages/boot/plugin-manager/tests/tools.spec.ts：全部测试通过，覆盖对话内授权范围、分叉切点、never 策略优先级以及替换服务后的恢复。

<a id="dev-note"></a>
## 开发备注

无。
