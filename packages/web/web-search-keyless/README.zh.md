---
description: "ctx.web 的免密钥搜索提供方：部署方如何在没有账号、注册或付费密钥的情况下，通过 SearXNG、DuckDuckGo 与 Marginalia 挂载网页搜索。"
kind: "package-reference"
---

# @deepseek-ai/dsh-web-search-keyless

[English](README.md) | 中文

## 概述

有了 `dsh-web-search-keyless`，harness 可以通过 web 服务（`ctx.web`）搜索网页，无需账号或付费密钥。它是 Stitch 的默认搜索提供方。一个已注册的提供方按顺序尝试各个来源：已配置的 SearXNG 实例单独使用；否则使用 DuckDuckGo 的 HTML 端点，并在 DuckDuckGo 限流或失败时以 Marginalia 的共享公开密钥作为后备。当部署不能依赖搜索厂商账号时选择它；公共来源可能限流，因此自托管的 SearXNG 实例是最可靠、最私密的选择。面向模型的 `web_search` 工具位于 `dsh-tool-web`，由它渲染本提供方的来源。

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

在已加载 web 服务的组合中挂载本提供方；它注册为 `keyless` 搜索提供方，因此当它是唯一可用的搜索后端时，`ctx.web.search()` 会自动解析到它——也可以用 `searchProvider: keyless` 固定选择它。

### 何时选择

当搜索必须开箱即用、不需要任何凭据，并且查询应发往尊重隐私的来源而非绑定账号的厂商 API 时，选择本提供方。需要可预期的可用性时，把它指向你自己运行的 SearXNG 实例。

### 最小配置

加载 web 服务与本提供方；所有字段都是可选的。

```yaml
- id: web
  name: '@deepseek-ai/dsh-web'
  config:
    searchProvider: keyless
- id: web-search-keyless
  name: '@deepseek-ai/dsh-web-search-keyless'
  config:
    # Optional: search only this SearXNG instance.
    searxngUrl: https://searx.example.org/
```

| 字段 | 默认值 | 含义 |
|---|---|---|
| `searxngUrl` | 省略 | 已启用 `json` 搜索格式的 SearXNG 实例基础 URL；`/search` 追加到其路径之后。不含内嵌凭据的 http(s) URL 会让搜索只发往该实例；其他任何值都会让 SearXNG 不可用。每次搜索都读取当前值，因此保存的设置无需重新挂载插件即可作用于下一次搜索 |
| `marginaliaApiKey` | `public` | 发送给 Marginalia 的 `API-Key` 请求头。空值会把 Marginalia 从顺序中移除 |
| `sources` | 省略 | 按顺序尝试的来源，取值为 `searxng`、`duckduckgo` 与 `marginalia`。省略或为空时：`searxngUrl` 可用则为 `[searxng]`，否则为 `[duckduckgo, marginalia]`。不可用的来源和重复项会被丢弃 |
| `timeout` | `10000` | 每个来源的超时（毫秒），覆盖请求及其响应正文 |
| `maxResults` | `10` | 单次搜索来源数量的上限，取值 1 到 100，在调用方自身的 `maxResults` 之下生效 |

生成的[配置目录](../../../docs/config-catalog.zh.md)在为本包重新生成后列出所有可接受字段。

### 来源与隐私

每个请求都发送常见的桌面浏览器 `User-Agent`，不发送 cookie、referrer 或安装标识，拒绝重定向，并经过进程级调度器，因此 [`dsh-http-proxy`](../../util/http-proxy/README.zh.md) 安装的出站代理同样生效。每个来源仍然能看到查询内容以及调用方（或代理）的 IP 地址。

- **DuckDuckGo** —— 服务端渲染的 `https://html.duckduckgo.com/html/` 页面，以表单 POST 发送，使查询不出现在 URL 中。DuckDuckGo 没有官方搜索 API：本提供方读取结果标记，把 `//duckduckgo.com/l/?uddg=` 重定向链接解码为目标地址，并跳过广告（`result--ad` 块与 `/y.js` 链接）。DuckDuckGo 会限制自动化流量；HTTP 202、403、429 以及其机器人验证页都视为限流。
- **Marginalia** —— 使用共享 `public` 密钥访问 `https://api2.marginalia-search.com/search`，无需注册，但与该密钥的所有其他用户共享同一速率限制；HTTP 429 或 503 视为限流。Marginalia 是一个小型独立索引，偏重非商业、以文字为主的网站，因此能回答的主流查询较少。其结果以 CC-BY-NC-SA 4.0 授权；有商业用途的部署需要向 Marginalia 申请自己的密钥与条款。
- **SearXNG** —— `GET {searxngUrl}/search?q=…&format=json`。自托管实例可获得最佳隐私：由实例而非第三方决定哪些引擎能看到查询。当 `settings.yml` 的 `search.formats` 中缺少 `json` 时，SearXNG 返回 HTTP 403；本提供方会在报告中指出需要修改的设置。

### 搜索返回什么

`sources[]` 携带每条结果的 `url`、`title` 与 `snippet`（DuckDuckGo 的结果摘要、Marginalia 的 `description`、SearXNG 的 `content`），以及存在时来自 SearXNG `publishedDate` 的 `publishedAt`。结果保持应答来源的顺序，丢弃没有 http(s) URL 的条目，并按 URL 去重。`content` 始终省略。seam 的结果类型没有标明应答来源的字段，因此搜索不会报告由哪个来源应答；插件会以 debug 级别记录每个来源的失败。

### 失败与恢复

