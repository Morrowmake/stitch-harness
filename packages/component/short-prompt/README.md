---
description: "Replaces the long tool guidance of the default preset with a short prompt."
kind: "package-bundle"
---

# @deepseek-ai/dsh-component-short-prompt

English | [中文](README.zh.md)

## Summary

Replaces the long tool guidance of the default preset with a short prompt. This component is part of the Minimal component set.

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

In Web or Desktop, open Plugins and switch **Short system prompt** on or off, or choose a component set with the first-run component picker. The `web` profile template selects the Standard set.

-----

<a id="understand-the-implementation"></a>
## Understand the implementation

<details>
<summary>Implementation details — click to expand</summary>

[`cordis.patch.yml`](cordis.patch.yml) switches on the rows that [dsh-web-app](../../bundle/web-app/README.md) keeps disabled with a `# component: short-prompt` mark, and mounts the `component-short-prompt` marker row that opens the `component: short-prompt` gates of the [agent presets](../../preset/agent-preset-registry/README.md). The rows keep their ids, positions, and configuration in dsh-web-app and dsh-base, so later profile patches address them as before.

Preset rows gated on it: `persona-short`.

</details>

-----

<a id="further-exploration"></a>
## Further Exploration

- [Components](../README.md) — the component sets and how gates work.

-----

<a id="model-experience"></a>
## Model Experience

Indirectly, through the default (Standard) preset, which replaces its persona with a short Pi-sized prompt and leaves out the usage guidance of the core shell and file tools (`tool:bash`, `tool:pwsh`, `tool:read`, `tool:write`, `tool:edit`, `tool:apply_patch`); every other prompt contribution — other components' tool guidance and policies such as plan mode or team policy — and the runtime context (working directory, sandbox and approval policy, skill catalog, AGENTS.md) still reach the model, and tool schemas are unchanged.

#### KV Cache effect

Switching the component changes the composition of sessions created afterwards; existing sessions keep the preset revision they started with.

## Known Limitations and Deferred Work

<a id="known-limitations-and-deferred-work"></a>

- Only the Standard preset uses the short prompt; the PTC, Minimal, and Creator presets keep their own personas.

-----

<a id="dev-note"></a>
### Dev Note

<details>
<summary>Maintainer context — click to expand</summary>

None.

</details>
