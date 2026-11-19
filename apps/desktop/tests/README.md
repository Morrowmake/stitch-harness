# Desktop local verification

English | [中文](README.zh.md)

## Summary

Local shell-dialog and update-check evidence is separate from production backend integration, visual acceptance, and installed-application upgrades.

## Table of Contents

- [Fault-report verification](#verification-diagnostics)
- [Update dialog themes](#verification-theme)
- [Native overlay visibility](#verification-overlay)
- [Evidence](#verification-evidence)
- [Open verification](#verification-open)

<a id="verification-diagnostics"></a>

## Fault-report verification

See [recovery and diagnostics](../docs/diagnostics/README.md) for product behavior and limitations.

Use a disposable profile and separate Electron `userData` with the actual packaged client. Construct a minimal local bundle with `package.json`, `dsh.bundle.patch` pointing to `cordis.patch.yml`, and an optional plugin module; archive it as a local `.tgz`. These packages deliberately break the application and must not be published or installed in a daily profile.

Exercise import and plugin-initialization exceptions, an asynchronous exception after `appReady`, and a nonzero Host exit. A patch disabling the `agent`, `session`, `llm`, and `tools` providers exercises missing-service diagnostics. To check cross-restart history, select that bundle through `pluginManager`, then restart the same profile. Runtime scenarios require observing actual client readiness; `appReady` alone does not establish that the window is visible.

Check the original error and cause or exit code, operation and Host run IDs across restart, report-collection completion and omissions, file retrieval from the native dialog, and startup after plugin recovery. Record the package version and source commit; successful package generation or a management result alone does not establish client functionality. Restore protocol associations and stop test processes afterward.

For resource checks, use large sparse history files, unrelated files, dense records, and malformed or unfinished lines. Measure setup separately from collection in fresh processes, recording actual bytes read, output size, time, and peak memory. To check Worker cancellation, a test-only module hook can hold an asynchronous file open after writing an entry marker. Confirm that marker, observe Worker exit after the deadline, and compare the basic report bytes. This does not reproduce a kernel-hung system call or establish packaged-client behavior.
<a id="verification-theme"></a>

## Update dialog themes

After `pnpm --dir apps/desktop run build`, run the real Electron palette fixture on macOS:

```sh
apps/desktop/.desktop-build/targets/mac-arm64/electron/Electron.app/Contents/MacOS/Electron apps/desktop/tests/fixtures/update-theme.mjs
```

The fixture creates a private profile, loads the production shell HTML, sandboxed preloads, renderer scripts, and bundled design tokens, and substitutes only fixed IPC status responses. Its six cases cover the ordinary update document starting in light/dark mode, switching while open, and following system appearance. It checks transparent document backgrounds, surface/text/button/mask colors, the code/address surface, the dark-only 1 CSS px inset outline, and the ordinary close icon, then writes two screenshots and `result.json` to `.desktop-build/qualification/update-theme-*`. It does not start a Host, download updates, run an installer, or qualify Windows native rendering. The first-close notice shares the ordinary document's CSS and theme script.

<a id="verification-overlay"></a>

## Native overlay visibility

On macOS, reuse the cached Electron runtime after compiling the Desktop Host sources:

```sh
pnpm exec tsc -b apps/desktop/tsconfig.host.json
apps/desktop/.desktop-build/targets/mac-arm64/electron/Electron.app/Contents/MacOS/Electron apps/desktop/tests/fixtures/update-overlay-visibility.mjs
```

The fixture owns a unique profile and writes `result.json` under `.desktop-build/qualification/update-overlay-*`. It checks visible and hidden owners, absence of native child windows, retention of a separate control window’s focus after owner visibility notifications, and view/input cleanup including owner destruction. It uses no network, product login, or dsh Host. It qualifies the in-window carrier, not the full first-login or installation flow.

<a id="verification-evidence"></a>

## Evidence

Packaging supervision fixtures control their Git metadata and use real file hashes with inert child processes. Git-head and worktree changes still refuse packaging; concurrent tests cannot change the fixture's recorded Git inputs.

| Layer | Observed result |
|---|---|
| Update check | Unit tests with a substituted fetch cover semver comparison, draft and prerelease handling, project release-page validation, opt-in gating (no request while off, across startup and several days), startup and daily scheduling, immediate checks on enabling, silent automatic failures, and Check now results |
| Main entry | Main-entry tests verify that no GitHub request is made by default, that enabling persists `updates.checkForUpdates`, checks once and daily, offers Download/Later and opens only the release page, and that Settings and the menu report available, current, and failed results |
| Settings row | Client tests cover the off-by-default toggle, save failures, and each Check now outcome; the [browser scenario](../../web/tests/desktop-update-check.e2e.ts) drives the built Settings UI through a substituted Desktop carrier |
| Packaging configuration | Metadata embeds the configured application ID and no update publisher |

<a id="verification-open"></a>

## Open verification

The following items are not passing evidence and must remain visible during review:

- Electron `capturePage()` captures individual windows. Cross-platform Figma/layout acceptance and a complete recording remain unverified.
- No test contacts the real GitHub API; proxy handling relies on Electron's network stack and is not exercised by an automated test.
- Native clipboard writing passes on Windows. Default-browser launch is attempted, but destination verification stops because the automation tool cannot reliably identify the current URL. macOS browser and clipboard integration remain unverified.
- Full `doc-sync` encounters Windows file-symlink `EPERM` in the documentation-site test and does not make the full documentation gate green.
