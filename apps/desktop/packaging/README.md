---
description: "Build Desktop installers locally, choose deployment and signing mode, and retrieve artifacts and diagnostics. This guide keeps build operations separate from installed-application qualification. Platform signing details and shared-runner risks must be checked before using hardware credentials."
---

# Desktop packaging

English | [中文](README.zh.md)

## Summary

Build Desktop installers locally, choose deployment and signing mode, and retrieve artifacts and diagnostics. This guide keeps build operations separate from installed-application qualification. Platform signing details and shared-runner risks must be checked before using hardware credentials.

## Table of Contents

- [Choose a build path](#choose-a-build)
- [Release versions](#release-versions)
- [Configuration and local builds](#configuration-and-local-builds)
- [macOS machine configuration](#macos-actions)
- [Unsigned Windows test installer](#unsigned-windows-test-installer)
- [Local macOS DMG without release signing](#local-macos-dmg-without-release-signing)
- [GitHub release builds](#github-release-builds)
- [macOS release signing and diagnostics](#macos-release-signing)
- [Directory builds and preparation](#directory-and-preparation)
- [Runtime file selection and installation checks](#runtime-file-selection)
- [Desktop runtime preparation](#desktop-runtime-preparation)
- [Installation and release verification](#verification)

<a id="choose-a-build"></a>

## Choose a build path

Run local commands from the repository root after installing locked dependencies. Use the platform-specific command for each target. Choose test or production deployment independently from signed or unsigned mode. Read [Windows signing and runner operations](../windows-signing/README.md#trust-and-isolation) before any Windows signed build or shared-runner use. Installation is separate from packaging.

Set `STITCH_DESKTOP_PACKAGE_CACHE_DIR` to an absolute build-cache directory for reuse across checkouts; see [cache configuration and lifecycle](#desktop-runtime-preparation).

<a id="release-versions"></a>

## Release versions

Before each Desktop packaging run, first confirm the complete version string with the current user. Check the selected deployment, stitch base version, retained release records, and published releases, then propose the exact version for approval. Do not start packaging until the user confirms that version; the deployment setting alone does not authorize a version choice.

Record the current stitch version as the base. A production Desktop release uses that exact version, including any `alpha`, `beta`, or `rc` identifiers. A test release preserves the complete prerelease base and appends `.YYYYMMDD.index`; a stable base uses `-test.YYYYMMDD.index` instead.

| stitch base | Production Desktop | Test Desktop example |
|---|---|---|
| `0.1.6-alpha.1` | `0.1.6-alpha.1` | `0.1.6-alpha.1.20260916.1` |
| `0.1.6-beta.2` | `0.1.6-beta.2` | `0.1.6-beta.2.20260916.1` |
| `0.1.6-rc.3` | `0.1.6-rc.3` | `0.1.6-rc.3.20260916.1` |
| `0.1.6` | `0.1.6` | `0.1.6-test.20260916.1` |

Use the actual creation date in Asia/Shanghai. For each base and date, start the index at 1 and increment after checking retained release records and published releases; never reuse a published version. Test distribution does not publish the corresponding unsuffixed base.

Pass the confirmed version to the packaging command as `--build-version`, which reaches the artifact names and the installed application version as one value. The manifests keep the product version, so a test build no longer rewrites the release family and leaves nothing to revert:

```sh
pnpm --dir apps/desktop run package:win:x64 --build-version 0.1.6-alpha.1.20260916.1
```

`--build-version auto` proposes the next index for today from this target's local output directory. Confirm the proposal it prints before publishing; a run script forwards `--` on its own, and the packaging entry accepts it either way.

A production build uses the product version and takes no `--build-version`. Every artifact records `dshBuildCommit` and `dshBuildDirty` in its manifest so a build handed over directly remains traceable.

A stable base's `-test.<date>.<sequence>` build ranks below that base, so it never appears newer than the release it precedes; stable corrective releases require a product version bump.

<a id="configuration-and-local-builds"></a>

## Configuration and local builds

Unsigned macOS and Windows packages use the same localized **Stitch Local Build** label and version/commit badge as local Web builds. Add `--official` to an unsigned command to build with the official client profile instead, without that label or badge; the [GitHub release workflow](#github-release-builds) does this. Signed packages keep official branding, including test deployments and macOS builds that skip notarization. Native application and installer names are unchanged.

Set `STITCH_PACKAGING_CONFIG_DIR` to the absolute machine configuration directory and `STITCH_PACKAGING_PRESET` to `test` or `production` for local Windows commands. The loader reads `presets/<preset>.env`; signed commands additionally read `secrets/windows-signing.env`. Relative certificate and SignTool paths resolve beside the file declaring them. Public presets reject credentials, and the signing file cannot override public settings. Missing configuration fails without falling back to `.env.windows`; commands without a preset retain the existing dotenv behavior. Unsigned and preparation-only presets never read the signing file. Cache maintenance also reads only public preset settings.

Outside machine-preset mode, packaging and manual macOS signature verification (except local unsigned macOS builds) read `apps/desktop/.env.windows` or `.env.macos`, selected by target platform. Copy the [Windows template](../.env.windows.example) or [macOS template](../.env.macos.example) and fill in the local settings; Git ignores both local files, and packaged artifacts exclude them. Release fields come only from the selected configuration files, without fallback to system or shell variables; `PATH`, proxies, and build-tool settings remain inherited. The build version is an argument rather than a release field, and the packaging run records it in its completion record. Files use UTF-8 with optional BOM; relative certificate, SignTool, Apple API key, and keychain paths resolve from `apps/desktop`, values are not shell-expanded, and passwords containing `#` or spaces need quotes.

Every package command checks the application ID and its mode-specific signing configuration before building or downloading, then probes the external tools the run will use: the archive reader, and on a Windows target the installer compiler. macOS checks the identity, Team ID, one complete notarization strategy, readable local `CSC_LINK` p12 file, explicit `CSC_KEY_PASSWORD`, and referenced API key and keychain files; Windows checks the public code-signing certificate, SignTool file, container name, and PIN format. Windows preparation-only builds and explicit unsigned builds on either platform do not require signing credentials. Configuration checks do not authenticate the PIN, log in to the token, unlock a keychain, or contact Apple; actual signing and notarization perform those checks. Run the same checks separately:

```sh
pnpm --dir apps/desktop run check:package
```

`prepare:desktop` is not a prerequisite:

```sh
pnpm run package:desktop
```

Release automation uses fixed target commands so runtime preparation, stitch preparation, and electron-builder receive the same platform and architecture:

```sh
pnpm run package:desktop:mac:arm64
pnpm run package:desktop:mac:x64
pnpm run package:desktop:win:x64
```

The macOS arm64 command requires Apple Silicon. The macOS x64 command runs on Intel macOS or Apple Silicon with Rosetta. The Windows x64 command requires Windows x64. Linux is not a supported Desktop release target.

Both release and local unsigned macOS DMGs use LZMA compression (`dmg.format: 'ULMO'`) in [the electron-builder configuration](../scripts/electron-builder-config.mjs). A [build-time patch](../../../patches/app-builder-lib@26.17.0.patch) adds this format to the pinned builder's validation and TypeScript declarations.

Each target owns its packed package inputs, prepared runtime, package set, stitch tree, pnpm preparation state, unpacked application, and final artifacts under `apps/desktop/.desktop-build/targets/<target>/`. The Electron archive cache remains shared under `.desktop-build/downloads` because every archive name includes its version, platform, and architecture and is verified before extraction. A target build never consumes another target's mutable preparation state.

<a id="macos-actions"></a>

## macOS machine configuration

Run `node apps/desktop/scripts/setup-macos-packaging.mjs "$HOME/dsh-ci"` to prepare private `runner/`, `packaging/{presets,secrets,certificates}` and `cache/macos-signatures` directories without overwriting existing files; append `--check` to inspect them. Fill the [preset](../config/macos-packaging/test.env.example) and [signing](../config/macos-packaging/macos-signing.env.example) templates outside the checkout. Set secret and certificate files to mode `0600`. `STITCH_PACKAGING_CONFIG_DIR` selects the absolute `packaging` directory and `STITCH_PACKAGING_PRESET` selects its preset; missing files fail without falling back to `.env.macos`. Signed and preparation-only Mac builds read `secrets/macos-signing.env`; relative credential paths resolve beside that file. Public presets reject signing credentials, and signing files cannot override public settings. Local unsigned Mac builds retain their configuration-free behavior.

The building account can read its signing files, so run only trusted code. The existing notarization proxy restoration rules apply; after forced termination, inspect retained recovery records before another build. New setup templates set `STITCH_DESKTOP_MACOS_SIGNATURE_CACHE_DIR` to the absolute `cache/macos-signatures` directory outside checkout. For existing installations, rerun setup and add that field to each preset; existing files are preserved. This retains signatures across clean checkouts; cache verification and limits are described under [macOS signing](#macos-release-signing).

ZIP compression uses the same configured level with or without notarization; the App is assembled once, then DMG and ZIP are built separately so the ZIP setting does not change DMG compression. The `--skip-notarization` CLI flag retains Developer ID signing, DMG signature verification and packaged-runtime verification, but omits Apple notarization and stapling and does not require Apple notarization credentials. DMG/ZIP filenames carry `-unnotarized` and are stored under `.desktop-build/targets/<target>/unnotarized-artifacts/`. These artifacts are for internal debugging only: Gatekeeper may block downloaded copies, and they are not qualified for distribution. No release completion record is written. The flag rejects unsigned, Windows and preparation-only builds.

<a id="unsigned-windows-test-installer"></a>

## Unsigned Windows test installer

On Windows x64, use the complete unsigned packaging command for local installation testing:

```sh
pnpm run package:desktop:win:x64:unsigned
```

The command reads `.env.windows` and requires `STITCH_DESKTOP_APP_ID`. The local run uses Node 24; the remaining tools are the root `packageManager` version of pnpm, Git, PowerShell 7 (`pwsh`), tar, Python, Visual C++ Build Tools, a Windows SDK and the .NET 10 SDK. Set `PYTHON` when Python is absent from `PATH`. It writes the installer to `.desktop-build/targets/win-x64/unsigned-artifacts/`, strips signing credentials, and creates no release completion record. EV credentials are unnecessary. Signed packaging retains its release requirements. The command publishes the unsigned Computer Use helper with `dotnet` into the provider package for packing, then removes it from the checkout.

Run `pnpm install --frozen-lockfile`, then `pnpm run package:desktop:win:x64:unsigned --check` to validate configuration and tooling before the full command above. Packaging performs its own complete build and isolated runtime smoke without an online model. Stage logs remain under `.desktop-build/packaging-runs/`; a successful build alone does not qualify the installer. Dependency installation and runtime preparation need access to npm, GitHub release assets and nodejs.org; use the existing registry and proxy configuration when the network requires it. Caches and tool locations belong to the build machine, not tracked personal paths.

<a id="local-macos-dmg-without-release-signing"></a>

## Local macOS DMG without release signing

After `pnpm install`, run one command from the repository root. No `.env.macos`, Apple account, or certificate is required:

```sh
pnpm run package:desktop:mac:arm64:unsigned
pnpm run package:desktop:mac:x64:unsigned
```

Add `--check` to validate local configuration and tools without building, or `--dir` to stop at the unpacked application. The DMG is `apps/desktop/.desktop-build/targets/<target>/unsigned-artifacts/stitch-<version>-mac-<arch>-unsigned.dmg`, with a ZIP of the same name beside it. After all checks pass, the command prints `DMG:` and `ZIP:` followed by their absolute paths. Open the DMG and copy the application to a local test directory.

These commands ignore `.env.macos` and inherited release settings and use `io.github.morrowmake.stitch` as the app ID. Build tools, standard network proxies, and `STITCH_DESKTOP_NPM_REGISTRY` remain available from the shell. They skip Developer ID signing, Apple notarization, temporary signing keychains, and notarization proxy changes. Electron receives a local ad-hoc signature without certificates so the modified executable can run; the DMG is unsigned. Both preparation and the assembled application still run runtime integrity and smoke checks. Local builds omit release completion records. Their ZIP keeps the application's links, file modes and ad-hoc signatures, so the in-app updater can install it. macOS may require approval in System Settings → Privacy & Security to open an unnotarized application. These builds compile the Computer Use helper for the target architecture with Swift 6 (Xcode 16 or later) and sign it ad hoc as `Stitch Computer Use.app`; the command stages it in the provider package for packing and then removes it. `pnpm exec tsx scripts/cua-helper/build-unsigned.ts` builds the same helpers for both architectures on its own and refuses to replace an existing `native/bin`.

<a id="github-release-builds"></a>

## GitHub release builds

The [Desktop release workflow](../../../.github/workflows/desktop-release.yml) builds unsigned installers on GitHub-hosted runners: `mac-arm64` on `macos-15`, `mac-x64` on `macos-15-intel`, and `win-x64` on `windows-2025`. Each leg runs its `package:desktop:<target>:unsigned` command with `--official`, first with `--check`. Installers use the official client profile and include the unsigned Computer Use helper. macOS legs also extract their ZIP and verify the application's and the helper's ad-hoc signatures. Each successful leg uploads its DMG and ZIP, or its EXE, as the `desktop-<target>` workflow artifact; every leg uploads its `packaging-runs` logs, including failed ones. A `manifest` job then writes `latest.json` and `SHA256SUMS.txt` and uploads them as the `release-manifest` artifact.

Pushing a tag named `stitch-v<version>` starts a release, where `<version>` is the root `package.json` version:

```sh
git tag stitch-v0.2.2-rc.5
git push origin stitch-v0.2.2-rc.5
```

The workflow rejects a tag that does not match that version. After all three legs and the manifest succeed, it creates the GitHub prerelease for the tag, or updates an existing one, and attaches the DMGs, ZIPs, EXE, `latest.json`, and `SHA256SUMS.txt`. To build without publishing, run the workflow manually with **dry-run** selected (the default); the files remain workflow artifacts for 14 days. A manual run from a branch never publishes.

The installers carry no Developer ID or Authenticode signature, so each operating system warns on first launch:

- macOS: open the DMG and copy Stitch to Applications. If macOS refuses to open it, choose **Open Anyway** in System Settings → Privacy & Security, or remove the quarantine attribute with `xattr -dr com.apple.quarantine /Applications/Stitch.app`.
- Windows: when SmartScreen shows "Windows protected your PC", choose **More info**, then **Run anyway**.
- Computer Use: the helper is also unsigned. The first time Computer Use runs, macOS asks to grant Accessibility and Screen Recording to **Stitch Computer Use**; approve both in System Settings → Privacy & Security. Each release carries a new ad-hoc signature, so macOS may ask again after an update.

### Update signing and `latest.json`

The in-app updater installs the macOS ZIP or the Windows EXE of a release only after checking it against `latest.json`. [`sign-update-assets.ts`](../scripts/sign-update-assets.ts) writes that file with the shared format in [`update-manifest.ts`](../src/update-manifest.ts):

```json
{
  "schema": 1,
  "version": "0.2.2-rc.5",
  "tag": "stitch-v0.2.2-rc.5",
  "releaseUrl": "https://github.com/Morrowmake/stitch-harness/releases/tag/stitch-v0.2.2-rc.5",
  "publishedAt": "2026-11-21T00:00:00Z",
  "assets": {
    "darwin-arm64": { "name": "stitch-0.2.2-rc.5-mac-arm64-unsigned.zip", "size": 123, "sha256": "<hex>", "signature": "<base64>" },
    "darwin-x64": { "name": "stitch-0.2.2-rc.5-mac-x64-unsigned.zip", "size": 123, "sha256": "<hex>", "signature": "<base64>" },
    "win32-x64": { "name": "stitch-0.2.2-rc.5-win-x64-unsigned.exe", "size": 123, "sha256": "<hex>", "signature": "<base64>" }
  },
  "manifestSignature": "<base64>"
}
```

Each `signature` is an ed25519 signature over the asset's bytes. `manifestSignature` signs the manifest without that field, serialized with sorted keys and no whitespace, so a changed version, digest or file name fails verification. GitHub's `releases/latest` endpoint skips prereleases, so the updater lists the repository's releases and downloads `latest.json` from the release it selects.

The private key is the `STITCH_RELEASE_SIGNING_KEY` repository secret, a PKCS#8 PEM ed25519 key. Without it the workflow still writes `latest.json` but omits every signature and warns; the updater rejects such a release. Create a key pair once, outside the checkout:

```sh
node apps/desktop/scripts/generate-update-signing-key.ts ~/.stitch-update-signing-key.pem
gh secret set STITCH_RELEASE_SIGNING_KEY --repo Morrowmake/stitch-harness < ~/.stitch-update-signing-key.pem
```

The script refuses paths inside the repository and existing files, writes the private key with mode `0600`, and prints the public key as base64 of the raw 32-byte key. Add that value to `UPDATE_PUBLIC_KEYS` in [`update-public-key.ts`](../src/update-public-key.ts); keep the previous key in the list while releases signed with it are still being updated from. Back up the private key separately: a lost key means users must install the next release by hand.

<a id="macos-release-signing"></a>

## macOS release signing and diagnostics

The signed macOS configuration uses the required release environment instead of accepting whichever certificate appears first in a keychain. It rejects empty values, a malformed Team ID, a signing identity that includes electron-builder's unsupported `Developer ID Application:` prefix, and incomplete notarization credentials. Signed macOS packaging requires the configured identity and its private key. Runtime preparation applies that identity, a secure timestamp, and hardened runtime to every embedded Mach-O file outside the notarized Computer Use helper bundles; for those bundles it verifies the deep signature, release identity, stapled ticket, and Gatekeeper acceptance without re-signing their files. A signed local build of a source that ships Computer Use therefore needs the notarized helper staged first with `scripts/cua-helper/package.ts` and `stage.ts`; an ad-hoc `build:native` output under `native/bin` fails this verification; after signing the application, a deep strict check rejects any other leaf authority or Team ID before artifact creation. The signed fixed-target macOS installer commands create separate copies of the signed application and run two artifact lanes concurrently. One lane notarizes and staples the App before generating the ZIP and its update metadata. The other encloses its signed App copy in a signed DMG, then notarizes, staples, and verifies the DMG; its inner App has no individually stapled ticket. Both lanes must finish successfully before their artifacts reach the final directory and the release completion record is written. Signed directory-only commands also require notarization credentials and wait for Apple notarization and App stapling. The [parallel notarization decision](../../../.agents/notes/implemented/process/2026-09-09-parallel-macos-notarization.md) owns copy isolation and container ticket semantics. `CSC_LINK` must name a local p12 containing the Developer ID Application certificate and private key; URLs and Base64 inputs are not supported. `CSC_KEY_PASSWORD` is its export password, not an Apple account or login password; an explicitly empty value supports an unencrypted p12. Before building, packaging creates and unlocks a private temporary keychain, imports the p12, authorizes signing, and signs a small probe. Runtime and App signing use this keychain explicitly; existing login keychains require no setup or manual unlocking. Child processes receive its path without the p12 password. The keychain is deleted after success or ordinary failure; CI must clean temporary credentials after forced termination. Ephemeral CI writes the certificate and `.env.macos` from its secret store, restricts file access, and deletes both after the job; self-hosted machine presets retain private files outside the checkout. Ambient `CSC_NAME` and certificate discovery order do not select the release owner. Notary credentials may instead use electron-builder's complete Apple ID or keychain-profile strategy. The two macOS identity variables are also required when repeating the application check manually with `pnpm --dir apps/desktop run verify:mac-signature -- <path-to-app>`.

macOS signing visits real files without following Framework symlink aliases. PAK resources retain all shipped languages and are sealed by the enclosing Framework or application signature instead of receiving individual signatures. The [release policy](../../../.agents/notes/implemented/architecture/2026-08-25-electron-desktop-packaging-and-updates.md) owns the dependency patch and verification requirements.

macOS runtime preparation caches verified single-architecture Mach-O signatures in `.desktop-build/targets/<target>/signature-cache` unless `STITCH_DESKTOP_MACOS_SIGNATURE_CACHE_DIR` selects external storage. An explicit path must be absolute and already exist, contain no linked ancestors, and be owned by the current account with mode `0700` and read/write/search access; invalid or empty settings fail preflight without fallback. Omit the field to retain target-local storage. Keys include input bytes and permissions, the signing probe’s actual leaf certificate, identifier, entitlement bytes, macOS version, and signing tools and policy. Git commits do not determine reuse: uncommitted byte changes invalidate the affected file. Every hit verifies cached bytes, the strict signature, certificate, identifier, entitlements, secure timestamp and hardened runtime before replacing an unchanged input. Universal binaries are signed each time. Runtime integrity and smoke checks, App signing, and Apple notarization still run. The cache requires trusted local build storage. Cache corruption or unsafe links fail the build; stop packaging before deleting the affected cache directory and retrying. Successful signing stages prune complete entries to a one-GiB payload budget; interrupted temporary entries require manual removal. Concurrent eviction can fail a reader safely. Logs report hit, miss and uncached counts.

Mac package commands print `DESKTOP_PACKAGING_RECORD` with a unique directory under `apps/desktop/.desktop-build/packaging-runs/`. After reading local configuration, each run retains `run.json` (published version, product version, Git commit, dirty-worktree flag, target and Node version), `events.jsonl` (timestamped phases, durations, parallel output attribution and proxy restoration), redacted child `stdout.log` / `stderr.log`, and `result.json` (overall outcome, stage results and artifact directory). Events also record pack concurrency and whether each proxy is configured. Logs survive failures and later builds; no automatic deletion runs. Missing `result.json` means completion is unconfirmed. Known credential values are redacted, and environments are not recorded. Apple command failures retain their exit code, signal, stdout and stderr in redacted form; the adapter also writes these details to stderr when no journal is available. Runtime preparation records package staging, installation, materialization, signing, manifests, smoke checks, descriptor verification and cleanup separately. Nested phase durations overlap and must not be added together.

CUA helper packaging prints `CUA_PACKAGING_RECORD` and creates its own record in the same directory before desktop installer startup. Its `run.json` identifies the helper target, product version and source commit; `events.jsonl` retains command and notarization phases, submission IDs and Apple results. `result.json` records success or failure. These records survive temporary payload cleanup, including when helper preparation fails.

App and DMG notarization each record a submission ID and separate `notarytool:upload:*` and `notarytool:wait:*` durations. Upload uses `submit --no-wait` and includes authentication, local validation, transfer and server acceptance; it is not pure transfer time. Waiting starts after that command returns and includes polling and remaining Apple processing; Apple can start processing before upload submission returns. Apple status and diagnostic logs are retained, including rejection; signature checks, acceptance checks and stapling remain owned by `@electron/notarize`. Directory-only package commands use this same measured App notarization path. Individual subprocess output remains live in the terminal, while phase failures and nested errors are retained in the journal. Both platforms record parent-process packaging failures and print redacted diagnostics, including proxy recovery instructions, to the terminal. The configuration-only `check:package` command creates no run log.

Mac packaging reads these tuning fields from `.env.macos`:

| Setting | Default | Scope |
|---|---|---|
| `STITCH_DESKTOP_MACOS_PACK_CONCURRENCY` | `4` | Workers for first-party and vendor workspace tarballs; requires a positive integer. |
| `STITCH_DESKTOP_MACOS_ZIP_COMPRESSION_LEVEL` | `3` | Final ZIP compression, integer `0`–`9`; lower levels trade larger downloads for shorter builds. App notarization archives and DMG compression are unchanged. |
| `STITCH_DESKTOP_MACOS_DOWNLOAD_PROXY` | Empty | HTTP/HTTPS proxy origin for Electron, runtime assets, pnpm installation and builder downloads. |
| `STITCH_DESKTOP_MACOS_NOTARIZATION_PROXY` | Empty | HTTP proxy origin for Apple tools through temporary system proxy settings. |

The proxy fields are independent and reject URL credentials, paths, queries and fragments. Empty values preserve inherited networking. An explicit download proxy replaces child-process proxy variables and bypasses local hosts only; it does not change system settings. Company proxy addresses belong in the ignored local file; see internal documentation for addresses.

Apple tooling uses the active macOS network service's HTTP/HTTPS proxies. Configured notarization routing checks proxy reachability, saves that service's settings, enables the proxy around both artifact lanes, and restores the saved settings after both lanes settle. An originally disabled proxy with an empty server and port zero is restored by disabling it; the temporary server and port may remain stored but inactive. Directory-only builds apply it to App notarization after the signed directory build. This temporarily affects other applications and requires permission to change system proxies; PAC, auto-discovery, SOCKS and authenticated proxy configurations must be disabled first. Packaging and recovery acquire the same per-user POSIX file lock before reading recovery data or changing proxies; process exit releases ownership, while the lock file remains in place. The lock loads `@deepseek-ai/node-addon-system/flock` at first use rather than at script start, so `check:package` and the packaging entry load on a checkout that has not built `native/system`; when the host addon binary or the entry's JavaScript is missing at lock time, the loader runs `pnpm run build:native-system` and `pnpm --dir native/system run build:ts` before locking, so recovery works on such a checkout as well. This prevents overlapping proxy transactions across checkouts; other users and network-setting tools must not change these settings concurrently. SIGINT/SIGTERM wait for active work before restoration. After forced termination or a restoration error, stop any remaining notarization processes and run `pnpm --dir apps/desktop run restore:mac-proxy`; the saved record remains until restoration succeeds. Configuration checks validate URL syntax without changing system settings or contacting the proxy.

<a id="directory-and-preparation"></a>

## Directory builds and preparation

Create a runnable application directory instead of an installer by using the matching `:dir` command, such as:

```sh
pnpm run package:desktop:dir
pnpm run package:desktop:mac:arm64:dir
```

To inspect or troubleshoot the prepared host-target resources without invoking electron-builder, stop the same pipeline after preparation:

```sh
pnpm run prepare:desktop
```

This diagnostic command is an alternative stopping point, not the first half of a two-command build. A later `package:desktop*` command repeats the build selected by its signing mode and all preparation so it cannot consume stale stitch packages, runtime files, or stitch content.

<a id="runtime-file-selection"></a>

## Runtime file selection and installation checks

Desktop packs workspace packages locally and installs external dependencies through the target's bundled Node and pnpm. [Desktop's file policy](../scripts/runtime-file-policy.ts) then filters the immutable `resources/app.asar/dsh/node_modules` copy before signing and integrity sealing. It omits TypeScript declarations, recognized JavaScript/CSS/TypeScript source maps, TypeScript build caches, Domino's test directory and Yarn development metadata, selected native compiler outputs, and node-pty prebuilds for other platforms. Non-Windows targets also omit `node-pty/third_party/conpty`; Windows targets retain that directory. It preserves runtime JavaScript, target native modules and their DLL/EXE helpers, WASM, unknown assets, licenses, and notices. Dependency manifests pass through electron-builder's metadata cleanup before integrity sealing, so archiving preserves their recorded bytes. The policy does not alter npm tarballs, the bundled package manager, or user-installed plugin files.

The [Electron shell file list](../scripts/electron-builder-config.mjs) excludes recognized JavaScript/CSS/TypeScript source maps and TypeScript build caches from the separate `resources/app.asar/node_modules` dependency collection. These exclusions preserve runtime code, native modules, WASM, data files (including ordinary `.map` assets), licenses, and notices; [shell archive tests](../tests/shell-file-selection.spec.ts) check retained bytes and exclusions.

The [Office conversion provider](../../../packages/document/office-kit/README.md) is a Host service mounted by web-app, so every application that loads web-app, including `stitch web` and Desktop, provides it together with the [Office tools](../../../packages/document/tool-office/README.md). The provider [resolves the Kit's engine itself](../../../packages/document/office-kit/README.md#understand-the-implementation), including the mapping of native engine manifests to unpacked physical directories. Desktop packaging only carries and unpacks the engine: it carries the target’s declared native engine, or WASM when the kit declares no matching native target, and preparation rejects a missing target engine before packaging. The complete Office dependencies, including the JavaScript libraries and the selected engine’s executables, data, licenses, and notices, are unpacked under `resources/app.asar.unpacked/dsh/node_modules/`. The Desktop shell passes the primary runtime location to the Host in [main.ts](../src/main.ts), and the Host sets it as `STITCH_PRIMARY_RUNTIME`; neither passes a Kit location. Office skills are available in every application that loads web-app, and Desktop reads them from the skill package inside `resources/app.asar`; only Desktop mounts the bundled Python environment (`workspace-dependencies`). On macOS, the native helper receives the JIT entitlement required by [LibreOffice’s UNO bridge](https://github.com/LibreOffice/core/blob/master/sysui/desktop/macosx/hardened_runtime.xcent.in). The Computer Use helper applications under `@deepseek-ai/dsh-cua-macos/native/bin` are also unpacked whole under `resources/app.asar.unpacked/dsh/node_modules/`, and the provider opens that copy.

The packaged application runs compiled JavaScript and pre-generated Typert metadata; it does not compile TypeScript plugins. Source-level debugger navigation and editor declarations remain available in development packages. [Copy-policy tests](../tests/runtime-file-policy.spec.ts) cover exclusions and retained assets; The [payload smoke](../tests/fixtures/runtime-payload-smoke.mjs) runs under Electron RunAsNode before the Host smoke and final inventory verification. The payload smoke resolves the search tool’s ripgrep executable and verifies text search and file enumeration. Signed Windows builds run these checks after dependency signing; other builds run them during `prepare:stitch`. The [Host smoke](../scripts/smoke-runtime.ts) creates DOCX, XLSX, and PPTX inputs with bundled Python and runs each through the real Office provider: PDF conversion, PNG rendering, conversion to the matching OpenDocument format, and, for XLSX, recalculation, checking each output's signature. Every assembled application, including directory and unsigned builds, repeats the payload and Host checks against ASAR. Archive integrity checks compare the complete archived descriptor with preparation, file bytes and membership in both archive and unpacked trees, recorded executable flags for archived files, and physical permissions for unpacked files. Conversion failures stop packaging before a release record is written; macOS DMG/ZIP builds run these checks before notarization.

Windows release qualification also runs [directory and replacement checks](../scripts/smoke-windows.ps1) manually after the Desktop build. Set `$Makensis`, `$SevenZip`, and `$PluginDir` to the pinned builder’s NSIS compiler, 7-Zip executable, and x86-unicode NSIS plugin directory; pass the prepared `window-frame.dll` as `-FrameLibrary` to exercise the native extraction path and its failure report as well. From the repository root, run the command below. It verifies directory replacement and rollback, and both locked-file replacement modes; it is not part of the unit-test lane.

```powershell
pwsh -NoProfile -File apps/desktop/scripts/smoke-windows.ps1 -Makensis $Makensis -SevenZip $SevenZip -PluginDir $PluginDir -FrameLibrary apps/desktop/.desktop-build/targets/win-x64/installer-ui/window-frame.dll
```

The Windows installer checks for a running application at startup and after destination selection, before extracting the new version beside the installation directory. It checks again before replacing directories through same-volume renames. A running application blocks installation; update launches allow up to ten seconds for it to exit. Same-path upgrades preserve the old directory until promotion succeeds; extraction failure leaves it intact, and promotion failure attempts to restore it. The installer removes the old backup before launch. Forced termination or power loss can leave `.new-*` or `.old-*` directories; installation-location and scope migrations retain electron-builder's old-uninstaller flow.

Directory renames, empty-destination removal, and restoration retry Windows errors 5, 32, and 33 up to ten attempts, with 250 ms increasing delays (11.25 seconds of total waiting per operation). Other errors stop immediately. A replacement failure reports the Windows error, affected paths, and restoration outcome in `directory-failure-<timestamp>.log` beside extraction reports. If restoration fails, the installer removes unlocked staging files and preserves the backup. After reporting that failure, exit cleanup does not retry restoration. Keep the backup path named in the report and contact support before reinstalling. Silent installs save the same diagnostic without a dialog.

When extraction fails, the installer writes a report with the 7-Zip result and its complete error output to `%LOCALAPPDATA%\<package-derived name>-updater\installer-logs\extract-failure-<timestamp>.log` (currently `@deepseek-aidsh-desktop-updater`) and shows the first error line with a **Copy error details** button; silent installs write only the report. Unsigned Windows builds (`STITCH_DESKTOP_UNSIGNED=1`) name their installer `stitch-<version>-win-x64-unsigned.exe` so they cannot be mistaken for release artifacts.

Windows packaging fixes the 7-Zip filter to `BCJ` for compatibility with the bundled NSIS decoder. This preserves ARM64 binaries carried by dependencies in x64 installers; automatic ARM64 filtering produces entries that this decoder cannot extract.

`STITCH_DESKTOP_WINDOWS_COMPRESSION_LEVEL` in the Windows dotenv or machine preset selects installer archive compression from `0` to `9`. If omitted, the existing `ELECTRON_BUILDER_COMPRESSION_LEVEL` environment override remains effective, otherwise the default is `3` for both test and production. Lower levels trade installer size for packaging time; qualify the complete signed build and artifact size before changing a release preset.

NSIS removes its temporary extraction tree during installation, before the completion page or an automatic launch. The installed production packages remain ordinary files; startup does not extract them again. Installation still writes the complete application tree.

<a id="desktop-runtime-preparation"></a>

## Desktop runtime preparation

Windows prepares Electron and primary-runtime concurrently; macOS prepares them serially. CLI preparation and `versions.json` publication require both payloads to succeed. If either Windows payload fails, preparation waits for the other to settle before reporting failure and publishes neither CLI resources nor versions. Nested preparation timings overlap and must not be added together.

`STITCH_DESKTOP_PACKAGE_CACHE_DIR` in the packaging process environment selects a nonempty absolute directory for shared `downloads` and `pnpm-store` caches; omission uses `.desktop-build`. Temporary installation projects, lockfiles and configuration remain separate per run. Runtime installation verifies store integrity and copies package files so later signing cannot modify cached bytes; cleanup retains these caches. Installation logs identify their store and report package reuse. A fresh runtime lockfile still resolves dependencies on every run. Share writable caches only among trusted build jobs; integrity checks do not isolate untrusted writers. Clean caches only when no job is using them. Operators manage cache disk usage; no automatic eviction runs.

Desktop [patch policy](../scripts/runtime-patch-policy.ts) explicitly classifies every workspace patch as shared, workspace-only, or runtime-only. Shared entries reuse the root patch bytes and verify their hash against the root lockfile; runtime-only entries use separate repository files without changing workspace installation. Workspace-only patches belong to build tools or dependencies already embedded in client bundles. Unclassified or stale entries, missing files, changed hashes, incompatible resolved versions, and workspace-only packages entering the runtime stop packaging. The [preparation script](../scripts/prepare-runtime-patches.ts) writes only to the temporary project; pnpm applies the selected patches and rejects application failures.

Desktop dependency overrides are declared separately in the patch-policy module, not inferred from patch versions. The pi-ai constraint keeps its runtime version at the version qualified by the shared patch. Desktop still resolves a fresh runtime lockfile for each build, then installs with `--frozen-lockfile`; dependency resolution across separate builds is not yet reproducible. CLI packed-installation tests and other distribution flows retain their own configuration.

Every package command builds the repository, packs the first-party production closures rooted at stitch and the private Desktop Host, and prepares the target Electron distribution plus primary-runtime with its shared pnpm CLI. `prepare:stitch` installs the production graph once at build time, prepares materialized packages for electron-builder to archive under `app.asar/dsh`, removes package-manager metadata, and writes `desktop-runtime.json` with shared package versions and final file hashes. Signed macOS builds sign and verify native files, and verify the notarized Computer Use helper bundles without re-signing them, before inventory generation; electron-builder excludes this already-signed tree from nested re-signing. Resource mappings explicitly include `dsh/node_modules`, which the default root-directory filter omits; the prepared runtime inventory is checked after native signing. Native executables and libraries are unpacked beside ASAR; Python, standalone Node and pnpm remain in external runtime resources. Windows packaging checks every prepared PE against its ASAR unpacked entry and byte-identical disk copy, including unsigned builds. Builder glob rules match braces in PE filenames as single-character wildcards, so a matching neighboring file may also be unpacked. Prepared runtime smoke uses the verified target descriptor rather than the build host architecture. Signed installer, notarization, installed upgrade, and target-specific native-module qualification require the release environment.

Windows runtime sealing reads at most eight files concurrently, before and after native signing. A read failure drains outstanding reads without replacing the descriptor; successful sealing still requires the subsequent complete integrity and smoke checks.

An unpacked artifact contains Electron, the materialized stitch production tree, pnpm, and the shell application. Installer size and filesystem size differ; release qualification measures both, plus the profile’s plugin storage and first-launch latency. The runtime trades more application files for eliminating core package installation on the user’s machine.

<a id="verification"></a>

## Installation and release verification

Windows lists the installed application by product name without a version suffix; the version remains in the separate version field. Desktop's `package.json` `author.name` supplies the installer publisher and executable company name, independently of the signing certificate. Windows and macOS retain product-name copyright text. Installation or upgrade with a rebuilt installer applies the new metadata; existing installations retain their previous values until then.

Keep the generated installer, its version and packaging records together. Review signatures and runtime checks before installation, then record installed launch and upgrade evidence manually. The [Desktop test record](../tests/README.md) owns verification limits; a successful build alone does not establish production preset, new-workstation or installed-upgrade acceptance.

## Dev Note

XXX: Evaluate disk-space monitoring, a maintenance entry point and automatic eviction if disk shortages, sustained cache growth or frequent manual cleanup occur. Any automated cleanup would need coordination with every cache user.
