---
description: "用简短的提示词替换默认预设中冗长的工具指引。"
kind: "package-bundle"
---

# @deepseek-ai/dsh-component-short-prompt

[English](README.md) | 中文

## 概述

用简短的提示词替换默认预设中冗长的工具指引。提示词根据每个会话中已挂载的工具生成，因此可与任意组件选择组合。简短提示词是 Custom 中的开关，在 Standard 组合中关闭。

## 目录

- [使用此包](#use-this-package)
- [理解实现](#understand-the-implementation)
- [进一步探索](#further-exploration)
- [模型体验](#model-experience)
- [已知限制与暂缓工作](#known-limitations-and-deferred-work)
- [开发备注](#dev-note)

-----

<a id="use-this-package"></a>
## 使用此包

在 Web 或 Desktop 中打开插件页开启或关闭 **简短系统提示词**，或在首次运行的组件选择器中选择组件组合。`web` profile 模板选择 Standard 组合。

-----

<a id="understand-the-implementation"></a>
## 理解实现

<details>
<summary>实现细节 — 点击展开</summary>

[`cordis.patch.yml`](cordis.patch.yml) 启用 [dsh-web-app](../../bundle/web-app/README.zh.md) 以 `# component: short-prompt` 标记并保持禁用的行，并挂载 `component-short-prompt` 标记行，打开[智能体预设](../../preset/agent-preset-registry/README.zh.md)中的 `component: short-prompt` 门控。这些行在 dsh-web-app 与 dsh-base 中保留原有 id、位置和配置，后续 profile 补丁仍可照常定位它们。

受它控制的预设行：`persona-short`。该行以 `shortPrompt: true`、一句点明 Stitch 的开场白和结尾规则“Be concise, and show file paths clearly.”挂载 [dsh-persona](../../preset/persona/README.zh.md)；由于开场白已点明 Stitch，它省略 `harness:identity` 段落。每个工具通过其工具定义的 `shortPrompt` 字段带来自己的摘要与规则，因此启用某个组件会加入其工具的行，停用则会移除。

</details>

-----

<a id="further-exploration"></a>
## 进一步探索

- [组件](../README.zh.md) — 组件组合与门控的工作方式。

-----

<a id="model-experience"></a>
## 模型体验

通过默认（Standard）预设间接影响。模型看到：

```text
You are a coding agent running inside Stitch, an agent harness you can modify while it runs. Help the user inspect files, run commands, and change code. The model is {{model}}.

<tools>
- <tool>: <one-line summary>

Additional tools may be available.
</tools>

<rules>
- <the mounted tools' rules>
- Be concise, and show file paths clearly.
</rules>
```

每个已挂载工具一行（共享摘要的工具共用一行，例如 `job_list / job_output / job_kill`）。未挂载 glob 与 grep 时，shell 工具会加入“Use bash for file operations like ls, rg, find.”（Windows 上为“Use PowerShell for file operations like listing, searching, and finding files.”）；挂载它们后，由搜索工具的规则取而代之。声明了简短贡献的工具，其冗长指引段落会被省略。其他所有提示词内容保持不变：其他组件的策略（如计划模式或团队策略）、未声明简短贡献的工具的冗长指引，以及运行时上下文（工作目录、日期与时间、沙箱与审批策略、技能目录、AGENTS.md）。工具 schema 不变。

#### KV Cache 影响

切换组件会改变之后新建会话的组合；已有会话保留其开始时使用的预设修订版本。在会话内，生成的工具列表在挂载或移除工具之前逐字节保持稳定。

## 已知限制与暂缓工作

<a id="known-limitations-and-deferred-work"></a>

- 只有 Standard 预设使用简短提示词；PTC、Minimal 和 Creator 智能体预设保留各自的人设。

-----

<a id="dev-note"></a>
### 开发备注

<details>
<summary>维护者上下文 — 点击展开</summary>

无。

</details>
