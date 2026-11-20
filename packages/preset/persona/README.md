---
description: "The composable persona row presets mount to give one agent its own system-prompt persona, for users and maintainers configuring or debugging it."
kind: "package-reference"
---

# @deepseek-ai/dsh-persona

English | [中文](README.zh.md)

## Summary

`dsh-persona` gives one agent its own persona: a preset mounts this composable row to register persona prefix and suffix sections, shadowing the deployment-wide defaults for that session. It can also make the prefix the session's complete system prompt, suppressing every other section, and can turn off optional runtime context for the session. In short-prompt mode it follows the prefix with a short tool list and rules generated from the tools mounted in the session. Mount it inside a preset composition — mounting it globally collides with the prompt registry's own persona registration and fails loud. Without this row, a preset could change an agent's tools but never its identity.

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

Mount this row inside a preset composition to give that preset's sessions their own persona. The row needs an agent scope: mounted outside one it collides with the prompt registry's own `deployment:persona-prefix` registration and fails loud — the deployment persona already has an owner, and the whole point of this row is to shadow it for one agent.

### Configuration

```yaml
- name: '@deepseek-ai/dsh-persona'
  config:
    prefix: You are a terse systems engineer who answers in short commands.
```

| Field | Default | Meaning |
|---|---|---|
| `prefix` | required | Persona prose rendered as the `deployment:persona-prefix` section |
| `suffix` | `''` | Template for `deployment:persona-suffix`; omitted or empty text shadows the global suffix away |
| `complete` | `false` | Use only the rendered prefix as the system prompt; ignore the suffix |
| `includeRuntimeContext` | `true` | Include optional runtime context for this agent scope; false suppresses optional contributions without disabling their owning services; required contributions remain |
| `omitSections` | `[]` | Names of other prompt sections (for example `tool:read`) this agent scope assembles without; unnamed sections are untouched |
| `shortPrompt` | `false` | Follow the prefix with a `<tools>` and `<rules>` list generated from the mounted tools' short-prompt contributions, and leave out the long guidance sections those contributions replace |
| `rules` | `[]` | The persona's own rules, closing the generated `<rules>` list; used only with `shortPrompt` |

