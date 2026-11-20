---
description: "Gives the Creator agent the read-only plugin_market tool; off by default."
kind: "package-bundle"
---

# @deepseek-ai/dsh-component-plugin-market-tool

English | [中文](README.zh.md)

## Summary

Gives the agent in Creator mode the read-only `plugin_market` tool, which searches the plugin indexes configured in Discover. The tool is off in both component sets, so the agent's instructions stay short; the Discover tab of the Plugins page works without it.

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

In Web or Desktop, open Plugins, choose **Show advanced**, and switch **Plugin market tool for the agent** on or off, or tick it in the first-run component picker's Custom set.

-----

<a id="understand-the-implementation"></a>
## Understand the implementation

<details>
<summary>Implementation details — click to expand</summary>

[`cordis.patch.yml`](cordis.patch.yml) mounts the `component-plugin-market-tool` marker row that opens the `component: plugin-market-tool` gates of the [agent presets](../../preset/agent-preset-registry/README.md).

Preset rows gated on it: `tool-plugin-market` in the Creator preset. That row also stays disabled without a profile, and it registers the tool only while the [`pluginMarket`](../../boot/plugin-market/README.md) service runs, which [dsh-web-app](../../bundle/web-app/README.md) mounts in every profile-backed Web composition.

</details>

-----

<a id="further-exploration"></a>
## Further Exploration

- [Components](../README.md) — the component sets and how gates work.

-----

<a id="model-experience"></a>
## Model Experience

Indirectly, through the Creator preset: with the component on, Creator sessions carry the [`plugin_market` tool](../../boot/plugin-market/README.md#model-experience) declaration and its results; with it off, they carry neither.

#### KV Cache effect

Switching the component changes the tool list of sessions created afterwards; existing sessions keep the preset revision they started with.

## Known Limitations and Deferred Work

<a id="known-limitations-and-deferred-work"></a>

- Only the Creator preset declares the tool row this component opens; the Standard and PTC presets keep their rows disabled.

-----

<a id="dev-note"></a>
### Dev Note

<details>
<summary>Maintainer context — click to expand</summary>

None.

</details>
