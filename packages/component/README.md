---
description: "Feature components a Web or Desktop profile switches on and off: each bundle turns one whole feature on, and named sets choose Standard or Minimal."
kind: "package-group"
---

# component/ — feature components

English | [中文](README.zh.md)

## Summary

A component is one feature of the Web and Desktop composition — its tools, panels, commands, skills, and settings pages — packaged as a bundle the Plugins page switches on and off. The `web` profile template selects `dsh-base`, `dsh-web-app`, and the Standard set, which is the complete shipped composition. The Minimal set keeps the always-on core (chat, files, shell, edit tools, settings, Plugins, model providers, approvals, and self-modification tools) plus a few panels and a short system prompt. The contract lives in [`@deepseek-ai/dsh-official-bundles`](../util/official-bundles/src/components.ts).

## Table of Contents

- [Packages](#packages)
- [How components compose](#how-components-compose)
- [Related documentation](#related-documentation)
- [Dev Note](#dev-note)

<a id="packages"></a>
## Packages

| Component | Package | Standard | Minimal | Needs |
|---|---|---|---|---|
| Files & preview | [`files`](files/README.md) | ✓ | ✓ | — |
| Terminal | [`terminal`](terminal/README.md) | ✓ | ✓ | — |
| Browser panel | [`browser`](browser/README.md) | ✓ | ✓ | — |
| Search tools | [`search-tools`](search-tools/README.md) | ✓ | — | — |
| Web | [`web`](web/README.md) | ✓ | — | — |
| Background jobs | [`jobs`](jobs/README.md) | ✓ | ✓ | — |
| Planning | [`planning`](planning/README.md) | ✓ | — | — |
| Goals | [`goals`](goals/README.md) | ✓ | — | — |
| Schedules | [`schedules`](schedules/README.md) | ✓ | — | — |
| Subagents | [`subagents`](subagents/README.md) | ✓ | — | — |
| Agent teams | [`agent-teams`](agent-teams/README.md) | ✓ | — | `subagents` |
| Workflows | [`workflows`](workflows/README.md) | ✓ | — | `subagents` |
| Office documents | [`office`](office/README.md) | ✓ | — | — |
| Workspace tracking | [`workspace-tracking`](workspace-tracking/README.md) | ✓ | ✓ | — |
| MCP connectors | [`mcp`](mcp/README.md) | ✓ | — | — |
| Context helpers | [`context-helpers`](context-helpers/README.md) | ✓ | ✓ | — |
| Extra presets | [`presets`](presets/README.md) | ✓ | ✓ | — |
| Short system prompt | [`short-prompt`](short-prompt/README.md) | — | ✓ | — |

Optional bundles outside this table stay off in both sets.

<a id="how-components-compose"></a>
## How components compose

- **Host and browser rows.** dsh-web-app keeps every component-owned row in place with `disabled: true  # component: <id>`, and disables shared dsh-base rows a component owns with the same mark. The component bundle sets those rows' `disabled` back, so ids, positions, and configuration are those of the composition before components existed.
- **Preset rows.** A row inside an agent preset's `plugins` may carry `component: <id>` (or `!<id>`, or a list). The [preset registry](../preset/agent-preset-registry/README.md) drops rows whose gate fails before it mounts the preset, and a `component:` on the preset itself hides the whole preset. Each component mounts a `component-<id>` marker row; starting or stopping a marker re-composes the presets, and live sessions keep the revision they started with.
- **Prerequisites.** A bundle lists the bundles it needs in `dsh.bundle.requires`. The plugin manager enables prerequisites together with a bundle and disables the bundles that need one it disables; `setBundlesEnabled` applies a whole selection in one profile write and one reload.
- **Existing profiles.** A profile that selects dsh-web-app and no component, as every profile written before components did, receives the Standard set after dsh-web-app when it loads.

<a id="related-documentation"></a>
## Related documentation

- [bundle/](../bundle/README.md) — the profile bundles components layer over.
- [Plugin manager](../boot/plugin-manager/README.md) — enables, disables, and classifies component selections.
- [Generated composition graph](../../apps/cli/composition.md) — the exact composition each shipped profile uses.

<a id="dev-note"></a>
## Dev Note

None.
