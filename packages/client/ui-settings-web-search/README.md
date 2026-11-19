---
description: "The web search and fetch settings page on the dsh web client's Plugins page: the Search and Fetch provider menus and keyless search's optional SearXNG address."
kind: "package-reference"
---

# @deepseek-ai/dsh-client-ui-settings-web-search

English | [中文](README.zh.md)

## Summary

Open **Plugins** in the sidebar and select **Web search and fetch** in the Official group to choose the providers web search and web fetch use, and to point keyless search at your own SearXNG instance. The page writes only on save. It exists while the Host serves the `web` namespace; the SearXNG address appears only while the Host serves the `web-search-keyless` namespace.

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

The **Web search and fetch** card in the Official group opens the page. It has a **Web search provider** section and a **Web fetch provider** section, each with a provider menu directly under its title. A menu lists every provider the Host registers, including providers that plugins register, so a newly installed provider needs no change to this page; [Add another provider](../../web/web/README.md#adding-a-provider) shows how to mount one in a profile. The built-in ones come first while registered: the Search menu lists **Keyless (DuckDuckGo → Marginalia)** (`keyless`), and the Fetch menu lists **Anonymous HTTP** (`http`); every other provider follows in registration order under its registered title or id. A selected provider the Host does not register stays in its menu marked as not loaded. Each selected provider's registered description appears under its menu; a plugin provider also points to its own settings.

While keyless search is selected, a gray panel below its menu holds **SearXNG URL**, which writes `web-search-keyless.searxngUrl`, with a short explanation and a link to the [SearXNG documentation](https://docs.searxng.org/). Blank searches DuckDuckGo, then Marginalia. An `http://` or `https://` address without a user name or password sends every search only to that instance, which must have JSON output enabled; the menu then names the provider **Keyless (SearXNG)**. Other addresses are refused and block saving.

The value field renders the effective value, carries an **Overridden** badge with **Reset to default** once overridden, and saves as a reset when emptied. The provider menus are disabled while an invalid edit or a failed save is staged, so a field the change would hide stays visible. One save writes the keyless settings before the selection, so a refused section leaves the selection unsaved. Nothing is written until **Save**; leaving the page drops the drafts.

-----

<a id="understand-the-implementation"></a>
## Understand the implementation

<details>
<summary>Implementation internals — click to expand</summary>

The Host half is an empty `apply`, present only so the package holds a Loader row the client module system serves the browser half for. The browser half binds the `web` and `web-search-keyless` namespaces through `ctx.configForms.get` and keeps one shared `SettingsFormModel` of `ui-primitives` per namespace in `WebSearchCardController`. The menus stage `searchProvider` and `fetchProvider` in `web`; a target equal to the composed value stages a reset instead, and so does the **Automatic** entry, which the menu offers while the composed `base` has no value for that field. The provider list comes from `remote.web.listProviders`, which keeps registration order; the controller moves the registered built-in providers to the front. Only the latest list read publishes; a failed read keeps the previous list and shows a retry. The page re-reads the list on `web/providers-changed`, on a connection reset, and when the Host starts serving `web`.

</details>

-----

<a id="further-exploration"></a>
## Further Exploration

- [ui-plugin-manager](../ui-plugin-manager/README.md) — the Plugins page and the `plugins.item` slot the page registers into.
- [ui-settings](../ui-settings/README.md) — the settings scope and the served-namespace watch the page rides.
- [ui-primitives](../ui-primitives/README.md) — the settings form model and fields the page renders.
- [web-search-keyless](../../web/web-search-keyless/README.md) — the keyless search provider whose SearXNG address the page edits.
- [web](../../web/web/README.md) — the provider selection and provider list the menus use.

-----

<a id="model-experience"></a>
## Model Experience

None, as the package is a browser-side settings surface that registers no model surface.

#### KV Cache effect

None; this package neither assembles nor sends a provider request.

## Known Limitations and Deferred Work

<a id="known-limitations-and-deferred-work"></a>

- **Automatic selection reads only the deployment composition** — a menu offers it when the composition layer sets no provider for that capability. While automatic selection applies, the Host's `DSH_WEB_SEARCH_PROVIDER` or `DSH_WEB_FETCH_PROVIDER` environment variable picks the provider instead, and the page does not show that choice.
- **The SearXNG address is not probed** — the page checks only its form; an unreachable instance or one without JSON output fails at search time.

<a id="dev-note"></a>
### Dev Note

<details>
<summary>Working context for maintainers — click to expand</summary>

None.

</details>
