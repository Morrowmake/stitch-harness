---
description: "Replaces the long tool guidance of the default preset with a short prompt."
kind: "package-bundle"
---

# @deepseek-ai/dsh-component-short-prompt

English | [中文](README.zh.md)

## Summary

Replaces the long tool guidance of the default preset with a short prompt. The prompt is generated from the tools mounted in each session, so it composes with any component selection. Short prompt is a Custom switch and is off in the Standard set.

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

Preset rows gated on it: `persona-short`. That row mounts [dsh-persona](../../preset/persona/README.md) with `shortPrompt: true`, an opening line that names Stitch, and the closing rule "Be concise, and show file paths clearly."; it omits the `harness:identity` section because the opening line already names Stitch. Each tool brings its own summary and rules through the `shortPrompt` field of its tool definition, so enabling a component adds its tools' lines and disabling it removes them.

The model sees:

```text
You are a coding agent running inside Stitch, an agent harness you can modify while it runs. Help the user inspect files, run commands, and change code. The model is {{model}}.

<tools>
- <tool>: <one-line summary>

Additional tools may be available.
</tools>

<rules>
- <the mounted tools' rules>
- Be concise, and show file paths clearly.
</rules>
```

There is one line per mounted tool (tools that share a summary share a line, such as `job_list / job_output / job_kill`). Without glob and grep, the shell tool adds "Use bash for file operations like ls, rg, find." (on Windows: "Use PowerShell for file operations like listing, searching, and finding files."); with them, the search tools' rule replaces it. The long guidance sections of tools that declare a short contribution are left out. Every other prompt contribution follows unchanged: other components' policies such as plan mode or team policy, long guidance of tools without a short contribution, and the runtime context (working directory, date and time, sandbox and approval policy, skill catalog, AGENTS.md). Tool schemas are unchanged.

</details>

-----

<a id="further-exploration"></a>
## Further Exploration

- [Components](../README.md) — the component sets and how gates work.

-----

<a id="model-experience"></a>
## Model Experience

Indirectly, through the short tool list and rules that the `persona-short` row of the default (Standard) preset puts in place of the long tool guidance.

#### KV Cache effect

Switching the component changes the composition of sessions created afterwards; existing sessions keep the preset revision they started with. Within a session the generated tool list stays byte-stable until a tool is mounted or removed.

## Known Limitations and Deferred Work

<a id="known-limitations-and-deferred-work"></a>

- Only the Standard preset uses the short prompt; the PTC, Minimal, and Creator agent presets keep their own personas.

-----

<a id="dev-note"></a>
### Dev Note

<details>
<summary>Maintainer context — click to expand</summary>

None.

</details>
