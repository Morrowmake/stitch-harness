<p align="center"><img src="branding/wordmark.svg" alt="Stitch" width="232" height="64"></p>

# Stitch

[English](README.md) | 中文

Stitch 是一个可以在运行中修改自身的开源编程 agent harness（智能体框架）。每项能力都是插件，因此 agent 可以检查自身、增删工具，并在运行时改写自己的组合配置。

Stitch 默认不绑定任何模型提供商，并默认保护隐私：

- **无需账号，没有遥测。** 除了你向自己选择的模型提供商发出的请求，Stitch 不会向任何地方发送数据。
- **任意模型提供商。** 支持本地模型（Ollama、LM Studio 及任何 OpenAI 兼容服务器）和托管提供商（Anthropic、OpenAI、Google、OpenRouter、DeepSeek 等），可使用 API key，或在提供商支持时使用订阅登录。
- **自选安装内容。** 首次运行时由你挑选组件：标准启用 Stitch 默认提供的全部功能；自定义只从核心（read、write、edit、bash 工具以及自我修改内核）开始，由你逐个开启需要的组件。
- **无需密钥的网页搜索。** 网页搜索使用 DuckDuckGo，并以 Marginalia 作为后备，也可使用你自己的 SearXNG 实例。

Stitch 基于 [DeepSeek Harness](https://github.com/deepseek-ai/deepseek-harness) 及其**一切皆插件**的架构，由 [Cordis](https://github.com/cordiverse/cordis) 驱动。

## 开发者预览

Stitch 处于 _开发者预览_ 阶段，正在快速迭代。**未来将出现破坏兼容性的变更。**

运行本项目前，请阅读[安全说明](SAFETY.zh.md)。

<a id="run"></a>

## 运行

### 桌面应用

从 [GitHub Releases](https://github.com/Morrowmake/stitch-harness/releases) 下载 macOS 或 Windows 安装程序。目前的构建未签名，因此 macOS Gatekeeper 与 Windows SmartScreen 会在首次启动时发出警告。

<a id="terminal-command"></a>

### 终端命令

桌面应用可以为终端安装 `stitch` 命令：在应用菜单中选择「管理 stitch 命令…」。安装后运行：

```sh
stitch web
```

该命令默认会在 `http://127.0.0.1:3080` 启动 Web UI，本机启动时还会用默认浏览器打开页面。通过 SSH 启动时只打印宿主机 URL，因为本地转发地址由 SSH 客户端或编辑器持有。传入 `--no-open` 可仅运行服务器而不打开浏览器。详见 [Web UI 指南](docs/user/guide/index.zh.md)。

<a id="run-from-source"></a>

### 从源码运行

如需从仓库源码运行：

```sh
git clone https://github.com/Morrowmake/stitch-harness.git
cd stitch-harness
pnpm install
pnpm run build
pnpm stitch web
```

`pnpm run build` 会准备仓库产物。`pnpm stitch web` 会直接使用这些已构建产物，不会重新构建。

## 社区与支持

在 [GitHub Issues](https://github.com/Morrowmake/stitch-harness/issues) 报告 bug 或提出功能请求，也可以在 Stitch 中使用 `/feedback`。

## 参与贡献

参见 [CONTRIBUTING.md](CONTRIBUTING.zh.md)。

## 开发

请先阅读[开发指南](docs/development.zh.md)与[架构文档](docs/architecture.zh.md)。

`pnpm run dev:web` 会在一个终端里完成构建、启动，并在源码修改时重建 client bundle；`make help` 列出 Web 与 Desktop 对应的 Make target。完整表格见开发指南的「应用命令」一节。

面向 agent：请遵循 [AGENTS.md](AGENTS.md)。

## 致谢

Stitch 是 DeepSeek-AI 的 [DeepSeek Harness](https://github.com/deepseek-ai/deepseek-harness) 的分支。如在研究中使用其底层架构，请引用原始工作：

```bibtex
@misc{deepseek-harness2026,
  title={DeepSeek Harness: Everything is a Plugin},
  author={DeepSeek-AI},
  year={2026},
  publisher={GitHub},
  howpublished={\url{https://github.com/deepseek-ai/deepseek-harness}},
}
```

## 许可证

[MIT](LICENSE)

第三方依赖及其许可证见 [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md)。