The generated [configuration catalog](../../../docs/config-catalog.md#deepseek-aidsh-persona) is the exhaustive source for every accepted field and its JSDoc.

### Persona behavior

The persona `prefix` and `suffix` are templates: complete `{{…}}` groups resolve strictly against registered prompt variables when the prompt renders, not when it assembles. Each empty template still shadows its deployment-wide section, then disappears at render. Omitted `suffix` defaults to empty; it does not inherit the global suffix. With `complete: true`, assembly still resolves contexts, tools, variables, and cooperative listeners, but the prompt registry restores this exact prefix as the sole section; no identity, suffix, tool guidance, or listener can append prompt text. With `includeRuntimeContext: false`, optional context providers are not evaluated for this scope, and assembly-listener contributions are discarded unless registered as required. Required providers remain active at assembly and request admission.

### Generated short prompt

With `shortPrompt: true`, the row registers the `persona:short-prompt` section right after the prefix. At every assembly it reads the tools visible to the assembling scope for that step and renders:

```text
<tools>
- read: Read a text file with line numbers
- job_list / job_output / job_kill: Check on, read, or stop background commands

Additional tools may be available.
</tools>

<rules>
- Use read to examine files instead of cat or sed.
- Be concise, and show file paths clearly.
</rules>
```

Each tool declares its line next to its own long guidance, in the `shortPrompt` field of its tool definition (`summary`, `rules`, `order`, `replaces`; see [`dsh-tools`](../../core/tools/README.md)). Tools with the same summary share one line; lines and rules follow `order`, then name; a rule several tools declare appears once; a rule with `when` or `unless` appears only while the named tools are (or are not) mounted, which is how the shell's file-operation rule gives way to the glob and grep rule. A tool without a declared summary is listed by the first sentence of its description. The row's own `rules` close the list. The long guidance sections named by the mounted tools' `replaces` (by default `tool:<name>`) are left out of this scope; tools without a contribution keep theirs, and every other section stays.

### When to use it

Use this row when a preset must change an agent's identity and not only its tools. The deployment-wide persona itself is configured on the `dsh-system-prompt` row, not here; this row exists only to shadow or replace it for one agent.

-----

<a id="understand-the-implementation"></a>
## Understand the implementation

<details>
<summary>Implementation internals — click to expand</summary>

### How the row registers

The row registers scoped persona prefix and suffix sections using the registry's shared names and named orders. Each shadows its deployment default instead of appearing beside it; the registry owns ordering, interpolation, and complete-prompt enforcement. `includeRuntimeContext: false` calls `ctx.systemPrompt.suppressRuntimeContext()`.

### Why the row is scope-only

`dsh-system-prompt` owns the global persona as its own config and registers `deployment:persona-prefix` unconditionally, so a process has exactly one. This row collides with that registration outside an agent scope, by design: the row exists because a preset cannot mount the prompt registry itself.

### Source map

| File | Role |
|---|---|
| [`src/index.ts`](src/index.ts) | Plugin entry: `Config` schema, persona section registration, runtime-context suppression |
| [`src/short-prompt.ts`](src/short-prompt.ts) | Short-prompt rendering from tool definitions and the long sections they replace |

</details>

-----

<a id="further-exploration"></a>
## Further Exploration

Read these pages when the package-level contract is not enough; they move from the preset composition to the prompt registry this row feeds.

- [agent-presets package](../agent-preset-registry/README.md) — the preset composition this row mounts into.
- [System prompt subsystem](../../../docs/subsystems/system-prompt.md) — sections, assembly, and the persona slot this row shadows.
- [Generated configuration catalog](../../../docs/config-catalog.md#deepseek-aidsh-persona) — every accepted config field and its source declaration.

-----

<a id="model-experience"></a>
## Model Experience

### The persona section

#### What the model sees

The `deployment:persona-prefix` section at order `0` carries this row's `prefix`; `deployment:persona-suffix` at order `10200` carries its `suffix`, after first-party guidance. Both replace their deployment defaults and resolve prompt variables. In complete mode, the model sees only the rendered prefix section as its system prompt. Runtime context remains enabled by default. With `includeRuntimeContext: false`, the model still receives required context, such as the current working directory and subagent identity; optional context is omitted. In short-prompt mode, the `persona:short-prompt` section at order `10` follows the prefix with one `<tools>` line per mounted tool (or group sharing a summary) and the applicable `<rules>`; the long `tool:*` guidance of tools that declare a short contribution is absent, while every other section and the runtime context are unchanged. Tool schemas are unchanged.

#### Token effect

Fixed for a given preset: the persona prefix and suffix tokens on every request that agent makes, and none for any other agent. Empty text contributes nothing. Complete mode removes every other system-prompt token for that agent. Required runtime context still contributes tokens when optional context is disabled. In short-prompt mode the generated section replaces the long guidance of the contributing tools; it grows by one line per mounted tool and one per distinct rule.

#### KV Cache effect

Prefix-stable while the rendered template variables and text are unchanged. Suffix changes leave preceding instructions unchanged when the model, prefix, and tools match. Prefix changes affect the early prefix; provider cache sharing is not guaranteed. The generated section changes when a tool is mounted or removed, and stays byte-stable while the mounted set is unchanged.

## Known Limitations and Deferred Work

<a id="known-limitations-and-deferred-work"></a>


These limits define when the row is a poor fit. They are current package constraints, not a task backlog.

- **No global mount** — the prompt registry owns the unscoped persona slot, so this row is usable only from a scoped composition. A deployment-wide persona change belongs in the `system-prompt` row's own config.
- **No per-provider runtime-context filter** — `includeRuntimeContext: false` suppresses all optional contributions for the scope; it cannot suppress required contributions.

<a id="dev-note"></a>
### Dev Note

<details>
<summary>Working context for maintainers — click to expand</summary>

None.

</details>
