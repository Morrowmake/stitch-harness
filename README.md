<p align="center"><img src="branding/wordmark.svg" alt="Stitch" width="232" height="64"></p>

# Stitch

English | [中文](README.zh.md)

Stitch is an open-source coding agent harness you can modify while it runs. Every capability is a plugin, so the agent can inspect itself, add or remove tools, and rewrite its own composition on the fly.

Stitch is provider-neutral and private by default:

- **No account, no telemetry.** Stitch sends nothing anywhere except the requests you make to the model provider you chose.
- **Any model provider.** Local models (Ollama, LM Studio, any OpenAI-compatible server) or hosted providers (Anthropic, OpenAI, Google, OpenRouter, DeepSeek, and more), with API keys or subscription sign-in where the provider offers one.
- **Choose what you install.** The installer lets you pick components; the minimal install has only the read, write, edit, and bash tools plus the self-modification kernel.
- **Keyless web search.** Web search uses DuckDuckGo with a Marginalia fallback, or your own SearXNG instance.

Stitch is based on [DeepSeek Harness](https://github.com/deepseek-ai/deepseek-harness) and its **everything-is-a-plugin** architecture, powered by [Cordis](https://github.com/cordiverse/cordis).

## Developer preview

Stitch is in _developer preview_ and iterating rapidly. **THERE WILL BE COMPATIBILITY-BREAKING CHANGES.**

Review the [safety notice](SAFETY.md) before running the project.

## Run

### Desktop app

Download the macOS or Windows installer from [GitHub Releases](https://github.com/Morrowmake/stitch-harness/releases). The builds are unsigned for now, so macOS Gatekeeper and Windows SmartScreen warn on first launch.

### Terminal command

The desktop app can install the `stitch` command for your terminal: choose **Manage stitch Command…** in the app menu. Then run:

```sh
stitch web
```

The command starts the Web UI at `http://127.0.0.1:3080` by default and opens it in the default browser for a local launch. An SSH launch only prints the host URL because the SSH client or editor owns the local forwarded address. Pass `--no-open` to run the server without opening a browser. See [Web UI guide](docs/user/guide/index.md).

### Run from source

To run from a repository checkout:

```sh
git clone https://github.com/Morrowmake/stitch-harness.git
cd stitch-harness
pnpm install
pnpm run build
pnpm stitch web
```

`pnpm run build` prepares the repository artifacts. `pnpm stitch web` uses those built artifacts without rebuilding.

## Community and support

Report bugs and request features in [GitHub Issues](https://github.com/Morrowmake/stitch-harness/issues), or use `/feedback` inside Stitch.

## Contributing

See [CONTRIBUTING.md](CONTRIBUTING.md).

## Development

Start with the [development guide](docs/development.md) and [architecture documentation](docs/architecture.md).

`pnpm run dev:web` builds, serves, and rebuilds client bundles on source edits in one terminal, and `make help` lists the matching Make targets for Web and Desktop; the guide's application commands section owns the full table.

For agents, follow [AGENTS.md](AGENTS.md).

## Acknowledgements

Stitch is a fork of [DeepSeek Harness](https://github.com/deepseek-ai/deepseek-harness) by DeepSeek-AI. If you use the underlying architecture in research, cite the original work:

```bibtex
@misc{deepseek-harness2026,
  title={DeepSeek Harness: Everything is a Plugin},
  author={DeepSeek-AI},
  year={2026},
  publisher={GitHub},
  howpublished={\url{https://github.com/deepseek-ai/deepseek-harness}},
}
```

## License

[MIT](LICENSE)

Third-party dependencies and their licenses are disclosed in [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md).
