---
description: "零依赖、浏览器安全的产品标识常量，由 CLI、宿主、桌面端与客户端共享。"
kind: "package-library"
---

# @deepseek-ai/dsh-product

[English](README.md) | 中文

## 概述

`dsh-product` 是产品标识的唯一来源：`PRODUCT_NAME`、`CLI_COMMAND`、`HOME_DIR_NAME`、`PROJECT_DIR_NAME`、`ENV_PREFIX`、`REPOSITORY`、`REPOSITORY_URL`、`DOCS_URL`、`NPM_PACKAGE`、`PROTOCOL_SCHEME`、`DESKTOP_APP_ID` 与 `PLUGIN_INDEX_REPOSITORY`。它没有依赖，可安全地在浏览器代码中导入。

## 目录

- [使用本包](#use-this-package)
- [理解实现](#understand-the-implementation)
- [进一步探索](#further-exploration)
- [已知限制与延期工作](#known-limitations-and-deferred-work)
- [开发备注](#dev-note)

-----

<a id="use-this-package"></a>
## 使用本包

导入常量，而不是硬编码产品名、仓库或主目录：

```ts
import { PRODUCT_NAME, REPOSITORY_URL } from '@deepseek-ai/dsh-product'
```

-----

<a id="understand-the-implementation"></a>
## 理解实现

<details>
<summary>实现细节——点击展开</summary>

### 源码地图

| 文件 | 职责 |
|---|---|
| [`src/index.ts`](src/index.ts) | 产品标识字符串常量 |

</details>

-----

<a id="further-exploration"></a>
## 进一步探索

- [home-paths 包](../home-paths/README.zh.md)——解析此处命名的主目录。

-----

## 已知限制与延期工作

<a id="known-limitations-and-deferred-work"></a>

这些限制说明何时不适合使用这些常量。它们是当前的包约束，而非任务清单。

- **仅在构建时确定**——这些值是编译期字符串，不从环境变量或配置读取，因此下游改名需要修改源码并重新构建。
- **只提供名称，不提供行为**——本包不解析路径、不读取环境变量、也不打开 URL；这些逻辑由 home-paths 等使用方负责。

<a id="dev-note"></a>
## 开发备注

<details>
<summary>维护者的工作上下文——点击展开</summary>

无。

</details>
