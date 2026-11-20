---
description: "Records the files each turn changes and shows the changed-files and delivery cards."
kind: "package-bundle"
---

# @deepseek-ai/dsh-component-workspace-tracking

English | [中文](README.zh.md)

## Summary

Records the files each turn changes and shows the changed-files and delivery cards. This component is part of the Standard and Minimal component set.

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

In Web or Desktop, open Plugins and switch **Workspace tracking** on or off, or choose a component set with the first-run component picker. The `web` profile template selects the Standard set.

-----

<a id="understand-the-implementation"></a>
## Understand the implementation

<details>
<summary>Implementation details — click to expand</summary>

[`cordis.patch.yml`](cordis.patch.yml) switches on the rows that [dsh-web-app](../../bundle/web-app/README.md) keeps disabled with a `# component: workspace-tracking` mark, and mounts the `component-workspace-tracking` marker row that opens the `component: workspace-tracking` gates of the [agent presets](../../preset/agent-preset-registry/README.md). The rows keep their ids, positions, and configuration in dsh-web-app and dsh-base, so later profile patches address them as before.

Host and browser rows it switches on: `workspace-changes`, `ui-deliverables`.

</details>

-----

<a id="further-exploration"></a>
## Further Exploration

- [Components](../README.md) — the component sets and how gates work.

-----

<a id="model-experience"></a>
## Model Experience

None, as the component records changed files for the user; requests are unchanged.

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
