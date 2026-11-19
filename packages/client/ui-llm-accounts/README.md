---
description: "Provider accounts for pi-ai routes in the web client: an Accounts section inside each Models provider card (OAuth sign-in, API-key accounts, default account, pool and model-picker switches, model allowlist, usage bars) and a composer usage badge, all over the `llmAccounts` Remote."
kind: "package-reference"
---

# @deepseek-ai/dsh-client-ui-llm-accounts

English | [中文](README.zh.md)

## Summary

`dsh-client-ui-llm-accounts` lets users keep several named accounts per pi-ai provider — OAuth sign-ins (ChatGPT, Claude, and every other provider pi-ai ships a login for) and API keys — and shows how much of each subscription is used. It adds an Accounts section to every pi-ai provider card on the Models settings page and a usage badge to the composer. The Host (`dsh-llm-pi-ai`) owns the accounts, the pool, and usage; this package only reads `llmAccounts.watch` and writes through the other `llmAccounts` methods.

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

The Web composition mounts the package after `ui-settings-models`. It registers into the `settings.models.provider-card` seat under the `llm-pi-ai` key, so every pi-ai card shows the section without changes to the Models page.

### Accounts section

The section lists the route's accounts in Host order (default first). Each row shows:

| Element | Behavior |
|---|---|
| Name and kind | The alias, else the Host label, with a kind tag: Signed in, API key, Env key (the card's own API-key field), or Environment (ambient credentials). The email or plan derived from the token appears below when known |
| Default | A Default tag, or Make default (`setDefaultAccount`) |
| Health | Cooling down with the time until recovery, or Needs sign-in; Retry now clears the cooldown (`retryAccountNow`) |
| Use in pool | Whether failover may use the account (`updateAccount` `pooled`) |
| Show in model picker | Adds per-account model entries to the picker (`updateAccount` `pinned`) |
| Models… | The allowlist dialog: all models (no list, future models included) or only the ticked ones (an empty selection means none); saved with `updateAccount` `models` |
| Usage | One bar per window with the used share, reset time, plan, credits, and a stale or failed marker; signed-in accounts offer Refresh (`usage` with `force`) |
| Actions | Rename (an empty name clears the alias), Sign in again for OAuth accounts, and Remove with confirmation for removable accounts |

**Sign in with …** appears when the provider offers OAuth. **Add API key** opens a key-and-name dialog (`addApiKeyAccount`) for providers whose key is one value, and an `api-key` sign-in attempt for providers that need more fields. A refused action shows the Host's message under the list.

### Sign-in dialog

The dialog calls `beginSignIn`, then follows `watchSignIn`. Each provider link opens once in a new tab (HTTPS or loopback HTTP only) and stays available as **Open page**; a device code is shown large with **Copy code**. A pending prompt renders as a text, secret, or select field — for a `manual_code` prompt the user pastes the callback URL, which a remote or headless Host needs — and is answered with `answerSignInPrompt`, or skipped with a decline. The dialog closes when the attempt is authorized or cancelled, shows the failure text otherwise, and cancels a running attempt when closed. A second sign-in on the same provider family shows the busy message.

### Usage badge

The `conversation.composer.dock` entry follows the Session's current provider from the model-selection service. It shows the serving account (the Session's sticky account, else the default) and its most constrained window, for example `ChatGPT · Weekly 42%`, and opens a dialog with every account that has usage, current provider first. The used/left display mode is stored in this browser's `localStorage`. The badge renders nothing until an account has usage readings and is absent when the model-selection service is not loaded.

### Privacy

Usage subscriptions (`watch` with `usage: true`) are held only while a provider card's section is mounted, or while a badge is mounted and the document is visible; the Host fetches usage endpoints only while some subscription exists. API keys cross to the Host once and are never displayed or returned.

-----

<a id="understand-the-implementation"></a>
## Understand the implementation

<details>
<summary>Implementation internals — click to expand</summary>

`AccountsWatcher` owns one snapshot store per observer (the settings page, or one Session's badge) and a reference count; the first hold opens a reconnecting `remote.$stream` over `llmAccounts.watch`, the last release closes it, and the store keeps its last snapshot. `createAccountsOperations` binds every Remote call to an `Outcome` (`busy`, `invalid-key`, or the Host text), so components never see Remote error codes. The allowlist dialog reads the route's models from `session.modelCatalog`, without pinned `~acct:` entries, and keeps listed ids the catalog no longer offers.

| File | Role |
|---|---|
| [`src/client/index.ts`](src/client/index.ts) | Dictionaries and the two slot registrations |
| [`src/client/store.ts`](src/client/store.ts) | Reference-counted `watch` subscriptions |
| [`src/client/operations.ts`](src/client/operations.ts) | Remote bindings and outcomes |
| [`src/client/AccountsSection.tsx`](src/client/AccountsSection.tsx) | Section, rows, rename and remove dialogs |
| [`src/client/SignInDialog.tsx`](src/client/SignInDialog.tsx) | Sign-in attempt dialog |
| [`src/client/ApiKeyDialog.tsx`](src/client/ApiKeyDialog.tsx) | Key-only account dialog |
| [`src/client/ModelsDialog.tsx`](src/client/ModelsDialog.tsx) | Model allowlist editor |
| [`src/client/UsageBars.tsx`](src/client/UsageBars.tsx) | Usage windows |
| [`src/client/UsageBadge.tsx`](src/client/UsageBadge.tsx) | Composer badge and its dialog |
| [`src/client/format.ts`](src/client/format.ts) | Pure display helpers |
| [`src/client/locales.ts`](src/client/locales.ts) | Dictionaries (de, en, es, fr, ja, pt, ru, zh) |

</details>

-----

<a id="further-exploration"></a>
## Further Exploration

- [llm-pi-ai](../../llm/llm-pi-ai/README.md) — accounts, pool failover, usage sources, and the `llmAccounts` Remote.
- [Models settings](../ui-settings-models/README.md) — the provider cards and their extension seat.
- [Model selection](../ui-model-selection/README.md) — the Session model directory the badge follows.

-----

<a id="model-experience"></a>
## Model Experience

None, as the package is settings and composer UI and adds no model input.

#### KV Cache effect

None; the UI sends no provider request. Switching the serving account is a Host decision documented in `llm-pi-ai`.

## Known Limitations and Deferred Work

<a id="known-limitations-and-deferred-work"></a>

- The allowlist dialog lists the route's models from the current model catalog; when every account excludes a model, the catalog no longer offers it, so the dialog shows only ids an account already lists.
- Account order (`order`) has no editor; the Host orders accounts by default, then creation time.
- Remaining times are computed when the snapshot renders; they refresh with the next pushed snapshot.

<a id="dev-note"></a>
### Dev Note

<details>
<summary>Working context for maintainers — click to expand</summary>

Client specs render the surfaces with the English dictionary and fake operations, drive `AccountsWatcher` and the operations against `dsh-remote-mock`, and check the slot registrations with a fake context.

</details>
