---
description: "Web 或 Desktop profile 可开关的功能组件：每个组合包完整开启一项功能，具名组合在 Standard 与 Minimal 之间选择。"
kind: "package-group"
---

# component/：功能组件

[English](README.md) | 中文

## 概述

组件是 Web 与 Desktop 组合中的一项功能——包括它的工具、面板、命令、技能和设置页——打包成插件页可开关的组合包。`web` profile 模板选择 `dsh-base`、`dsh-web-app` 和 Standard 组合，即完整的默认组合。Minimal 组合保留始终开启的核心（聊天、文件、shell、编辑工具、设置、插件页、模型提供方、审批和自我修改工具），再加上少量面板和简短的系统提示词。契约位于 [`@deepseek-ai/dsh-official-bundles`](../util/official-bundles/src/components.ts)。

## 目录

- [包](#packages)
- [组件如何组合](#how-components-compose)
- [相关文档](#related-documentation)
- [开发备注](#dev-note)

<a id="packages"></a>
## 包

| 组件 | 包 | Standard | Minimal | 依赖 |
|---|---|---|---|---|
| 文件与预览 | [`files`](files/README.zh.md) | ✓ | ✓ | — |
| 终端 | [`terminal`](terminal/README.zh.md) | ✓ | ✓ | — |
| 浏览器面板 | [`browser`](browser/README.zh.md) | ✓ | ✓ | — |
| 搜索工具 | [`search-tools`](search-tools/README.zh.md) | ✓ | — | — |
| 网络 | [`web`](web/README.zh.md) | ✓ | — | — |
| 后台任务 | [`jobs`](jobs/README.zh.md) | ✓ | ✓ | — |
| 规划 | [`planning`](planning/README.zh.md) | ✓ | — | — |
| 目标 | [`goals`](goals/README.zh.md) | ✓ | — | — |
| 日程 | [`schedules`](schedules/README.zh.md) | ✓ | — | — |
| 子智能体 | [`subagents`](subagents/README.zh.md) | ✓ | — | — |
| 智能体团队 | [`agent-teams`](agent-teams/README.zh.md) | ✓ | — | `subagents` |
| 工作流 | [`workflows`](workflows/README.zh.md) | ✓ | — | `subagents` |
| Office 文档 | [`office`](office/README.zh.md) | ✓ | — | — |
| 工作区跟踪 | [`workspace-tracking`](workspace-tracking/README.zh.md) | ✓ | ✓ | — |
| MCP 连接器 | [`mcp`](mcp/README.zh.md) | ✓ | — | — |
| 上下文辅助 | [`context-helpers`](context-helpers/README.zh.md) | ✓ | ✓ | — |
| 更多预设 | [`presets`](presets/README.zh.md) | ✓ | ✓ | — |
| 简短系统提示词 | [`short-prompt`](short-prompt/README.zh.md) | — | ✓ | — |
| 供智能体使用的插件市场工具 | [`plugin-market-tool`](plugin-market-tool/README.zh.md) | — | — | — |

此表之外的可选组合包在两种组合中都保持关闭。

<a id="how-components-compose"></a>
## 组件如何组合

- **Host 与浏览器行。** dsh-web-app 将每个组件拥有的行保留在原位，并标记为 `disabled: true  # component: <id>`；组件拥有的共享 dsh-base 行也以同样的标记禁用。组件组合包会把这些行的 `disabled` 改回，因此 id、位置和配置都与引入组件之前的组合相同。
- **预设行。** 智能体预设 `plugins` 中的行可以带有 `component: <id>`（或 `!<id>`，或列表）。[预设注册表](../preset/agent-preset-registry/README.zh.md) 在挂载预设前丢弃门控不成立的行；预设本身的 `component:` 会隐藏整个预设。每个组件挂载一个 `component-<id>` 标记行；标记行启动或停止时会重新组合预设，进行中的会话保留其开始时的修订版本。
- **前置依赖。** 组合包在 `dsh.bundle.requires` 中列出所需的组合包。插件管理器会随组合包一起启用其前置依赖，并在关闭某个组合包时关闭依赖它的组合包；`setBundlesEnabled` 以一次 profile 写入和一次重载应用整组选择。
- **已有 profile。** 选择了 dsh-web-app 但没有任何组件的 profile（引入组件之前写入的 profile 都是如此）在加载时会在 dsh-web-app 之后获得 Standard 组合。

<a id="related-documentation"></a>
## 相关文档

- [bundle/](../bundle/README.zh.md) — 组件叠加其上的 profile 组合包。
- [插件管理器](../boot/plugin-manager/README.zh.md) — 启用、关闭组件并识别组件组合。
- [生成的组合图](../../apps/cli/composition.md) — 每个随附 profile 使用的确切组合。

<a id="dev-note"></a>
## 开发备注

无。
