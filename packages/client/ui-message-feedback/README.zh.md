---
description: "Web 反馈界面：已定稿助手消息动作行中的 Like/Dislike 对、两种评分与 `/feedback` 共用的反馈弹窗，以及确认和失败 toast；供反馈体验的用户与维护者阅读。"
kind: "package-reference"
---

# @deepseek-ai/dsh-client-ui-message-feedback

[English](README.md) | 中文

## 概述

本包是 Web GUI 的反馈界面：已定稿助手消息动作条中的 Like/Dislike 对、输入框浮层中的反馈弹窗及其确认与失败 toast，以及让不带文本的 `/feedback` 打开弹窗的装饰。点赞和点踩都会打开弹窗，先收集分类与可选描述，再把所选评分作为备注保存在本机；除非用户另外在 GitHub 上报告，否则不会发送任何内容。每个 Session 一个 surface 支撑所有条目，因此一次列表读取即可填充整段对话，一个弹窗同时服务 Session 与其消息。评分、分类与备注是仅写日志的 Session 事件，绝不进入模型上下文。

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

与 `ui-conversation`、`ui-commands` 一起挂载本插件；Like/Dislike 对随即出现在每个轮次收尾助手消息的动作行中，位于复制与分支之间，输入框菜单里的「反馈」会打开同一个弹窗。挂载 `session-log-export` 后，会话标题栏的更多操作菜单也会增加「反馈」。评分图标在默认内容字号下使用 16px 框，与相邻的收尾操作匹配，轮廓描边保持 1px。已记录的评分显示实心图标，不需要悬停也一直可见。点赞和点踩都会打开**留下反馈**弹窗：七个分类标签和一个详情框都可不填；**保存备注**会记录带所填内容的对应评分。按钮下方的一行说明备注只保存在本机、不会发送任何内容，toast 也会重申这一点，并提示用**在 GitHub 上报告**告知 Stitch 团队。再次点击已记录的评分会直接撤回，不打开弹窗。不带文本的 `/feedback`，无论是从菜单选中还是直接输入后发送，都会为 Session 打开同一个弹窗；`/feedback <text>` 仍走宿主命令路径并显示确认行。

### 在 GitHub 上报告

