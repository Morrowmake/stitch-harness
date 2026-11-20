---
description: "First-run setup for the Stitch web client and desktop app: a provider picker (local Ollama and LM Studio first, any OpenAI-compatible URL, hosted providers with sign-in or API key) with a default model, then the Minimal / Standard / Custom component picker, also reachable from the Plugins page and Settings → Models."
kind: "package-reference"
---

# @deepseek-ai/dsh-client-ui-first-run

English | [中文](README.zh.md)

## Summary

`dsh-client-ui-first-run` walks a new profile through setup once: choose where requests go, choose the default model, and choose which components Stitch runs. The same dialog opens later from the Plugins page ("Choose components…") and from Settings → Models ("Set up a provider…"). The desktop app shows it too, because it renders inside the web UI's shell overlay; no native window is involved.

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

The Web composition mounts the package as the `ui-first-run` row. That row id is also its settings namespace, whose one live field `completedVersion` records that the first run was finished or closed.

### When the dialog opens

| Entry | Steps |
|---|---|
| First run (automatic, once per profile while `completedVersion` differs from the current flow version and settings are writable) | Provider → Default model → Components → Done |
| Plugins page, Add plugin menu → **Choose components…** | Components → Done |
| Settings → Models footer → **Set up a provider…** | Provider → Default model → Done |

Closing the dialog at any step, or pressing the final button, ends it. Ending the automatic first run stores the completion, so it does not open again; the two entry points never touch it.

### Provider step

The step lists, top to bottom:

1. **Already set up**: routes that serve requests now (`llm.listProviders`); **Use** continues to the default model.
2. **On this computer**: the Host probes Ollama (`localhost:11434/api/tags`) and LM Studio (`localhost:1234/v1/models`) through `llmAccounts.probeLocalProviders` when the step opens and on **Check again**. A running server with models offers **Use**, which declares an OpenAI-compatible `llm-pi-ai` route (`ollama` or `lmstudio`, endpoint `…/v1`, the listed models) and stores a placeholder key under the route's derived reference (`OLLAMA_API_KEY`, `LMSTUDIO_API_KEY`), because the OpenAI protocol always sends one.
3. **Any OpenAI-compatible server**: base URL, optional API key, optional name. **Find models** asks the endpoint through `llm.discoverModels`; the user keeps the models to serve, and **Add provider** declares the route (id derived from the name or host, never one a configured or catalog route already uses) with the key, or a placeholder when none was given.
4. **Hosted providers**: the pi-ai catalog routes from `llm.listConfigurableProviders`, searchable. **Sign in** runs an OAuth attempt (`llmAccounts.beginSignIn` / `watchSignIn`, links open in a new tab, device codes and prompts render inline); **API key** stores a key account (`llmAccounts.addApiKeyAccount`), or runs pi-ai's key prompts for providers whose credential has several fields.

**Skip for now** moves past the provider and default-model steps without changes.

### Default-model step

The step lists the new provider's models — the ones the flow already knows for local and custom servers, otherwise the route's group in `session.modelCatalog` (with **Retry** while the route is still registering). **Use as default** writes the `agent-default-model` settings section (`provider`, `model`, and clears `reasoningEffort`), the same complete selection `agentDefaultModel.saveSelection()` stores.

### Component step

The picker reads the official components from `COMPONENTS` in `@deepseek-ai/dsh-official-bundles` and each bundle's title, description, icon, and selection from `pluginManager.listBundles()`; components the installation does not ship are left out. It opens on the profile's current selection, named Minimal, Standard, or Custom.

- **Minimal** and **Standard** select their sets; the list shows what each includes.
- **Custom** keeps the current ticks (Standard's on a fresh profile) and enables the checkboxes; **Start from Minimal** resets the ticks to Minimal. Ticking a component ticks what it requires (Agent teams and Workflows tick Subagents); unticking a requirement unticks its dependents.
- **Apply** sends only the changed bundles in one `pluginManager.setBundlesEnabled` call. The Done step says when the Host reports that a restart is required.

-----

<a id="understand-the-implementation"></a>
## Understand the implementation

<details>
<summary>Implementation internals — click to expand</summary>

`apply` binds every Remote call into plain callbacks (`createFirstRunOperations`, `createComponentOperations`) whose outcomes carry display-ready refusals, and shares one snapshot source for the open state between the overlay and both entry points. The overlay derives visibility during render from that source and the `ui-first-run` configuration form; nothing is fetched until the dialog is open.

| File | Role |
|---|---|
| [`src/index.ts`](src/index.ts) | Host half: the `completedVersion` live field |
| [`src/settings.ts`](src/settings.ts) | Namespace, field, and flow version |
| [`src/client/index.ts`](src/client/index.ts) | Dictionaries and the three registrations |
| [`src/client/operations.ts`](src/client/operations.ts) | Provider, account, discovery, and default-model calls |
| [`src/client/component-operations.ts`](src/client/component-operations.ts) | Component list and batched apply |
| [`src/client/components.ts`](src/client/components.ts) | Set membership, prerequisite ticks, changed bundles |
| [`src/client/flow.ts`](src/client/flow.ts) | Open state and visibility |
| [`src/client/FirstRunOverlay.tsx`](src/client/FirstRunOverlay.tsx) | Dialog and step order |
| [`src/client/ProviderStep.tsx`](src/client/ProviderStep.tsx) | Provider picker |
| [`src/client/SignInPanel.tsx`](src/client/SignInPanel.tsx) | Inline sign-in attempt |
| [`src/client/ModelStep.tsx`](src/client/ModelStep.tsx) | Default-model choice |
| [`src/client/ComponentStep.tsx`](src/client/ComponentStep.tsx) | Component picker |
| [`src/client/EntryPoints.tsx`](src/client/EntryPoints.tsx) | Plugins menu item and Models footer entry |
| [`src/client/locales.ts`](src/client/locales.ts) | Dictionaries (de, en, es, fr, ja, pt, ru, zh) |

</details>

-----

<a id="further-exploration"></a>
## Further Exploration

- [llm-pi-ai](../../llm/llm-pi-ai/README.md) — provider routes, accounts, and the local-server probe.
- [Provider accounts](../ui-llm-accounts/README.md) — the same sign-in and key flows inside each Models card.
- [Plugin manager](../../boot/plugin-manager/README.md) — bundle selection and the batched switch.
- [Agent default model](../../core/agent-default-model/README.md) — the default the model step writes.

-----

<a id="model-experience"></a>
## Model Experience

Indirectly, through the default model and the component bundles it selects, which decide which model later Sessions use and which tools and prompt sections they compose, as documented by those packages; the setup UI itself adds no model input.

#### KV Cache effect

None from this package; a changed component set changes later Sessions' tool lists and system prompt, which their owning packages describe.

## Known Limitations and Deferred Work

<a id="known-limitations-and-deferred-work"></a>

- Local and custom routes take the adapter's fallback context window and output size; adjust them on the Models page when a server's models are smaller.
- The local probe knows only the default ports of Ollama and LM Studio; a server elsewhere is added as a custom URL.

<a id="dev-note"></a>
### Dev Note

<details>
<summary>Working context for maintainers — click to expand</summary>

Client specs render the steps with the English dictionary and fake operations, drive both operation factories against `dsh-remote-mock`, and check the registrations and the automatic first-run visibility with a fake context. Bump `FIRST_RUN_VERSION` only when every user should walk the flow again.

</details>
