# Changelog

Stitch release notes. Stitch is a fork of DeepSeek Harness 0.2.2-rc.5; changes made upstream before the fork are recorded in `docs/upgrade-guide/` (read-only history). Release tags are `stitch-v<version>`.

## Unreleased

### Removed

- DeepSeek account sign-in, DeepSeek-specific model adapters and request extensions, plugin-inventory and session-log uploads, and DeepSeek search/fetch. All model access goes through the generic pi-ai adapter; DeepSeek remains an ordinary provider route. There is no default provider.
- All telemetry: OpenTelemetry service, product and session telemetry, product analytics, and the anonymous user id.
- LiveShare, recommendations and action cards, inspectors and stats, the web-worker runtime, the badge skill, DeepSeek chat import, and the desktop welcome, platform, and mandatory-update flows.
- npm package publishing. Python wheels are built in CI but not published.

### Changed

- Renamed to Stitch: the `stitch` command, `~/.stitch` and `.stitch/` directories, `STITCH_*` environment variables, desktop app name, id, protocol and installers, UI text in all eight locales, the Python package (`stitch-harness`), and the TypeScript SDK client. Internal `@deepseek-ai/dsh-*` package names are unchanged.
- The default composition is split into 18 optional components. The **Standard** preset turns on everything shipped by default; **Custom** starts from the core tools and the self-modification kernel.
- Session logs written by earlier releases stay readable.

### Added

- First-run dialog: pick a model provider (local Ollama or LM Studio, any OpenAI-compatible server, or a hosted provider with sign-in or API key), a default model, and the components to install. It is also reachable from Plugins and Settings.
- Multiple accounts per provider (OAuth or API key) with automatic failover on rate-limit, quota, or authentication errors, per-account models and aliases, and usage display for Codex, Claude, and Grok.
- Keyless web search: DuckDuckGo with a Marginalia fallback, or your own SearXNG instance.
- Desktop updater: a one-click in-app updater that checks GitHub Releases and verifies ed25519-signed manifests and downloads.
- Unsigned macOS (arm64, x64) and Windows x64 desktop installers built by GitHub-hosted CI on `stitch-v*` tags.
- `/feedback` can file a GitHub issue after a preview and confirmation.
- Compatibility with DeepSeek Harness plugins: `DSH_*` environment variables are read as a fallback, `~/.dsh/skills` and `.dsh/skills` are read, and the community plugin market indexes are available.
- Short-prompt component that trims the persona prompt while keeping other components' sections.

### Repository

- Removed DeepSeek Harness release, benchmark, documentation-site, and decision-record machinery that Stitch does not use. `scripts/prune-upstream.sh` re-deletes it after an upstream merge.
- CI runs build, unit tests, lint, and the keyless snapshot suite on every pull request.
