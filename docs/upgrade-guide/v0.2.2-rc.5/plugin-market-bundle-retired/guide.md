---
kind: upgrade-guide
description: "The Custom plugin indexes bundle is removed: every Web profile has the Discover tab, and community plugin indexes are no longer a default."
---

# Custom plugin indexes bundle removed

English | [中文](guide.zh.md)

## Change

Previously, switching on **Custom plugin indexes** under **Experimental plugins** appended `@deepseek-ai/dsh-experimental-plugin-market-bundle` to `dsh.profile.bundles` in the profile's `package.json`. That bundle inserted the `plugin-market` Host row and the `ui-plugin-market` Discover tab row, and the `plugin-market` row's default `indexes` listed the Stitch plugin index followed by the DeepSeek Harness community indexes `https://awesome-dsh-plugin.com/index.json` and `https://cdn.dsh.so/market/index.json`.

Now `@deepseek-ai/dsh-web-app` inserts both rows, with the same ids, in every Web profile, so the Plugins page always shows **Installed** and **Discover**. The model's read-only `plugin_market` tool is off by default: the Creator preset offers it only while the optional **Plugin market tool for the agent** component (`@deepseek-ai/dsh-component-plugin-market-tool`) is on, so sessions carry no extra tool declaration unless you switch it on. The bundle is gone: loading a profile removes it from `dsh.profile.bundles` and rewrites `package.json`; other manifest fields are kept, and the Plugins page shows no missing-package entry for it.

The default `indexes` is now the Stitch plugin index alone. The community indexes are offered under **Community indexes** in **Manage index sources…**, and Discover labels every index other than the Stitch index **Community — not reviewed by Stitch**.

An index list the profile saved, which Discover writes as a `plugin-market` override in the profile's `cordis.patch.yml` whenever you add or remove a source, still applies to the same row and is kept as written, community indexes included. A profile that ran the bundle without ever editing its sources had no saved list; it now shows the Stitch index only. Stitch does not carry the old implicit default forward, because community indexes are not reviewed by Stitch and are now added only by choice.

## Migration

1. Start Stitch once with each affected profile; no manual edit is needed. A profile directory that another tool writes must drop the entry from `dsh.profile.bundles` itself.
2. To browse the community indexes again, open **Plugins → Discover → Manage index sources…** and choose **Add** beside each one under **Community indexes**. Alternatively, keep or write `indexes` on the `plugin-market` row in the profile's `cordis.patch.yml`; overrides of `plugin-market` or `ui-plugin-market` in a patch layer match the Web composition's rows unchanged.
3. Confirm: `dsh.profile.bundles` no longer lists the bundle, **Plugins** shows the **Discover** tab without an experimental switch, and **Manage index sources…** lists the sources you expect.
