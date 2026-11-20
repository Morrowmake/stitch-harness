---
description: "MCP 服务器及其工具与资源、连接器账户和 MCP 设置。"
kind: "package-bundle"
---

# @deepseek-ai/dsh-component-mcp

[English](README.md) | 中文

## 概述

MCP 服务器及其工具与资源、连接器账户和 MCP 设置。此组件属于 Standard 组件组合。

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

在 Web 或 Desktop 中打开插件页开启或关闭 **MCP 连接器**，或在首次运行的组件选择器中选择组件组合。`web` profile 模板选择 Standard 组合。

-----

<a id="understand-the-implementation"></a>
## 理解实现

<details>
<summary>实现细节 — 点击展开</summary>

[`cordis.patch.yml`](cordis.patch.yml) 启用 [dsh-web-app](../../bundle/web-app/README.zh.md) 以 `# component: mcp` 标记并保持禁用的行，并挂载 `component-mcp` 标记行，打开[智能体预设](../../preset/agent-preset-registry/README.zh.md)中的 `component: mcp` 门控。这些行在 dsh-web-app 与 dsh-base 中保留原有 id、位置和配置，后续 profile 补丁仍可照常定位它们。

它启用的 Host 与浏览器行：`mcp-manager`, `mcp-account`, `mcp-resources`, `ui-connector-account`。

</details>

-----

<a id="further-exploration"></a>
## 进一步探索

- [组件](../README.zh.md) — 组件组合与门控的工作方式。

-----

<a id="model-experience"></a>
## 模型体验

向所有预设添加已配置 MCP 服务器的工具、资源和服务器说明。

#### KV Cache 影响

切换组件会改变之后新建会话的组合；已有会话保留其开始时使用的预设修订版本。

## 已知限制与暂缓工作

<a id="known-limitations-and-deferred-work"></a>

- CLI 应用插件的连接器账户区块位于同一插件页面，同样需要此组件。

-----

<a id="dev-note"></a>
### 开发备注

<details>
<summary>维护者上下文 — 点击展开</summary>

无。

</details>
