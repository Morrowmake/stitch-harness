---
description: "Stitch Web 客户端插件页上的网页搜索与获取设置页：Search 与 Fetch 提供方下拉框，以及免密钥搜索可选的 SearXNG 地址。"
kind: "package-reference"
---

# @deepseek-ai/dsh-client-ui-settings-web-search

[English](README.md) | 中文

## 概述

在侧栏打开**插件**，在官方分组里选择**网页搜索与获取**，即可选择网页搜索和网页获取使用的提供方，并可让免密钥搜索改用你自己的 SearXNG 实例。页面只在保存时写入。页面在 Host 服务 `web` 命名空间期间存在；SearXNG 地址只在 Host 服务 `web-search-keyless` 命名空间时显示。

## 目录

- [使用本包](#use-this-package)
- [理解实现](#understand-the-implementation)
- [进一步探索](#further-exploration)
- [模型体验](#model-experience)
- [已知限制与延期工作](#known-limitations-and-deferred-work)
- [开发备注](#dev-note)

-----

<a id="use-this-package"></a>
## 使用本包

官方分组中的**网页搜索与获取**卡片打开此页面。页面有**网页搜索提供方**和**网页获取提供方**两个分区，标题下方各有一个提供方下拉框。下拉框列出 Host 注册的所有提供方，包括插件注册的提供方，因此新装的提供方无需修改本页；[添加其他提供方](../../web/web/README.zh.md#adding-a-provider)说明如何在 profile 中挂载。内置提供方注册时排在最前：Search 下拉框列出**免密钥（DuckDuckGo → Marginalia）**（`keyless`），Fetch 下拉框列出**匿名 HTTP**（`http`）；其他提供方按注册顺序排在其后，显示注册的标题或 id。Host 未注册的已选提供方仍留在下拉框中，并标记为未加载。所选提供方注册的说明显示在下拉框下方；插件提供方还会提示到其自身设置中配置。

选中免密钥搜索时，下拉框下方的灰色面板中有 **SearXNG 地址**，写入 `web-search-keyless.searxngUrl`，并附简短说明和 [SearXNG 文档](https://docs.searxng.org/)链接。留空时先搜索 DuckDuckGo，再搜索 Marginalia。填写不含用户名或密码的 `http://` 或 `https://` 地址后，所有搜索只发往该实例，该实例须启用 JSON 输出；下拉框随后将提供方显示为**免密钥（SearXNG）**。其他地址会被拒绝并阻止保存。

值字段显示生效值，被覆盖后带有**已覆盖**标记和**恢复默认**，清空后保存为重置。暂存了无效编辑或保存失败时，提供方下拉框会被禁用，以免切换后隐藏的字段不可见。一次保存先写入免密钥设置，再写入提供方选择，因此某一分区被拒绝时，提供方选择不会保存。点击**保存**之前不写入任何内容；离开页面会丢弃草稿。

-----

<a id="understand-the-implementation"></a>
## 理解实现

<details>
<summary>实现细节——点击展开</summary>

Host 侧只有一个空 `apply`，仅为让本包占有一行 Loader 配置，客户端模块系统据此提供浏览器侧代码。浏览器侧通过 `ctx.configForms.get` 绑定 `web` 和 `web-search-keyless` 命名空间，并在 `WebSearchCardController` 中为每个命名空间保留一个 `ui-primitives` 的共享 `SettingsFormModel`。下拉框在 `web` 中暂存 `searchProvider` 和 `fetchProvider`；目标等于组合值时改为暂存重置，**自动选择**项也是如此，该项只在组合的 `base` 对应字段无值时提供。提供方列表来自 `remote.web.listProviders`，保持注册顺序；控制器把已注册的内置提供方移到最前。只有最近一次列表读取会发布；读取失败时保留上次列表并显示重试。收到 `web/providers-changed`、连接重置，或 Host 开始服务 `web` 时，页面会重新读取列表。

</details>

-----

<a id="further-exploration"></a>
## 进一步探索

- [ui-plugin-manager](../ui-plugin-manager/README.zh.md) — 插件页及本页注册进的 `plugins.item` 插槽。
- [ui-settings](../ui-settings/README.zh.md) — 本页依赖的设置作用域和已服务命名空间监听。
- [ui-primitives](../ui-primitives/README.zh.md) — 本页渲染的设置表单模型和字段。
- [web-search-keyless](../../web/web-search-keyless/README.zh.md) — 本页编辑其 SearXNG 地址的免密钥搜索提供方。
- [web](../../web/web/README.zh.md) — 下拉框使用的提供方选择和提供方列表。

-----

<a id="model-experience"></a>
## 模型体验

无，本包是浏览器侧设置界面，不注册任何模型可见内容。

#### KV 缓存影响

无；本包既不组装也不发送提供方请求。

## 已知限制与延期工作

<a id="known-limitations-and-deferred-work"></a>

- **自动选择只读取部署组合** — 当组合层未为该能力设置提供方时，下拉框才提供自动选择。自动选择生效时，由 Host 的 `STITCH_WEB_SEARCH_PROVIDER` 或 `STITCH_WEB_FETCH_PROVIDER` 环境变量选择提供方，页面不显示该选择。
- **不探测 SearXNG 地址** — 页面只检查地址格式；实例不可达或未启用 JSON 输出时，会在搜索时失败。

<a id="dev-note"></a>
### 开发备注

<details>
<summary>维护者工作上下文——点击展开</summary>

无。

</details>
