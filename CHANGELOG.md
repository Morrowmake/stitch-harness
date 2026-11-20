# Changelog

Stitch release notes. Stitch is a fork of DeepSeek Harness 0.2.2-rc.5; changes made upstream before the fork are recorded in `docs/upgrade-guide/` (read-only history). Release tags are `stitch-v<version>`.

## Unreleased

### Changed

- Approval prompts: listing plugins never asks; each prompt describes in plain words what will happen (raw arguments under **Details**) and offers **Allow once**, **Allow for this chat**, or **Deny**. A chat grant covers the same tool and kind of action only in that chat; installing build scripts and version exemptions still ask every time.
- Adding an API key (first-run setup and Settings → Models) checks it with the provider first: a rejected key is not saved and the form says so; a key that can't be checked right now is saved and marked as not verified. **Retry now** on an API-key account re-tests the key and shows the result, and API-key accounts say "Key rejected" (with **Replace key**) instead of "Needs sign-in".
- First-run setup: **Skip** no longer says "You are all set" without a model (it says how to set one up and offers **Set up a model**), every step after the first has **Back**, no default model is preselected, older models fold under **Older models**, the dialog fits the window and scrolls inside, and it opens only after the preview notice is acknowledged instead of on top of it.
- Local AI → **Another server**: `host:port` works without `http://` (an address without a path gets `/v1`), and a failed check says whether the host couldn't be reached, isn't an OpenAI-compatible server, or needs a key. GitHub Copilot sign-in accepts a blank enterprise domain (github.com).
- Settings → Models: the guided **Add a model provider** setup is the main action and the developer form is **Advanced: custom provider**; the account switches are labelled **Use automatically** and **Own entry in model menu** with a line of help; the doubled "Sign in with Sign in with ChatGPT" label is fixed in every language; the provider editor shows "Using Stitch's built-in model list (N models)" and hides its key field when accounts already hold credentials.
- Model picker: each provider lists current models first, newest first; older versions, "(latest)" aliases and dated snapshots fold under **Older models**; per-account entries are grouped under "Provider · account name" instead of repeating the list with an internal id.
- Model and provider errors in chat are one plain sentence of guidance (for example "No AI model is set up yet. Add one in Settings → Models." or "OpenAI rejected the API key for Account 1. Check or replace it in Settings → Models.").

### Removed

- DeepSeek account sign-in, DeepSeek-specific model adapters and request extensions, plugin-inventory and session-log uploads, and DeepSeek search/fetch. All model access goes through the generic pi-ai adapter; DeepSeek remains an ordinary provider route. There is no default provider.
- All telemetry: OpenTelemetry service, product and session telemetry, product analytics, and the anonymous user id.
- LiveShare, recommendations and action cards, inspectors and stats, the web-worker runtime, the badge skill, DeepSeek chat import, and the desktop welcome, platform, and mandatory-update flows.
- npm package publishing. Python wheels are built in CI but not published.

### Changed

- Renamed to Stitch: the `stitch` command, `~/.stitch` and `.stitch/` directories, `STITCH_*` environment variables, desktop app name, id, protocol and installers, UI text in all eight locales, the Python package (`stitch-harness`), and the TypeScript SDK client. Internal `@deepseek-ai/dsh-*` package names are unchanged.
- The default composition is split into 18 optional components. The **Standard** preset turns on everything shipped by default; **Custom** starts from the core tools and the self-modification kernel.
- Desktop no longer bundles the Claude Code and Codex native CLIs (~466 MB); the subagents use your installed CLI or download it on demand from Plugins.
- Session logs written by earlier releases stay readable.
- Feedback is honest about where it goes. The dialog is now "Leave feedback", and its button is "Save note" with the line "Saved on this computer only. Nothing is sent." `/feedback <text>` answers "Note saved on this computer. Nothing was sent." instead of showing the session id. "Report on GitHub" says it creates a public issue on github.com/Morrowmake/stitch-harness. It shows the issue as formatted text, with an "Edit text" switch, and sends nothing until you choose. "Open on GitHub" opens the prefilled page in your browser. "File with my GitHub account" uses the signed-in `gh` app only when you pick it, and opens the prefilled page if `gh` is not available.
- Failed turns show one plain sentence. Unexplained failures read "Something went wrong while running this turn", and the technical message and error code sit behind a "Details" toggle instead of a bare code badge.
- With no model set up, Send is disabled. The composer shows "Set up a model first" with a "Set up a model" button that opens the provider setup. When providers exist but none is chosen, it shows "Choose a model to start".
- The home screen asks "What should we work on?" instead of "Into the Unknown". The "Preview" badge shows only on prerelease and development builds.
- In dark mode the macOS sidebar uses the app's dark surface instead of a light grey see-through background.
- Chat titles in the sidebar always show their beginning and end with "…" when they don't fit, also on hover. The hover card shows the full title.
- Long labels wrap instead of being cut off: Settings section names, preset card titles (the badge moves below), and the sidebar "Workspaces" heading (shorter Russian wording, full text on hover).
- Preset cards no longer show the internal ids of built-in presets (such as "cordis" for Creator mode) unless Developer tools are on, and chat tool rows say "Run plugin", "Stop plugin" and "Remove plugin" instead of naming Cordis.
- Plugins → Discover is always there: the "Custom plugin indexes" experimental switch is gone, and "More → Browse other plugins" opens Discover. Profiles that had the switch on load without errors and keep any index list they saved ([upgrade guide](docs/upgrade-guide/v0.2.2-rc.5/plugin-market-bundle-retired/guide.md)).
- The agent's `plugin_market` tool is off by default, so Discover adds nothing to the agent's instructions. Turn on "Plugin market tool for the agent" under Show advanced in Plugins to let the Creator agent search plugin indexes.
- Discover lists only the Stitch plugin index by default. The two DeepSeek Harness community indexes are offered under "Community indexes" in "Manage index sources…", and every index other than Stitch's is labelled "Community — not reviewed by Stitch". Their risk and verification labels name the index ("Rated low risk by …"), and their cards say when a plugin is made for DeepSeek Harness, needs another Stitch version, or doesn't say which versions it supports. While the Stitch index is empty, Discover says so and offers a community index.
- The Plugins list is grouped by purpose (Chat & tools, Files & documents, Web & search, Agents & automation, Integrations, Appearance & interface), then "Plugins you added", "Experimental", and "Advanced", each sorted A–Z with a count of what is on. A search field finds any plugin; plumbing components and plugins you are unlikely to change stay under "Show advanced". The separate "More" page and the "Built-in plugin settings" and "Experimental plugins" groups are gone.
- Built-in components are no longer labelled Experimental.
- A plugin with settings has a settings button on its card, and its settings appear on the plugin's own page.
- Turning off a plugin that others need asks first and names them; turning it back on offers to turn them on again too. Cards say which plugins a plugin needs, and turning one on that switched on what it needs says so.
- Plugin pages start with a plain summary and guide; the package name, README, components, and source sit under a folded "Developer details". Built-in plugins no longer show a version number.
- The add-plugin error no longer shows package names or the internal "dsh.bundle" wording.