除取消之外的来源失败会让搜索转到下一个来源；空结果也是一种应答，不会触发转移。失败抛出 `WebError`：调用方取消为 `WEB_ABORTED` 并终止整条链，来源限流为 `WEB_SEARCH_RATE_LIMITED`，来源超时为 `WEB_SEARCH_TIMEOUT`，SearXNG 的 HTTP 403 为 `WEB_PROVIDER_MISCONFIGURED`，其他状态码、无法读取的页面或 JSON、超过 2 MB 的正文、被拒绝的重定向及传输失败均为 `WEB_PROVIDER_ERROR`。顺序中只有一个来源时，原样抛出它的失败。所有来源都失败时，一个错误会列出每个来源的失败，并建议稍后重试或配置 SearXNG；所有来源都限流时其代码为 `WEB_SEARCH_RATE_LIMITED`，否则为 `WEB_PROVIDER_ERROR`。没有可用来源时，搜索以 `WEB_PROVIDER_UNAVAILABLE` 失败，且本提供方报告自身不可用，`ctx.web` 不会选择它。

-----

<a id="understand-the-implementation"></a>
## 理解实现

<details>
<summary>实现内部细节——点击展开</summary>

本节解释本提供方背后的设计决策；可观察行为已在[使用本包](#use-this-package)中完整说明。

### 设计理念

- **来源链位于同一个提供方 id 之后。** `ctx.web` 每次搜索只选择一个搜索提供方，提供方之间没有后备机制，而且多个可用提供方在未配置 id 时属于歧义。把各个来源分别注册会要求每个部署都选定其一并失去后备，因此由本提供方负责来源顺序。
- **不依赖 HTML 解析库。** `html.duckduckgo.com` 提供扁平、无脚本的标记；一个带夹具测试的小型标签扫描器即可读取它，无法识别的页面会失败，从而让来源链转向后备，而不是返回空结果。

### 源码地图

| 文件 | 职责 |
|---|---|
| [`src/index.ts`](src/index.ts) | 插件入口：配置 schema 与提供方注册 |
| [`src/provider.ts`](src/provider.ts) | `KeylessSearchProvider`：来源顺序、后备与合并失败 |
| [`src/duckduckgo.ts`](src/duckduckgo.ts) | DuckDuckGo 请求、验证页检测、结果解析与重定向解码 |
| [`src/marginalia.ts`](src/marginalia.ts) | Marginalia 请求与状态处理 |
| [`src/searxng.ts`](src/searxng.ts) | SearXNG 请求、基础 URL 校验与状态处理 |
| [`src/results.ts`](src/results.ts) | JSON `results[]` 应答的映射 |
| [`src/html.ts`](src/html.ts) | 标签扫描、属性解析与实体解码 |
| [`src/transport.ts`](src/transport.ts) | 共享的 HTTP 交换：截止时间、取消、拒绝重定向与正文上限 |

### 搜索路径

一次搜索根据当前选项计算来源顺序，以请求与配置的 `maxResults` 中较小者限制结果数量，并让每个来源在自己的截止时间（与调用方信号合并）下运行。第一个应答的来源返回其结果；每次失败都会写入 debug 日志，并保留用于合并错误。

</details>

-----

<a id="further-exploration"></a>
## 进一步探索

当包级契约不够用时阅读这些页面。它们从共享词汇出发，依次介绍服务、面向模型的工具与设计理由。

- [Web 子系统](../../../docs/subsystems/web.zh.md) —— 完整的搜索请求/结果词汇与错误码。
- [Web 包地图](../README.zh.md) —— web 包家族及其各自职责。
- [dsh-web](../web/README.zh.md) —— 本提供方注册进入的 web 服务。
- [dsh-tool-web](../tool-web/README.zh.md) —— 渲染本提供方来源的面向模型 `web_search` 工具。
- [Web 能力 seam 决策](../../../.agents/notes/implemented/architecture/2026-06-24-web-capability-seam.zh.md) —— 为什么搜索与抓取共享一个提供方选择服务。

-----

<a id="model-experience"></a>
## 模型体验

### 对话工具结果（间接）

#### 模型看到的内容

通过 `dsh-tool-web`，对话模型看到应答来源的 URL、标题、摘要以及 SearXNG 的发布日期，但看不到应答来源的名称。失败以其消息到达模型：来源自身的失败，例如 `DuckDuckGo is rate-limiting searches (HTTP 202 bot challenge)` 或 SearXNG 的 `settings.yml` 指引；所有来源都失败时为 `Web search failed on every source: <failures>. Public sources limit request rates; retry later, or guide the user to configure a SearXNG instance in web-search-keyless.searxngUrl.`

#### Token 影响

注册本身不产生直接 token。结果 token 随返回的来源与摘要增长，每次搜索最多 `maxResults` 条。

#### KV Cache 影响

仅追加；工具结果位于可复用的请求前缀之后，不会使已有 KV cache 条目失效。

## 已知限制与延期工作

<a id="known-limitations-and-deferred-work"></a>


这些限制说明本提供方何时不适用。它们是当前的包约束。

- **公共来源会限流** —— DuckDuckGo 会对自动化流量发起验证，Marginalia 的共享密钥对所有用户只有一个速率限制，因此在没有 SearXNG 时，突发的大量搜索可能以 `WEB_SEARCH_RATE_LIMITED` 失败，直到限制重置。
- **DuckDuckGo 标记可能变化** —— 解析器读取当前的 `html.duckduckgo.com` 标记；页面变化时以 `WEB_PROVIDER_ERROR` 失败并转向 Marginalia，而不是返回结果。
- **Marginalia 结果带有非商业许可** —— 通过共享密钥得到的结果适用 CC-BY-NC-SA 4.0。
- **不报告应答来源** —— `WebSearchResult` 没有元数据字段，因此消费方无法得知由哪个来源应答，也无法为 Marginalia 结果署名。

<a id="dev-note"></a>
### 开发备注

<details>
<summary>维护者工作上下文——点击展开</summary>

无。

</details>
