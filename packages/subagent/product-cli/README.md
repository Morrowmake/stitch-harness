---
description: "Finds a usable Claude Code or Codex executable, or downloads the pinned native CLI into the Stitch home, for the product subagent providers and the plugin manager."
kind: "package-reference"
---

# @deepseek-ai/dsh-product-cli

English | [中文](README.zh.md)

## Summary

Use `@deepseek-ai/dsh-product-cli` to locate the native Claude Code or Codex executable that a product subagent runs. Stitch installations do not bundle these CLIs; the package resolves an explicitly configured path, a copy Stitch downloaded earlier, or the user's own install, and reports rejected candidates that are too old. On an explicit request it downloads the pinned npm platform package, verifies its sha512 integrity before unpacking, and installs it atomically under `$STITCH_HOME/data/product-cli`. Import it as a library; it cannot be mounted from `cordis.yml`.

## Table of Contents

- [Use this package](#use-this-package)
- [Understand the implementation](#understand-the-implementation)
- [Further Exploration](#further-exploration)
- [Model Experience](#model-experience)
- [Known Limitations and Deferred Work](#known-limitations-and-deferred-work)
- [Dev Note](#dev-note)

-----

<a id="use-this-package"></a>
## Use this package

The [Claude Code](../subagent-claude-code/README.md) and [Codex](../subagent-codex/README.md) providers call `resolveProductCli` before every run, and the [plugin manager](../../boot/plugin-manager/README.md) calls the status, download, and remove functions for the Plugins page.

<a id="resolution-order"></a>
### Resolution order

`resolveProductCli(id, options)` returns the first usable candidate in this order:

| Order | Source | Where |
|---|---|---|
| 1 | `configured` | The provider's `executablePath`; when it is set but missing, resolution stops and reports `configuredMissing` |
| 2 | `downloaded` | `$STITCH_HOME/data/product-cli/<id>/<package version>/` |
| 3 | `installed` | Absolute `PATH` entries, then well-known install directories such as `~/.local/bin`, `/opt/homebrew/bin`, `/usr/local/bin`, the npm global prefix, `~/.claude/local` (Claude Code only), and on Windows `%APPDATA%\npm`, `%LOCALAPPDATA%\Programs\<command>`, and WinGet links |
| 4 | `bundled` | The native platform package beside the SDK in a development checkout or CLI install |

Each installed candidate runs `--version`; a version below the minimum (Claude Code 2.1.263, Codex 0.153.4) is recorded in `tooOld` and skipped. npm `.cmd` and `.ps1` shims are followed to the package's `bin` entry, and JavaScript entries run under Stitch's own Node. When nothing qualifies, the result has `found: false`.

### Status, download, and remove

| Function | Behavior |
|---|---|
| `productCliStatus(id)` | Status for the UI: source, path, version, rejected candidates, and the download offer for this platform; ignores `executablePath` and checkout copies; never contacts the network |
| `downloadProductCli(id, options)` | Downloads only when called; tries each registry in order, reports progress, and accepts an abort signal |
| `removeProductCli(id)` | Deletes `$STITCH_HOME/data/product-cli/<id>` only; the user's own install is never touched |
| `productCliMissingMessage(resolution)` | The user- and model-facing text for a failed resolution |

Downloads exist for darwin, linux, and win32 on arm64 and x64. Download failure reasons are `network`, `integrity`, `unsupported-platform`, `filesystem`, `busy`, and `cancelled`.

-----

<a id="understand-the-implementation"></a>
## Understand the implementation

<details>
<summary>Implementation internals — click to expand</summary>

### Source map

| File | Role |
|---|---|
| [`src/catalog.ts`](src/catalog.ts) | Pinned package names, versions, sha512 integrity, sizes, minimum versions, and install commands |
| [`src/resolve.ts`](src/resolve.ts) | Candidate search, version probing, and shim following |
| [`src/download.ts`](src/download.ts) | Registry fetch, integrity check, unpacking, and atomic install |
| [`src/store.ts`](src/store.ts) | Store paths under `$STITCH_HOME/data/product-cli` |
| [`src/types.ts`](src/types.ts) | Remote-facing status records, exported as `./types` |
| [`src/index.ts`](src/index.ts) | Status and missing-CLI message |

### Integrity and atomic install

The pinned integrity is the npm `dist.integrity` recorded in `pnpm-lock.yaml`; the subagent packages' tests assert that parity. The tarball streams to a `.download-<uuid>.tgz` file in the store root while its sha512 is computed, and the hash must match before anything is unpacked. The archive unpacks into a `.staging-<uuid>` directory, the executable is checked and made executable, and one rename publishes the version directory. Other versions of the same CLI are then removed, and temporary files are always deleted. Because integrity is pinned, a fallback registry cannot substitute different bytes.

### Version probing

`--version` runs with a 15-second timeout and the result is cached per file revision, so repeated runs do not re-probe an unchanged executable. Environment names compare case-insensitively on Windows, and `PATHEXT` extensions plus `.ps1` are tried there.

</details>

-----

<a id="further-exploration"></a>
## Further Exploration

- [Claude Code subagent provider](../subagent-claude-code/README.md) — resolves the executable before each SDK query.
- [Codex subagent provider](../subagent-codex/README.md) — resolves the executable before starting the app-server.
- [Plugin manager](../../boot/plugin-manager/README.md) — exposes status, download, cancel, and remove to clients.
- [Subagent seam](../subagent/README.md) — defines the `PRODUCT_CLI_UNAVAILABLE` error code.

-----

<a id="model-experience"></a>
## Model Experience

### Missing-CLI tool error, indirectly

#### What the model sees

When a provider finds no usable executable, `subagent_claude_code` or `subagent_codex` fails with a `PRODUCT_CLI_UNAVAILABLE` error whose text is `productCliMissingMessage`: the install advice, the download size, the install command, and one sentence per installed version that is too old. A missing configured `executablePath` produces a message that names the path instead.

##### Missing Claude Code

```markdown
Claude Code isn't installed. Install it from Plugins → Claude Code subagent → Download (about 199 MB), or install it yourself: npm install -g @anthropic-ai/claude-code, then retry.
```

#### Token effect

The parent's input grows by one short tool error per failed delegation. No other model input comes from this package.

#### KV Cache effect

The tool error appends after the reusable parent request prefix and does not rewrite it.

## Known Limitations and Deferred Work

<a id="known-limitations-and-deferred-work"></a>


These limits are current package constraints, not a task backlog.

- **One pinned version per CLI** — downloads install only the catalog's version; a newer user install is used as found, and an older one is rejected.
- **No automatic download** — enabling a bundle or failing a delegation never downloads; the user starts it from Plugins.
- **No signature check beyond npm integrity** — trust rests on the pinned sha512 from the lockfile.
- **Concurrency is per process** — a second download of the same CLI in the same process fails as `busy`; separate processes are not coordinated.

<a id="dev-note"></a>
### Dev Note

<details>
<summary>Working context for maintainers — click to expand</summary>

- **Upgrading pins** — a provider SDK or protocol upgrade updates the catalog versions, integrity values, sizes, and minimum versions together with `pnpm-lock.yaml`.

</details>
