---
description: "Run commands in the background, with the job tools and the jobs panel."
kind: "package-bundle"
---

# @deepseek-ai/dsh-component-jobs

English | [中文](README.zh.md)

## Summary

Run commands in the background, with the job tools and the jobs panel. This component is part of the Standard and Minimal component set.

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

In Web or Desktop, open Plugins and switch **Background jobs** on or off, or choose a component set with the first-run component picker. The `web` profile template selects the Standard set.

-----

<a id="understand-the-implementation"></a>
## Understand the implementation

<details>
<summary>Implementation details — click to expand</summary>

[`cordis.patch.yml`](cordis.patch.yml) switches on the rows that [dsh-web-app](../../bundle/web-app/README.md) keeps disabled with a `# component: jobs` mark, and mounts the `component-jobs` marker row that opens the `component: jobs` gates of the [agent presets](../../preset/agent-preset-registry/README.md). The rows keep their ids, positions, and configuration in dsh-web-app and dsh-base, so later profile patches address them as before.

Host and browser rows it switches on: `jobs`, `job-controller`, `ui-jobs`.

Preset rows gated on it: `tool-jobs`.

</details>

-----

<a id="further-exploration"></a>
## Further Exploration

- [Components](../README.md) — the component sets and how gates work.

-----

<a id="model-experience"></a>
## Model Experience

Indirectly, through `run_in_background` on the shell tool and the `job_*` tools with their prompt guidance; without it, shell commands run in the foreground only.

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