「保存备注」下方的**在 GitHub 上报告…**会把弹窗切换为议题预览。第一行说明报告会在 `github.com/<repository>` 上创建一个任何人都能看到的公开议题，仓库名取自宿主 [`sessionFeedback.draftIssue`](../../feedback/command-feedback/README.zh.md#reporting-on-github) 的回复（`Morrowmake/stitch-harness`），并说明在用户选择操作之前不会发送任何内容。可编辑标题下方，正文——评价以及列出分类、Stitch 版本与操作系统的详情列表——以排版后的文本显示；**编辑文本**切换为原始 Markdown 输入框，**显示预览**切换回来。**附带会话 ID**复选框默认关闭，用于添加或移除一行 `- Session id: …`。两个操作会发送报告，都会先像「保存备注」一样记录反馈：主操作**在 GitHub 上打开**在新标签页中打开预填的新议题页面，绝不运行 `gh`；**用我的 GitHub 账号提交**下方注明它使用本机已登录的 GitHub 命令行应用（`gh`），会直接创建议题并打开，若 `gh` 缺失、未登录或失败，则打开预填页面并以 toast 提示在那里完成。**返回**会回到表单并保留草稿。宿主已记录的 `/feedback <text>` 会为该文本打开同一个预览；发送时只提交议题、不再重复记录评价，关闭则不发送任何内容。

### 失败

评分或列表加载失败在行内展示；提交失败通过警告 toast 展示，弹窗保持打开以便修正草稿。只有已定稿的消息能到达消息条目——被中断冻结的部分输出不带 `messageId`，因此没有反馈控件。

访问控制：评分按钮只在当前 Peer 可以在该会话上调用 `messageFeedback/put` 时渲染；`/feedback` 装饰不做前端判断，没有权限时提交由 Host 拒绝。

-----

反馈弹窗使用共享弹窗的标题间距。分类选项组成紧凑分组，补充说明作为独立字段；「保存备注」操作与字段的分隔大于输入组内间距；「保存备注」与「用我的 GitHub 账号提交」下方的单行说明使用说明文字颜色。

<a id="understand-the-implementation"></a>
## 理解实现

<details>
<summary>实现细节——点击展开</summary>

本包贡献 `conversation.chat.assistant-actions` 的 `feedback` 条目（order 10），由 ui-conversation 声明并渲染在已定稿助手消息的 IconActions 行内；同时贡献 `conversation.input.overlay` 的 `feedback-dialog` 条目（order 2），它通过 body portal 渲染 Modal 与 Toast 基元，并让 toast 以其所在的输入框卡片为中心。`feedbackUi.openSession(sessionId)` Client 服务打开同一个 Session 级弹窗，不记录反馈；标题栏菜单和命令装饰共用此方法。`/feedback` 装饰是经 `ctx.commandUi.decorate` 注册的 `action`，因此菜单选中或不带参数的回车会消费触发 token 并打开弹窗，而带参数的命令行仍到达宿主命令。

每个 Session 有一个 `MessageFeedbackController` 支撑所有消息控件，以及一个 `FeedbackDialogController` 拥有弹窗草稿、提交与 toast 序号。消息控制器只读取一次 `messageFeedback.list`，且延迟到首次 hover 或 focus 才发起，而非挂载时触发；变更串行执行，每次都携带最后观察到的版本，`version-conflict` 响应带回权威条目，据此对账视图而不重新拉取。任一评分操作执行前，该行都会检查已提交条目：评分相同则调用 `retract`，它会在串行队列内重新检查评分并在并发变更后变为无操作；其他状态则携带所选评分打开弹窗。弹窗控制器按目标提交：消息目标通过消息控制器 put 一条带弹窗备注与分类的对应评分，Session 目标通过 `ctx.remote.sessionFeedback` 记录。成功会关闭草稿并弹出确认 toast；被替换的旧草稿迟到的成功只弹确认 toast、不关闭新草稿；失败会保留弹窗并弹出停留时间更长的警告 toast。

弹窗控制器的议题预览通过 `sessionFeedback.draftIssue` 起草，并保存标题、正文、目标仓库、会话 ID 选项、最近选择的方式以及评价是否已记录。每个发送操作在需要时先记录，并把预览标记为已记录，使报告失败后的重试不会重复记录，然后以 `via: 'browser'` 或 `via: 'github-cli'` 调用 `sessionFeedback.reportIssue`；`github-cli` 请求得到 `browser` 回答时，会弹出在 GitHub 上完成的 toast。只打开 `https://github.com/` 开头的回答，并使用 `noopener,noreferrer`。预览通过共享的 `MarkdownText` 原语渲染正文。已输入评价的预览监听 [ui-commands](../ui-commands/README.zh.md) 的 `command/executed` 事件中成功的 `feedback` 命令，从提交的命令行中取出评价。

</details>

-----

<a id="further-exploration"></a>
## 进一步探索

当反馈界面不够用时阅读以下页面。它们从浏览器条带进入 Session 日志后端与会话外壳。

- [dsh-message-feedback](../../feedback/message-feedback/README.zh.md)——拥有按条目比较并交换与持久化的 Session 日志后端。
- [dsh-command-feedback](../../feedback/command-feedback/README.zh.md)——`/feedback` 命令、`sessionFeedback` Remote 与分类表。
- [ui-commands](../ui-commands/README.zh.md)——`/feedback` 行所经过的命令装饰约定。
- [ui-conversation](../ui-conversation/README.zh.md)——声明助手动作条与输入框浮层。
- [客户端包映射](../README.zh.md)——相邻的浏览器 UI 包。

-----

<a id="model-experience"></a>
## 模型体验

无。评分、分类与备注是仅写日志的事件，不是模型输入。可选的 Session 日志投递使用请求元数据，而非模型上下文。

#### KV Cache 影响

无；反馈变更不改变模型可见的历史。

## 已知限制与延期工作

<a id="known-limitations-and-deferred-work"></a>


这些限制界定了当前反馈界面。它们是当前包约束，不是通用评分对比或任务积压。

- **备注大小是宿主策略**——部署方配置 `maxNoteBytes`（Web bundle 中为 8192），超长备注由宿主以 `note-too-large` 拒绝。弹窗不预先校验该上限，因此针对消息的超长描述在提交时才失败，而不是在输入过程中；Session 级备注没有上限。
- **无跨标签页推送**——另一个标签页的评分要等到重连或下一次冲突响应才可见，不会立即出现；控制器不消费反馈日志事件。
- **仅限对话视图**——trajectory 与 waterfall 视图不渲染反馈控件，尽管它们的助手节点也带有相同的 `messageId`。
- **弹窗拦截**——GitHub 页面在宿主回答之后才打开，已不在点击的用户手势之内，严格的弹窗拦截可能阻止它；成功 toast 仍会显示。

<a id="dev-note"></a>
### 开发备注

<details>
<summary>维护者的工作上下文——点击展开</summary>

无。

</details>
