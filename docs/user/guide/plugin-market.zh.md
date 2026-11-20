# 插件索引

[English](plugin-market.md) | 中文

## 概述

插件索引是一个 JSON 文件，列出可安装的 Stitch 组合包（bundle）及其标题、图标、作者和版本。插件页的**发现**标签页用于浏览索引，并在确认后安装列出的版本。要发布索引，编写或生成一个索引文件，并把它和图标文件一起放到任意静态主机上。

## 目录

- [打开「发现」](#turn-on)
- [浏览和安装](#browse-and-install)
- [运行 DeepSeek Harness 插件](#deepseek-harness-plugins)
- [Claude Code 与 Codex 子智能体](#claude-code-and-codex)
- [发布索引](#publish-an-index)
- [用参考生成器生成索引](#generate-an-index)
- [索引格式参考](#index-format)
- [延伸阅读](#further-exploration)

<a id="turn-on"></a>
## 打开「发现」

打开**插件**，选择**已安装**旁边的**发现**，或在侧栏中选择**更多 → 浏览更多插件**。每个 Web profile 都有该标签页。如果想让 Creator 模式下的智能体用只读的 `plugin_market` 工具替你搜索索引，请在插件页选择**显示高级项**并打开**供智能体使用的插件市场工具**；它默认关闭，以保持智能体的指令简短。

「发现」一开始只列出 Stitch 插件索引；在你打开之前不会请求它。它没有收录插件时，「发现」会说明这一点并推荐社区索引。**管理索引源…**的**社区索引**下提供两个来自 DeepSeek Harness 社区的索引：**DeepSeek Harness 精选插件**（`https://awesome-dsh-plugin.com/index.json`）和 **DeepSeek Harness 插件市场**（`https://cdn.dsh.so/market/index.json`）。要添加其他索引，点击**添加索引源**，输入一个索引文件的 URL。URL 必须使用 `http:` 或 `https:`，并且不能包含用户名、密码或 `#` 片段。网络路径上的任何人都能修改 `http:` 索引，包括其中列出的安装 spec，因此经由不受你控制的网络访问的索引应使用 `https:`。每个索引源属于当前 profile。

<a id="browse-and-install"></a>
## 浏览和安装

工具栏左侧的索引菜单用于切换索引源，并可打开**管理索引源…**，其中每个索引源显示它最近一次的错误。搜索匹配名称、作者、关键词，以及所有语言的标题、描述、分类和标签，并容忍拼写错误；在你选择其他排序之前，结果按最佳匹配排序。**标签**菜单、分类按钮和**排序**菜单使用索引声明的分类、标签和排序键，**发布时间**按每个插件最新版本的时间排序。

每张卡片显示插件的推荐版本：与当前运行的 Stitch 兼容、且不是预发布版本的最高版本；插件没有列出任何非预发布版本时，则是兼容的最高预发布版本。**安装**会打开确认框，显示该版本的来源：npm 包和注册表，或 Git 仓库、提交和目录。确认后开始常规的插件安装，包括其中的兼容性检查和注册表检查；未经确认不会安装任何内容。

选择卡片会打开插件页面。**版本**列表显示列出的每个版本及其兼容性，并为 Stitch 接受的任何版本提供**安装**，包括旧版本和预发布版本。显示**已安装**、**有新版本**或**随 Stitch 提供**的卡片会改为打开已安装的组合包。

索引是第三方内容。每个插件的标题、描述、图标、作者和来源都由索引决定；Stitch 检查文件格式，但不验证这些声明。Stitch 索引以外的每个索引都标为**社区来源 — 未经 Stitch 审核**，它给出的评判（例如低风险或安装已验证标签）会注明出自该索引（“由……评为低风险”），而不会显示为 Stitch 的结论。社区卡片还会说明插件是否为 DeepSeek Harness 制作、是否需要其他 Stitch 版本，或是否未说明支持哪些 Stitch 版本。只添加你信任的索引源，并在安装前核对确认框中的来源。

<a id="deepseek-harness-plugins"></a>
## 运行 DeepSeek Harness 插件

Stitch 可以运行为 DeepSeek Harness（DSH）编写的插件。可以在「发现」中安装，也可以在命令行安装：

```sh
stitch plugin --profile web add <package>
```

一个小型兼容层让这些插件无需修改即可运行：

- **环境变量。** 当 `STITCH_HOME`、`STITCH_AGENTS_HOME` 或 `STITCH_PERMISSION_MODE` 等 `STITCH_` 变量未设置时，Stitch 会改为读取其 `DSH_` 拼写；`STITCH_` 值始终优先。shell 命令和终端会收到与 `STITCH_SESSION_ID`、`STITCH_WEB_URL` 值相同的 `DSH_SESSION_ID` 和 `DSH_WEB_URL`，插件除了 `STITCH_*` 之外也可以注册名为 `DSH_*` 的 shell 变量。
- **Skill。** 已存在的 `~/.dsh/skills` 或 `<project>/.dsh/skills` 目录中的 skill 可以使用。Stitch 只读取这些目录，从不创建它们；同名时 Stitch 的 skill 胜出。
- **索引。** 「发现」提供 DeepSeek Harness 社区索引，见[打开「发现」](#turn-on)；默认不会添加它们。

有些插件仍然无法工作：

- 硬编码 `~/.dsh` 的插件会把数据留在那里，而不是 `~/.stitch` 下。
- Harness peer 范围是精确版本或低于 `0.2.0` 的插件无法通过兼容性检查。若仍要安装，用 `stitch plugin --profile web allow-version <package@version> --stitch-version <exact> --accept-risk` 批准这一确切的版本组合。
- 运行 `dsh` 可执行文件的插件会失败，因为 Stitch 只安装 `stitch`。
- 依赖 DeepSeek 服务或 Stitch 已删除的 DeepSeek Harness 包的插件无法工作。

<a id="claude-code-and-codex"></a>
## Claude Code 与 Codex 子智能体

**Claude Code 子智能体**和 **Codex 子智能体**插件运行真实的 Claude Code 或 Codex 程序，Stitch 不随附这些程序。每个插件页面都有**程序**区域，显示 Stitch 找到的副本：你自己的安装（例如通过 `npm install -g @anthropic-ai/claude-code` 或 `npm install -g @openai/codex` 安装）、Stitch 下载的副本，或者没有。没有找到或你的版本过旧时，选择**下载**把锁定版本（约 200–400 MB）获取到 Stitch 主目录；**移除**只删除这份下载。打开插件从不下载任何内容；没有程序时委派会失败，并给出安装方法。

<a id="publish-an-index"></a>
## 发布索引

索引是 UTF-8 编码的 JSON 文件，默认不超过 128 MiB，以 2xx 状态码返回且不经过重定向。把它放到任意静态主机上即可，例如 GitLab Pages、GitHub Pages，或通过 https 访问的对象存储。

图标可以内联，也可以是单独的文件。内联图标是索引中的 base64 `data:` URL；它不需要额外请求，但会使索引变大。单独的图标是一个 URL。相对图标相对于索引 URL 解析，与网页中的图片相对于页面解析的方式相同：对于位于 `https://market.example/dsh/index.json` 的索引，`"icon": "icons/foo.svg"` 会加载 `https://market.example/dsh/icons/foo.svg`。因此把索引和 `icons/` 目录并排发布，在任何主机上都能使用，无需修改文件。指向其他源（协议、主机和端口）的绝对图标 URL 必须使用 `https:`。

下面是一个最小的索引，包含一个 npm 插件和一个来自 Git monorepo 的插件：

```json
{
  "format": 1,
  "title": { "en": "Team plugins", "zh": "团队插件" },
  "plugins": [
    {
      "name": "dsh-plugin-foo",
      "title": "Foo",
      "description": "Adds the foo tool",
      "icon": "icons/foo.svg",
      "author": "Jane Doe",
      "homepage": "https://github.com/jane/dsh-plugin-foo#readme",
      "repository": { "url": "https://github.com/jane/dsh-plugin-foo" },
      "versions": [
        { "version": "1.1.0", "publishTimestamp": 1790476800, "source": { "type": "npm" }, "engines": { "dsh": ">=0.2.0-rc.2" } },
        { "version": "1.0.0", "publishTimestamp": 1788000000, "source": { "type": "npm" } }
      ]
    },
    {
      "name": "@team/dsh-bar",
      "versions": [
        {
          "version": "0.3.0",
          "publishTimestamp": 1789000000,
          "source": {
            "type": "git",
            "url": "https://gitlab.example.com/team/dsh-plugins",
            "commit": "3f9c2e1d8a4b6c0e7f1a2b3c4d5e6f708192a3b4",
            "path": "packages/bar"
          }
        }
      ]
    }
  ]
}
```

违反下列任何一条规则时，Stitch 会拒绝整个索引，并在**管理索引源…**中该索引源下方显示原因及违规值的 JSON 路径。

<a id="generate-an-index"></a>
## 用参考生成器生成索引

仓库包含一个[参考生成器](../../../apps/plugin-market-generator/README.zh.md)，可以从一份纯文本列表构建索引。每行写一个 npm 包名或 https Git 仓库 URL；空行和以 `#` 开头的行会被忽略：

```text
@team/dsh-foo
https://gitlab.example.com/team/dsh-plugins
```

在 Stitch 代码仓库中运行它：

```sh
pnpm --filter @deepseek-ai/dsh-plugin-market-generator start --input plugins.txt --output site/index.json --title "Team plugins"
```

对于 npm 包，索引列出所有未弃用、未设为私有且声明了 `dsh.bundle` 的版本。对于 Git 仓库，生成器在默认分支上查找 `package.json` 没有设置 `"private": true` 的组合包，列出它们在 `vX.Y.Z`、`X.Y.Z` 和 `<name>@X.Y.Z` 标签处的版本，以及每个包在默认分支上的版本。标题、描述、图标、作者和主页取自每个插件的最高版本。路径相对于你运行 pnpm 的目录。

生成器只下载和读取文件，从不安装包或运行其代码。它在列表旁的 `.plugin-market-cache` 中保存包数据，并复用未变更的版本和提交。每次运行仍会读取源文档或 Git 引用，并刷新已启用的指标；不可用的指标值会被省略。设置 `GITHUB_TOKEN` 以采集 GitHub star 数；没有非空白令牌时，不会发起 GitHub 指标请求，也不会输出 `github_stars`，但 npm 周下载量仍保持启用。按上文所述发布输出目录，即 `index.json` 及其 `icons/` 目录。

<a id="index-format"></a>
## 索引格式参考

标为 `LocalizedText` 的文本字段是字符串，或以小写语言 id 为键的字符串对象，例如 `{ "en": "Foo", "zh": "甲" }`；对象必须包含 `en`。Stitch 在每一层都忽略未知的对象字段。已知字段和 `source.type` 仍须具有有效值；声明映射、本地化文本映射和插件排序值映射中的键作为数据进行校验。

| 索引字段 | 必填 | 含义 |
|---|---|---|
| `format` | 是 | `1`。 |
| `title`、`description` | 仅 `title` | 索引名称和描述，类型为 `LocalizedText`。 |
| `metadata.categories`、`metadata.labels` | 否 | 将 id 映射为 `{ "title": LocalizedText }` 的对象。 |
| `metadata.sortKeys` | 否 | 将 id 映射为 `{ "title": LocalizedText, "order": "asc" \| "desc" }` 的对象；`order` 是初始方向。 |
| `plugins` | 是 | 按发布者的默认顺序排列的插件；客户端必须在初次展示和筛选时保留此数组顺序，除非用户选择其他排序方式，或文本搜索按相关性排序。 |

| 插件字段 | 必填 | 含义 |
|---|---|---|
| `name` | 是 | npm 包名，在索引内唯一。 |
| `title`、`description` | 否 | `LocalizedText`；没有标题时卡片显示 `name`。 |
| `icon` | 否 | 内联 `data:` URL（SVG、PNG、JPEG 或 WebP，不超过 32 KiB）或 URL，见上文。 |
| `author` | 否 | 显示文本。 |
| `homepage` | 否 | 介绍该插件的页面的绝对 `https:` 或 `http:` URL；插件页面会链接到它。 |
| `repository` | 否 | `{ "url": string, "directory"?: string }`：源代码仓库的网页，以及包在其中的目录。插件页面以**源代码**链接到它。 |
| `metadata.category` | 否 | 一个已声明的分类 id。 |
| `metadata.labels` | 否 | 已声明的标签 id。 |
| `metadata.sortKeys` | 否 | 将已声明的排序键 id 映射为有限数值的对象；不可用时值为 `null`。 |
| `versions` | 是 | 至少一个版本，顺序不限。 |

插件可以省略 `metadata`、其中的任意字段或单个排序值，也可以用 `null` 表示数据不可用。无论升序还是降序，缺失值都排在最后；实际的零是有效值，不是缺失数据。建议采用的统一定义是：`github_stars` 表示仓库的 GitHub star 数，`npm_weekly_downloads` 表示公共 npm 包在 npm `last-week` 时间窗口内的下载量。两者均为非负整数；周下载量不是月下载量。发布者使用这些键时，在根级 `metadata.sortKeys` 中声明，并在各插件的 `metadata.sortKeys` 中填入可用值。其他已声明的数值键仍受支持。

| 版本字段 | 必填 | 含义 |
|---|---|---|
| `version` | 是 | 精确的 SemVer 版本，在插件内唯一。 |
| `publishTimestamp` | 是 | 发布时间，Unix 秒。 |
| `source` | 是 | `{ "type": "npm", "registry"?: url }`，或 `{ "type": "git", "url": https-url, "commit": 40 位十六进制 SHA, "path"?: 目录 }`。 |
| `engines.dsh` | 否 | 该版本可运行的 Stitch 版本的 SemVer 范围；缺省表示任意版本。 |

Stitch 将 npm 版本安装为 `name@version`，存在 `registry` 时先询问它；将 Git 版本安装为 `git+<url>.git#<commit>`，包位于子目录时追加 `&path:/<path>`。`engines.dsh` 应与包自身的 `engines.dsh` 一致，Stitch 会在安装时再次检查；没有该字段的包改为按其 `@deepseek-ai/dsh*` peer 依赖检查。[格式说明](../../../.agents/notes/implemented/feature/2026-10-02-plugin-market-index-format.zh.md)定义了全部规则。

<a id="further-exploration"></a>
## 延伸阅读

- [「发现」标签页参考](../../../packages/client/ui-plugin-market/README.zh.md)说明该标签页的控件和状态。
- [插件索引服务](../../../packages/boot/plugin-market/README.zh.md)说明获取限制、缓存和 `plugin_market` 工具。
- [索引校验器](../../../packages/util/plugin-market-index/README.zh.md)是生成器可以用来在发布前检查索引的库。

## 开发备注

无。
