---
description: "为 Creator 智能体提供只读的 plugin_market 工具；默认关闭。"
kind: "package-bundle"
---

# @deepseek-ai/dsh-component-plugin-market-tool

[English](README.md) | 中文

## 概述

为 Creator 模式中的智能体提供只读的 `plugin_market` 工具，用于搜索在「发现」中配置的插件索引。两个组件集都不开启该工具，以保持智能体的指令简短；插件页的「发现」标签页不依赖它。

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

在 Web 或桌面端打开插件页，选择**显示高级项**，然后打开或关闭**供智能体使用的插件市场工具**；也可以在首次运行组件选择器的自定义组合中勾选它。

-----

<a id="understand-the-implementation"></a>
## 理解实现

<details>
<summary>实现细节 — 点击展开</summary>

[`cordis.patch.yml`](cordis.patch.yml) 挂载 `component-plugin-market-tool` 标记行，打开[智能体预设](../../preset/agent-preset-registry/README.zh.md)中的 `component: plugin-market-tool` 闸门。

受它控制的预设行：Creator 预设中的 `tool-plugin-market`。该行在没有 profile 时仍保持禁用，并且只在 [`pluginMarket`](../../boot/plugin-market/README.zh.md) 服务运行时注册工具；[dsh-web-app](../../bundle/web-app/README.zh.md) 在每个有 profile 的 Web 组合中挂载该服务。

</details>

-----

<a id="further-exploration"></a>
## 进一步探索

- [组件](../README.zh.md) — 组件集以及闸门的工作方式。

-----

<a id="model-experience"></a>
## 模型体验

间接通过 Creator 预设：组件开启时，Creator 会话包含 [`plugin_market` 工具](../../boot/plugin-market/README.zh.md#model-experience)的声明及其结果；关闭时两者都没有。

#### KV Cache 影响

切换该组件会改变之后创建的会话的工具列表；已有会话保留其启动时的预设版本。

## 已知限制与暂缓工作

<a id="known-limitations-and-deferred-work"></a>

- 只有 Creator 预设声明了该组件打开的工具行；Standard 和 PTC 预设的对应行保持禁用。

-----

<a id="dev-note"></a>
### 开发备注

<details>
<summary>维护者备注 — 点击展开</summary>

无。

</details>
