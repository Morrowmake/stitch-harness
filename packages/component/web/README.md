---
description: "Web search (no key needed) and web fetch tools, with their settings page."
kind: "package-bundle"
---

# @deepseek-ai/dsh-component-web

English | [中文](README.zh.md)

## Summary

Web search (no key needed) and web fetch tools, with their settings page. This component is part of the Standard component set.

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

In Web or Desktop, open Plugins and switch **Web** on or off, or choose a component set with the first-run component picker. The `web` profile template selects the Standard set.

-----

<a id="understand-the-implementation"></a>
## Understand the implementation

<details>
<summary>Implementation details — click to expand</summary>

[`cordis.patch.yml`](cordis.patch.yml) switches on the rows that [dsh-web-app](../../bundle/web-app/README.md) keeps disabled with a `# component: web` mark, and mounts the `component-web` marker row that opens the `component: web` gates of the [agent presets](../../preset/agent-preset-registry/README.md). The rows keep their ids, positions, and configuration in dsh-web-app and dsh-base, so later profile patches address them as before.

Host and browser rows it switches on: `web`, `web-search-keyless`, `web-fetch-http`, `ui-settings-web-search`.

Preset rows gated on it: `tool-web`.

</details>

-----

<a id="further-exploration"></a>
## Further Exploration

- [Components](../README.md) — the component sets and how gates work.

-----

<a id="model-experience"></a>
## Model Experience

Indirectly, through the `web_search` and `web_fetch` tools and their prompt guidance it adds to the Standard, PTC, and Creator presets.

#### KV Cache effect

Switching the component changes the composition of sessions created afterwards; existing sessions keep the preset revision they started with.

## Known Limitations and Deferred Work

<a id="known-limitations-and-deferred-work"></a>

- None.

-----

<a id="dev-note"></a>
### Dev Note

<details>
<summary>Maintainer context — click to expand</summary>

None.

</details>
