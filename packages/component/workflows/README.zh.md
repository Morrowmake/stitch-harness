---
description: "workflow 工具、其 PTC 运行时和工作流运行视图。需要子智能体组件。"
kind: "package-bundle"
---

# @deepseek-ai/dsh-component-workflows

[English](README.md) | 中文

## 概述

workflow 工具、其 PTC 运行时和工作流运行视图。需要子智能体组件。此组件属于 Standard 组件组合。它需要**子智能体**组件；插件管理器会随它一起启用该组件，关闭该组件时也会关闭此组件。

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

在 Web 或 Desktop 中打开插件页开启或关闭 **工作流**，或在首次运行的组件选择器中选择组件组合。`web` profile 模板选择 Standard 组合。

-----

<a id="understand-the-implementation"></a>
## 理解实现

<details>
<summary>实现细节 — 点击展开</summary>

[`cordis.patch.yml`](cordis.patch.yml) 启用 [dsh-web-app](../../bundle/web-app/README.zh.md) 以 `# component: workflows` 标记并保持禁用的行，并挂载 `component-workflows` 标记行，打开[智能体预设](../../preset/agent-preset-registry/README.zh.md)中的 `component: workflows` 门控。这些行在 dsh-web-app 与 dsh-base 中保留原有 id、位置和配置，后续 profile 补丁仍可照常定位它们。

它启用的 Host 与浏览器行：`ptc-runtime`, `ui-workflow-run`。

受它控制的预设行：`workflow-ptc`, `tool-workflow`。

</details>

-----

<a id="further-exploration"></a>
## 进一步探索

- [组件](../README.zh.md) — 组件组合与门控的工作方式。

-----

<a id="model-experience"></a>
## 模型体验

向 Standard 和 Creator 预设添加 `workflow` 工具及其提示词指引，并提供 PTC 预设所需的 PTC 运行时。

#### KV Cache 影响

切换组件会改变之后新建会话的组合；已有会话保留其开始时使用的预设修订版本。

## 已知限制与暂缓工作

<a id="known-limitations-and-deferred-work"></a>

- 无。

-----

<a id="dev-note"></a>
### 开发备注

<details>
<summary>维护者上下文 — 点击展开</summary>

无。

</details>
