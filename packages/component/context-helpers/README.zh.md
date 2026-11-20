---
description: "时间上下文、重复调用提醒、图片卸载、工具输出裁剪和模型生成的会话标题。"
kind: "package-bundle"
---

# @deepseek-ai/dsh-component-context-helpers

[English](README.md) | 中文

## 概述

时间上下文、重复调用提醒、图片卸载、工具输出裁剪和模型生成的会话标题。此组件属于 Standard和 Minimal 组件组合。

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

在 Web 或 Desktop 中打开插件页开启或关闭 **上下文辅助**，或在首次运行的组件选择器中选择组件组合。`web` profile 模板选择 Standard 组合。

-----

<a id="understand-the-implementation"></a>
## 理解实现

<details>
<summary>实现细节 — 点击展开</summary>

[`cordis.patch.yml`](cordis.patch.yml) 启用 [dsh-web-app](../../bundle/web-app/README.zh.md) 以 `# component: context-helpers` 标记并保持禁用的行，并挂载 `component-context-helpers` 标记行，打开[智能体预设](../../preset/agent-preset-registry/README.zh.md)中的 `component: context-helpers` 门控。这些行在 dsh-web-app 与 dsh-base 中保留原有 id、位置和配置，后续 profile 补丁仍可照常定位它们。

它启用的 Host 与浏览器行：`image-offload`, `repeat-tool-reminder`, `session-title-llm`。

受它控制的预设行：`time-context`, `tool-result-pruner`。

</details>

-----

<a id="further-exploration"></a>
## 进一步探索

- [组件](../README.zh.md) — 组件组合与门控的工作方式。

-----

<a id="model-experience"></a>
## 模型体验

添加时间上下文、重复工具调用提醒、图片超出预算时的图片卸载以及超大工具结果裁剪。会话标题由模型生成，而不是取首条消息的开头几个词。

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
