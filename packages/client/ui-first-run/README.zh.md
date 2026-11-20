---
description: "Stitch Web 客户端与桌面应用的首次运行设置：提供商选择（优先本地 AI——本机的 Ollama 和 LM Studio，或局域网、tailnet 中任意 OpenAI 兼容端点——然后是订阅与 API 访问，常用提供商在前）与默认模型，随后是标准 / 自定义组件选择，也可从插件页面和“设置 → 模型”打开。"
kind: "package-reference"
---

# @deepseek-ai/dsh-client-ui-first-run

[English](README.md) | 中文

## 概述

`dsh-client-ui-first-run` 为新的配置档完成一次设置：选择请求发往何处、选择默认模型、选择 Stitch 运行哪些组件。之后同一对话框可从插件页面（“选择组件…”）和“设置 → 模型”（“设置提供商…”）再次打开。桌面应用同样显示它，因为它渲染在 Web UI 的 shell 浮层中，不涉及原生窗口。

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

Web 组合以 `ui-first-run` 行挂载本包。该行 id 同时是它的设置命名空间，其中唯一的实时字段 `completedVersion` 记录首次运行已完成或已关闭。

### 对话框何时打开

| 入口 | 步骤 |
|---|---|
| 首次运行（自动；每个配置档一次，条件是 `completedVersion` 与当前流程版本不同且设置可写） | 提供商 → 默认模型 → 组件 → 完成 |
| 插件页面“添加插件”菜单 → **选择组件…** | 组件 → 完成 |
| “设置 → 模型”页脚 → **设置提供商…** | 提供商 → 默认模型 → 完成 |

在任一步关闭对话框，或点击最后的按钮，即结束流程。结束自动首次运行时会保存完成状态，之后不再自动打开；两个入口从不修改该状态。

### 提供商步骤

本步骤自上而下列出：

1. **已设置**：当前可以处理请求的路由（`llm.listProviders`）；**使用**进入默认模型步骤。
2. **本地 AI**：用户自己运行的机器上的模型。步骤打开时以及点击**重新检查**时，Host 通过 `llmAccounts.probeLocalProviders` 探测 Ollama（`localhost:11434/api/tags`）和 LM Studio（`localhost:1234/v1/models`）。正在运行且有模型的服务提供**使用**，它声明一条 OpenAI 兼容的 `llm-pi-ai` 路由（`ollama` 或 `lmstudio`，端点 `…/v1`，列出的模型），并在该路由派生的引用（`OLLAMA_API_KEY`、`LMSTUDIO_API_KEY`）下保存占位密钥，因为 OpenAI 协议总会发送密钥。最后一行**网络中的其他服务**接受任意 OpenAI 兼容端点——局域网中的另一台机器、Tailscale tailnet 主机、vLLM、llama.cpp、LiteLLM：基础 URL、可选 API 密钥、可选名称。**查找模型**通过 `llm.discoverModels` 读取端点的 `/models` 列表；用户保留要使用的模型，**添加提供商**以同样方式声明路由，并保存密钥；未填写密钥时保存占位密钥。路由 id 由主机名派生（`gpu-box.tail1234.ts.net` → `gpu-box-tail1234-ts-net`，`192.168.1.20` → `host-192-168-1-20`），已被已配置路由或目录路由占用时追加 `-2`、`-3`……
3. **订阅**：可用已有套餐通过浏览器登录认证的目录路由（ChatGPT Plus/Pro、Claude Pro/Max、GitHub Copilot、SuperGrok……），以套餐名称显示。**登录**运行一次 OAuth 尝试（`llmAccounts.beginSignIn` / `watchSignIn`，链接在新标签页打开，设备码和提示内联显示）。
4. **API 访问**：可用密钥认证的目录路由，可搜索。**API 密钥**保存一个密钥账号（`llmAccounts.addApiKeyAccount`），凭据包含多个字段的提供商则运行 pi-ai 的密钥提示。两种方式都支持的厂商（Anthropic）同时出现在两个分区。

两个云端分区都沿用 `llm.listConfigurableProviders` 的顺序：`llm-pi-ai` 按常用程度列出目录路由（OpenAI、Anthropic、Google，然后是 GitHub Copilot、xAI、OpenRouter、DeepSeek、Mistral、Groq……其余按字母顺序），使用用户熟悉的名称，并以 `nativeAuth.oauthName` 报告每种登录对应的套餐名称。pi-ai 的旧版 `openai-codex` 路由不再列出（其 ChatGPT 登录已由 `openai` 承担），除非已有配置档指定它。“设置 → 模型”使用相同顺序，已配置的路由在各处也使用相同名称。

**暂时跳过**会跳过提供商和默认模型步骤，不做任何更改。

### 默认模型步骤

