---
description: "The workflow tool, its PTC runtime, and the workflow run view. Needs Subagents."
kind: "package-bundle"
---

# @deepseek-ai/dsh-component-workflows

English | [中文](README.zh.md)

## Summary

The workflow tool, its PTC runtime, and the workflow run view. Needs Subagents. This component is part of the Standard component set. It needs the **Subagents** component; the plugin manager switches that on with it, and switching that off also switches this one off.

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

In Web or Desktop, open Plugins and switch **Workflows** on or off, or choose a component set with the first-run component picker. The `web` profile template selects the Standard set.

-----

<a id="understand-the-implementation"></a>
## Understand the implementation

<details>
<summary>Implementation details — click to expand</summary>

[`cordis.patch.yml`](cordis.patch.yml) switches on the rows that [dsh-web-app](../../bundle/web-app/README.md) keeps disabled with a `# component: workflows` mark, and mounts the `component-workflows` marker row that opens the `component: workflows` gates of the [agent presets](../../preset/agent-preset-registry/README.md). The rows keep their ids, positions, and configuration in dsh-web-app and dsh-base, so later profile patches address them as before.

Host and browser rows it switches on: `ptc-runtime`, `ui-workflow-run`.

Preset rows gated on it: `workflow-ptc`, `tool-workflow`.

</details>

-----

<a id="further-exploration"></a>
## Further Exploration

- [Components](../README.md) — the component sets and how gates work.

-----

<a id="model-experience"></a>
## Model Experience

Indirectly, through the `workflow` tool and its prompt guidance it adds to the Standard and Creator presets, and the PTC runtime it supplies to the PTC preset.

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