### Added

- First-run dialog: pick a model provider (local Ollama or LM Studio, any OpenAI-compatible server, or a hosted provider with sign-in or API key), a default model, and the components to install. It is also reachable from Plugins and Settings.
- Multiple accounts per provider (OAuth or API key) with automatic failover on rate-limit, quota, or authentication errors, per-account models and aliases, and usage display for Codex, Claude, and Grok.
- Keyless web search: DuckDuckGo with a Marginalia fallback, or your own SearXNG instance.
- Desktop updater: a one-click in-app updater that checks GitHub Releases and verifies ed25519-signed manifests and downloads.
- Unsigned macOS (arm64, x64) and Windows x64 desktop installers built by GitHub-hosted CI on `stitch-v*` tags.
- `/feedback` can file a GitHub issue after a preview and confirmation.
- Compatibility with DeepSeek Harness plugins: `DSH_*` environment variables are read as a fallback, `~/.dsh/skills` and `.dsh/skills` are read, and the community plugin market indexes can be added from Discover.
- Restored HostConnectionService.requestRejection for DSH 0.2.2-rc.5 plugin compatibility. It and `admit` work for plugins that inject only `connection`, as in rc.5.
- Short-prompt component that trims the persona prompt while keeping other components' sections.
- Desktop Settings → General has a "Terminal command" row (macOS and Windows) that shows whether the `stitch` command is installed, needs repair, or is shadowed by another `stitch`, with Install, Repair, and Remove. It uses the same confirmations as the menu item.

### Fixed

- The desktop app no longer quits silently at launch while DeepSeek Harness is running. The packaged app was named `@deepseek-ai/dsh-desktop`, so it shared DeepSeek Harness's Electron data directory and single-instance lock. It is now `stitch-desktop`, which also gives it its own Windows uninstall cleanup target and updater cache.
- A provider signed in with OAuth or given an API key from the first-run dialog or Settings now lists its models. Each account's stored metadata was read as allowing no models, so the first-run model step said the provider "lists no models yet" and the composer offered none. Existing profiles work after updating; no re-sign-in is needed.
- Office rendering, conversion, and recalculation no longer hang in the macOS desktop app when Microsoft Office is installed. Font discovery read Office's cloud font cache in Microsoft's app group container; macOS asks the user before an app reads another app's container and holds the read until they answer, and the conversion deadline could not interrupt the waiting font scan. Stitch now patches LibreOffice Kit to skip that cache on macOS. Fonts bundled inside the Office apps are still used. The packaged-app smoke now fails if a render reads the container.
- A `/command` run in a new, not-yet-started chat now shows its result in that chat, and the chat appears in the sidebar. Before, the result stayed hidden and then appeared at the top of the next chat, because New Session reused the unstarted chat.
- Prompts no longer pile up in the composer. "Create your plugin" and the automation task templates and New button now replace a request an earlier one put in the draft instead of adding to it, so the chat starts with only the latest request. If the draft holds text you wrote, Stitch asks "Replace the current draft?" and keeps your text unless you choose Replace. A later request that names no mode keeps the mode the chat already shows (for example Creator after "Create your plugin") instead of silently switching back to Standard.
- Shell settings now refuse a timeout, output limit, or grace period of 0, below 0, or with a fraction. Before, Plugins → Shell saved a value such as a −5 ms command timeout and showed it as overridden, and every later command failed. The field now shows the error before you save, and Stitch also refuses such a value written to the profile by hand. Every plugin settings card now checks a number against the plugin's own limits in the same way.

### Repository

- Removed DeepSeek Harness release, benchmark, documentation-site, and decision-record machinery that Stitch does not use. `scripts/prune-upstream.sh` re-deletes it after an upstream merge.
- The Claude native-package lookup used in a development checkout now searches only the `node_modules` folders above the subagent package. It used to fall back to `NODE_PATH`, which pnpm points at the whole repository store, so on Linux CI the test resolved the repository's own glibc package instead of its musl fixture.
- CI runs build, unit tests, lint, and the keyless snapshot suite on every pull request.
