---
description: "Web 客户端中 pi-ai 路由的提供商账号：在模型页每张提供商卡片里提供账号区块（OAuth 登录、API 密钥账号、默认账号、账号池与模型选择器开关、模型白名单、用量条），并在输入框提供用量徽标，全部通过 `llmAccounts` Remote。"
kind: "package-reference"
---

# @deepseek-ai/dsh-client-ui-llm-accounts

[English](README.md) | 中文

## 概述

`dsh-client-ui-llm-accounts` 让用户为每个 pi-ai 提供商保存多个具名账号——OAuth 登录（ChatGPT、Claude，以及 pi-ai 提供登录流程的所有其他提供商）和 API 密钥——并显示各订阅的用量。它在模型设置页的每张 pi-ai 提供商卡片中加入账号区块，并在输入框加入用量徽标。账号、账号池与用量由 Host（`dsh-llm-pi-ai`）负责；本包只读取 `llmAccounts.watch`，并通过 `llmAccounts` 的其他方法写入。

## 目录

- [使用本包](#use-this-package)
- [实现原理](#understand-the-implementation)
- [延伸阅读](#further-exploration)
- [模型体验](#model-experience)
- [已知限制与后续工作](#known-limitations-and-deferred-work)
- [开发备注](#dev-note)

-----

<a id="use-this-package"></a>
## 使用本包

Web 组合在 `ui-settings-models` 之后挂载本包。它以 `llm-pi-ai` 为键注册到 `settings.models.provider-card` 席位，因此每张 pi-ai 卡片都会显示该区块，模型页本身无需改动。

### 账号区块

区块按 Host 给出的顺序（默认账号在前）列出该路由的账号。每一行显示：

| 元素 | 行为 |
|---|---|
| 名称与类型 | 别名，否则为 Host 标签，并带类型标签：已登录、API 密钥、环境密钥（卡片自身的 API 密钥字段）或环境凭据（环境中发现的凭据）。已知时在下方显示从令牌得出的邮箱或套餐 |
| 默认 | 「默认」标签，或「设为默认」（`setDefaultAccount`） |
| 健康状态 | 冷却中及恢复所需时间，或需要重新登录；「立即重试」清除冷却（`retryAccountNow`） |
| 加入账号池 | 故障切换是否可使用该账号（`updateAccount` 的 `pooled`） |
| 在模型选择器中显示 | 在选择器中加入按账号区分的模型项（`updateAccount` 的 `pinned`） |
| 模型… | 白名单对话框：全部模型（不存列表，包括以后新增的）或仅勾选的模型（不勾选即为无模型）；通过 `updateAccount` 的 `models` 保存 |
| 用量 | 每个时间窗一条用量条，显示已用比例、重置时间、套餐、额度以及过期或失败标记；已登录账号提供刷新（带 `force` 的 `usage`） |
| 操作 | 重命名（名称留空即清除别名）、OAuth 账号的重新登录，以及可移除账号的移除（需确认） |

提供商支持 OAuth 时显示「使用 … 登录」。「添加 API 密钥」对只需一个密钥值的提供商打开密钥与名称对话框（`addApiKeyAccount`），对需要更多字段的提供商发起 `api-key` 登录尝试。被拒绝的操作会在列表下方显示 Host 的消息。

### 登录对话框

对话框调用 `beginSignIn`，随后跟随 `watchSignIn`。每个提供商链接在新标签页中只自动打开一次（仅限 HTTPS 或回环地址 HTTP），并保留「打开页面」按钮；设备码以大字显示，并提供「复制代码」。待回答的提示渲染为文本、密钥或选择字段——对 `manual_code` 提示，用户粘贴回调 URL，远程或无界面 Host 需要这样做——通过 `answerSignInPrompt` 回答，或以拒绝跳过。尝试授权成功或被取消时对话框关闭，否则显示失败原因；关闭对话框会取消仍在进行的尝试。同一提供商家族上的第二个登录会显示忙碌提示。

### 用量徽标

`conversation.composer.dock` 条目通过模型选择服务跟随会话当前的提供商。它显示正在使用的账号（会话粘滞的账号，否则为默认账号）及其最紧张的时间窗，例如 `ChatGPT · 每周 42%`，点击后打开对话框，列出所有有用量的账号，当前提供商在前。已用/剩余显示模式保存在本浏览器的 `localStorage` 中。在有账号拥有用量读数之前徽标不渲染；未加载模型选择服务时徽标不存在。

### 隐私

用量订阅（`usage: true` 的 `watch`）只在提供商卡片的区块挂载期间，或徽标挂载且页面可见期间保持；Host 只在存在订阅时请求用量端点。API 密钥只向 Host 传输一次，从不显示或返回。

-----

<a id="understand-the-implementation"></a>
## 实现原理

<details>
<summary>实现细节——点击展开</summary>

`AccountsWatcher` 为每个观察者（设置页，或某个会话的徽标）维护一个快照存储和引用计数；第一次持有时通过 `remote.$stream` 打开可重连的 `llmAccounts.watch`，最后一次释放时关闭，存储保留最后一个快照。`createAccountsOperations` 把每个 Remote 调用转换为 `Outcome`（`busy`、`invalid-key` 或 Host 文本），组件不会看到 Remote 错误码。白名单对话框从 `session.modelCatalog` 读取路由的模型，排除固定的 `~acct:` 条目，并保留目录中已不再提供但账号已列出的 id。

| 文件 | 作用 |
|---|---|
| [`src/client/index.ts`](src/client/index.ts) | 词典与两个插槽注册 |
| [`src/client/store.ts`](src/client/store.ts) | 引用计数的 `watch` 订阅 |
| [`src/client/operations.ts`](src/client/operations.ts) | Remote 绑定与结果 |
| [`src/client/AccountsSection.tsx`](src/client/AccountsSection.tsx) | 区块、行、重命名与移除对话框 |
| [`src/client/SignInDialog.tsx`](src/client/SignInDialog.tsx) | 登录尝试对话框 |
| [`src/client/ApiKeyDialog.tsx`](src/client/ApiKeyDialog.tsx) | 仅密钥账号对话框 |
| [`src/client/ModelsDialog.tsx`](src/client/ModelsDialog.tsx) | 模型白名单编辑器 |
| [`src/client/UsageBars.tsx`](src/client/UsageBars.tsx) | 用量时间窗 |
| [`src/client/UsageBadge.tsx`](src/client/UsageBadge.tsx) | 输入框徽标及其对话框 |
| [`src/client/format.ts`](src/client/format.ts) | 纯显示辅助函数 |
| [`src/client/locales.ts`](src/client/locales.ts) | 词典（de、en、es、fr、ja、pt、ru、zh） |

</details>

-----

<a id="further-exploration"></a>
## 延伸阅读

- [llm-pi-ai](../../llm/llm-pi-ai/README.zh.md)——账号、账号池故障切换、用量来源与 `llmAccounts` Remote。
- [模型设置](../ui-settings-models/README.zh.md)——提供商卡片及其扩展席位。
- [模型选择](../ui-model-selection/README.zh.md)——徽标所跟随的会话模型目录。

-----

<a id="model-experience"></a>
## 模型体验

无；本包是设置页与输入框界面，不增加模型输入。

#### KV Cache 影响

无；界面不发送提供商请求。切换正在使用的账号由 Host 决定，见 `llm-pi-ai` 文档。

## 已知限制与后续工作

<a id="known-limitations-and-deferred-work"></a>

- 白名单对话框从当前模型目录列出路由的模型；当所有账号都排除某个模型时，目录不再提供它，对话框只会显示账号已列出的 id。
- 账号顺序（`order`）没有编辑器；Host 按默认账号、再按创建时间排序。
- 剩余时间在快照渲染时计算，随下一个推送的快照刷新。

<a id="dev-note"></a>
### 开发备注

<details>
<summary>维护者工作上下文——点击展开</summary>

客户端测试用英文词典和假的操作渲染界面，用 `dsh-remote-mock` 驱动 `AccountsWatcher` 与操作，并用假上下文检查插槽注册。

</details>