本步骤列出新提供商的模型——本机和自定义服务使用流程已知的模型，其余读取 `session.modelCatalog` 中该路由的分组（路由仍在注册时可点**重试**）。**设为默认**写入 `agent-default-model` 设置段（`provider`、`model`，并清除 `reasoningEffort`），与 `agentDefaultModel.saveSelection()` 保存的完整选择相同。

### 组件步骤

选择器从 `@deepseek-ai/dsh-official-bundles` 的 `COMPONENTS` 读取官方组件，并从 `pluginManager.listBundles()` 读取每个 bundle 的标题、说明、图标和选中状态；安装中未提供的组件不显示。它以配置档当前的选择打开，并标为标准或自定义。

- **标准**选择随附的默认集合；列表显示其中包含的组件。
- **自定义**启用复选框，包括标准中关闭的简短提示词开关。在自动首次运行中，它只开启核心、所有组件都不勾选；之后从插件页面或设置打开时保留当前勾选。勾选一个组件会同时勾选它依赖的组件（智能体团队和工作流会勾选子智能体）；取消勾选被依赖的组件会同时取消依赖它的组件。不开启任何组件的选择同样有效，并按应用时的状态保留。
- **应用**通过一次 `pluginManager.setBundlesEnabled` 调用只发送有变化的 bundle。Host 报告需要重启时，完成步骤会提示。

-----

<a id="understand-the-implementation"></a>
## 实现原理

<details>
<summary>实现细节——点击展开</summary>

`apply` 把每个 Remote 调用绑定为普通回调（`createFirstRunOperations`、`createComponentOperations`），其结果携带可直接显示的拒绝原因；并在浮层与两个入口之间共享一个打开状态的快照源。浮层在渲染时根据该快照源和 `ui-first-run` 配置表单推导是否可见；对话框打开前不发起任何请求。

| 文件 | 作用 |
|---|---|
| [`src/index.ts`](src/index.ts) | Host 半部：`completedVersion` 实时字段 |
| [`src/settings.ts`](src/settings.ts) | 命名空间、字段与流程版本 |
| [`src/client/index.ts`](src/client/index.ts) | 词典与三处注册 |
| [`src/client/operations.ts`](src/client/operations.ts) | 提供商、账号、发现与默认模型调用 |
| [`src/client/component-operations.ts`](src/client/component-operations.ts) | 组件列表与批量应用 |
| [`src/client/components.ts`](src/client/components.ts) | 集合成员、依赖勾选、变化的 bundle |
| [`src/client/flow.ts`](src/client/flow.ts) | 打开状态与可见性 |
| [`src/client/FirstRunOverlay.tsx`](src/client/FirstRunOverlay.tsx) | 对话框与步骤顺序 |
| [`src/client/ProviderStep.tsx`](src/client/ProviderStep.tsx) | 提供商选择 |
| [`src/client/SignInPanel.tsx`](src/client/SignInPanel.tsx) | 内联登录尝试 |
| [`src/client/ModelStep.tsx`](src/client/ModelStep.tsx) | 默认模型选择 |
| [`src/client/ComponentStep.tsx`](src/client/ComponentStep.tsx) | 组件选择 |
| [`src/client/EntryPoints.tsx`](src/client/EntryPoints.tsx) | 插件菜单项与模型页页脚入口 |
| [`src/client/locales.ts`](src/client/locales.ts) | 词典（de、en、es、fr、ja、pt、ru、zh） |

</details>

-----

<a id="further-exploration"></a>
## 延伸阅读

- [llm-pi-ai](../../llm/llm-pi-ai/README.zh.md)——提供商路由、账号与本机服务探测。
- [提供商账号](../ui-llm-accounts/README.zh.md)——模型页各卡片中相同的登录与密钥流程。
- [插件管理器](../../boot/plugin-manager/README.zh.md)——bundle 选择与批量切换。
- [智能体默认模型](../../core/agent-default-model/README.zh.md)——模型步骤写入的默认值。

-----

<a id="model-experience"></a>
## 模型体验

间接影响：设置界面本身不添加模型输入，但它选择的默认模型和组件 bundle 决定后续会话使用哪个模型、组合哪些工具和提示词段落，详见各自的包。

#### KV Cache 影响

本包本身没有影响；组件集合变化会改变后续会话的工具列表和系统提示词，由所属包说明。

## 已知限制与后续工作

<a id="known-limitations-and-deferred-work"></a>

- 本机和自定义路由使用适配器的后备上下文窗口和输出上限；服务的模型更小时，请在模型页调整。
- 本机探测只认识 Ollama 和 LM Studio 的默认端口；其他位置的服务请作为自定义 URL 添加。

<a id="dev-note"></a>
### 开发备注

<details>
<summary>维护者工作上下文——点击展开</summary>

客户端测试用英文词典和假操作渲染各步骤，用 `dsh-remote-mock` 驱动两个操作工厂，并用假上下文检查注册与自动首次运行的可见性。只有当所有用户都应重新走一遍流程时，才提升 `FIRST_RUN_VERSION`。

</details>
