---
description: "为产品子智能体提供方与插件管理器查找可用的 Claude Code 或 Codex 可执行文件，或把锁定版本的原生 CLI 下载到 Stitch 主目录。"
kind: "package-reference"
---

# @deepseek-ai/dsh-product-cli

[English](README.md) | 中文

## 概述

使用 `@deepseek-ai/dsh-product-cli` 定位产品子智能体运行的原生 Claude Code 或 Codex 可执行文件。Stitch 安装不捆绑这些 CLI；本包依次解析显式配置的路径、Stitch 先前下载的副本或用户自己的安装，并报告因版本过旧而被拒绝的候选。收到显式请求时，它下载锁定版本的 npm 平台包，在解包前校验 sha512 完整性，并原子地安装到 `$STITCH_HOME/data/product-cli` 下。以库的形式导入；不能从 `cordis.yml` 挂载。

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

[Claude Code](../subagent-claude-code/README.zh.md) 与 [Codex](../subagent-codex/README.zh.md) 提供方在每次运行前调用 `resolveProductCli`；[插件管理器](../../boot/plugin-manager/README.zh.md)为插件页调用状态、下载与移除函数。

<a id="resolution-order"></a>
### 解析顺序

`resolveProductCli(id, options)` 按以下顺序返回第一个可用候选：

| 顺序 | 来源 | 位置 |
|---|---|---|
| 1 | `configured` | 提供方的 `executablePath`；已设置但不存在时，解析停止并报告 `configuredMissing` |
| 2 | `downloaded` | `$STITCH_HOME/data/product-cli/<id>/<package version>/` |
| 3 | `installed` | 绝对路径形式的 `PATH` 条目，然后是常见安装目录，例如 `~/.local/bin`、`/opt/homebrew/bin`、`/usr/local/bin`、npm 全局前缀、`~/.claude/local`（仅 Claude Code），以及 Windows 上的 `%APPDATA%\npm`、`%LOCALAPPDATA%\Programs\<command>` 与 WinGet 链接 |
| 4 | `bundled` | 开发检出或 CLI 安装中 SDK 旁的原生平台包 |

每个已安装候选都会运行 `--version`；低于最低版本（Claude Code 2.1.263、Codex 0.153.4）的候选记入 `tooOld` 并跳过。npm 的 `.cmd` 与 `.ps1` 垫片会追溯到包的 `bin` 入口，JavaScript 入口由 Stitch 自带的 Node 运行。没有合格候选时，结果为 `found: false`。

### 状态、下载与移除

| 函数 | 行为 |
|---|---|
| `productCliStatus(id)` | 供 UI 使用的状态：来源、路径、版本、被拒候选以及本平台的下载信息；忽略 `executablePath` 与检出副本；从不访问网络 |
| `downloadProductCli(id, options)` | 仅在调用时下载；按顺序尝试每个 registry，报告进度，并接受中止信号 |
| `removeProductCli(id)` | 只删除 `$STITCH_HOME/data/product-cli/<id>`；绝不触碰用户自己的安装 |
| `productCliMissingMessage(resolution)` | 解析失败时面向用户和模型的文本 |

darwin、linux 与 win32 的 arm64 和 x64 平台提供下载。下载失败原因为 `network`、`integrity`、`unsupported-platform`、`filesystem`、`busy` 与 `cancelled`。

-----

<a id="understand-the-implementation"></a>
## 理解实现

<details>
<summary>实现细节——点击展开</summary>

### 源码地图

| 文件 | 职责 |
|---|---|
| [`src/catalog.ts`](src/catalog.ts) | 锁定的包名、版本、sha512 完整性、体积、最低版本与安装命令 |
| [`src/resolve.ts`](src/resolve.ts) | 候选搜索、版本探测与垫片追溯 |
| [`src/download.ts`](src/download.ts) | registry 获取、完整性校验、解包与原子安装 |
| [`src/store.ts`](src/store.ts) | `$STITCH_HOME/data/product-cli` 下的存储路径 |
| [`src/types.ts`](src/types.ts) | 面向远程调用的状态记录，以 `./types` 导出 |
| [`src/index.ts`](src/index.ts) | 状态与缺少 CLI 的提示文本 |

### 完整性与原子安装

锁定的完整性值是 `pnpm-lock.yaml` 中记录的 npm `dist.integrity`；子智能体包的测试断言二者一致。tarball 以流的方式写入存储根目录中的 `.download-<uuid>.tgz`，同时计算 sha512，哈希必须匹配后才会解包。归档解包到 `.staging-<uuid>` 目录，检查可执行文件并设置可执行权限，然后一次重命名发布版本目录。随后删除同一 CLI 的其他版本，临时文件总会被删除。由于完整性已锁定，备用 registry 无法替换成不同的字节。

### 版本探测

`--version` 以 15 秒超时运行，结果按文件修订缓存，因此重复运行不会重新探测未变化的可执行文件。在 Windows 上环境变量名不区分大小写，并会尝试 `PATHEXT` 扩展名与 `.ps1`。

</details>

-----

<a id="further-exploration"></a>
## 进一步探索

- [Claude Code 子智能体提供方](../subagent-claude-code/README.zh.md)——在每次 SDK query 前解析可执行文件。
- [Codex 子智能体提供方](../subagent-codex/README.zh.md)——在启动 app-server 前解析可执行文件。
- [插件管理器](../../boot/plugin-manager/README.zh.md)——向客户端公开状态、下载、取消与移除。
- [Subagent seam](../subagent/README.zh.md)——定义 `PRODUCT_CLI_UNAVAILABLE` 错误码。

-----

<a id="model-experience"></a>
## 模型体验

### 缺少 CLI 的工具错误（间接）

#### 模型看到什么

提供方找不到可用的可执行文件时，`subagent_claude_code` 或 `subagent_codex` 以 `PRODUCT_CLI_UNAVAILABLE` 错误失败，其文本为 `productCliMissingMessage`：安装建议、下载体积、安装命令，以及每个过旧已安装版本各一句说明。配置的 `executablePath` 不存在时，消息改为指出该路径。

##### Missing Claude Code

```markdown
Claude Code isn't installed. Install it from Plugins → Claude Code subagent → Download (about 199 MB), or install it yourself: npm install -g @anthropic-ai/claude-code, then retry.
```

#### Token 影响

每次失败的委派使父级输入增加一条简短工具错误。本包不产生其他模型输入。

#### KV Cache 影响

工具错误追加在可复用的父请求前缀之后，不会改写前缀。

## 已知限制与延期工作

<a id="known-limitations-and-deferred-work"></a>


这些限制是当前包约束，不是任务积压。

- **每个 CLI 只锁定一个版本**——下载只安装目录中的版本；更新的用户安装按发现结果使用，更旧的会被拒绝。
- **不会自动下载**——启用 bundle 或委派失败都不会下载；由用户在插件页发起。
- **除 npm 完整性外没有签名校验**——信任基于锁文件中锁定的 sha512。
- **并发控制限于单个进程**——同一进程中对同一 CLI 的第二次下载以 `busy` 失败；不同进程之间不做协调。

<a id="dev-note"></a>
### 开发备注

<details>
<summary>维护者的工作上下文——点击展开</summary>

- **升级锁定版本**——提供方 SDK 或协议升级时，目录中的版本、完整性值、体积与最低版本需与 `pnpm-lock.yaml` 一同更新。

</details>
