---
description: "The keyless search provider for ctx.web: how deployments mount web search through SearXNG, DuckDuckGo, and Marginalia without an account, signup, or paid key."
kind: "package-reference"
---

# @deepseek-ai/dsh-web-search-keyless

English | [中文](README.zh.md)

## Summary

With `dsh-web-search-keyless`, the harness searches the web through the web service (`ctx.web`) without an account or a paid key. It is the default search provider for Stitch. One registered provider tries its sources in order: a configured SearXNG instance alone, or else DuckDuckGo's HTML endpoint with Marginalia's shared public key as the fallback when DuckDuckGo rate-limits or fails. Choose it when a deployment must not depend on a search vendor account; public sources can throttle, so a self-hosted SearXNG instance is the dependable and most private choice. The model-facing `web_search` tool lives in `dsh-tool-web`, which renders this provider's sources.

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

Mount the provider in a composition that already loads the web service; it registers as the `keyless` search provider, so `ctx.web.search()` resolves it automatically when it is the only usable search backend — or pin it with `searchProvider: keyless`.

### When to choose it

Choose this provider when search must work out of the box with no credential, and when queries should go to privacy-respecting sources rather than a vendor API tied to an account. Point it at a SearXNG instance you run when you need predictable availability.

### Minimal configuration

Load the web service and the provider; every field is optional.

```yaml
- id: web
  name: '@deepseek-ai/dsh-web'
  config:
    searchProvider: keyless
- id: web-search-keyless
  name: '@deepseek-ai/dsh-web-search-keyless'
  config:
    # Optional: search only this SearXNG instance.
    searxngUrl: https://searx.example.org/
```

| Field | Default | Meaning |
|---|---|---|
| `searxngUrl` | omitted | Base URL of a SearXNG instance with the `json` search format enabled; `/search` is appended to its path. An http(s) URL without embedded credentials makes searches go to this instance only; any other value leaves SearXNG unusable. Each search reads the current value, so a saved setting applies to the next search without remounting the plugin |
| `marginaliaApiKey` | `public` | `API-Key` header sent to Marginalia. An empty value removes Marginalia from the order |
| `sources` | omitted | Sources to try, in order, from `searxng`, `duckduckgo`, and `marginalia`. Omitted or empty: `[searxng]` when `searxngUrl` is usable, otherwise `[duckduckgo, marginalia]`. Unusable sources and repeats are dropped |
| `timeout` | `10000` | Per-source timeout in milliseconds, covering the request and its response body |
| `maxResults` | `10` | Upper bound on the sources of one search, from 1 to 100, applied below the caller's own `maxResults` |

The generated [configuration catalog](../../../docs/config-catalog.md) lists every accepted field once it is regenerated for this package.

### Sources and privacy

Every request sends a common desktop-browser `User-Agent` and no cookies, referrer, or installation identifier, refuses redirects, and goes through the process-wide dispatcher, so the outbound proxy installed by [`dsh-http-proxy`](../../util/http-proxy/README.md) applies. Each source still sees the query and the caller's IP address, or the proxy's.

- **DuckDuckGo** — the server-rendered `https://html.duckduckgo.com/html/` page, sent as a form POST so the query stays out of the URL. DuckDuckGo has no official search API: the provider reads result markup, decodes `//duckduckgo.com/l/?uddg=` redirect links to their targets, and skips ads (`result--ad` blocks and `/y.js` links). DuckDuckGo throttles automated traffic; HTTP 202, 403, or 429 and its bot-challenge page count as rate limiting.
- **Marginalia** — `https://api2.marginalia-search.com/search` with the shared `public` key, which needs no signup but shares one rate limit with every other user of that key; HTTP 429 or 503 counts as rate limiting. Marginalia is a small independent index that favors non-commercial, text-heavy sites, so it answers fewer mainstream queries. Its results are licensed under CC-BY-NC-SA 4.0; a deployment with commercial use needs its own key and terms from Marginalia.
- **SearXNG** — `GET {searxngUrl}/search?q=…&format=json`. Self-host an instance for the best privacy: the instance, not a third party, then decides which engines see the query. SearXNG answers HTTP 403 when `json` is missing from `search.formats` in its `settings.yml`; the provider reports that with the setting to change.

### What a search returns

`sources[]` carries each result's `url`, `title`, and `snippet` (DuckDuckGo's result snippet, Marginalia's `description`, SearXNG's `content`), plus `publishedAt` from SearXNG's `publishedDate` when present. Results keep the answering source's order, drop entries without an http(s) URL, and are deduplicated by URL. `content` is always omitted. The seam's result type has no field naming the answering source, so a search does not report which source answered; the plugin logs each source failure at debug level.

### Failures and recovery

A source failure other than cancellation moves the search to the next source; an empty result is an answer and does not. Failures throw `WebError`: caller cancellation is `WEB_ABORTED` and stops the chain, a source that rate-limits is `WEB_SEARCH_RATE_LIMITED`, a source that misses the timeout is `WEB_SEARCH_TIMEOUT`, SearXNG's HTTP 403 is `WEB_PROVIDER_MISCONFIGURED`, and other statuses, unreadable pages or JSON, bodies over 2 MB, refused redirects, and transport failures are `WEB_PROVIDER_ERROR`. With one source in the order, its failure is thrown unchanged. When every source fails, one error lists each source's failure and suggests retrying later or configuring SearXNG; its code is `WEB_SEARCH_RATE_LIMITED` when every source rate-limited, otherwise `WEB_PROVIDER_ERROR`. With no usable source, a search fails as `WEB_PROVIDER_UNAVAILABLE`, and the provider reports itself unavailable so `ctx.web` does not select it.

-----

<a id="understand-the-implementation"></a>
## Understand the implementation

<details>
<summary>Implementation internals — click to expand</summary>

This section explains the design decisions behind the provider; the observable behavior is fully covered in [Use this package](#use-this-package).

### Design philosophy

- **The chain lives behind one provider id.** `ctx.web` selects exactly one search provider per search and has no fallback between providers, and several usable providers without a configured id are ambiguous. Registering the sources separately would require every deployment to pick one and lose fallback, so the provider owns its source order.
- **No HTML parser dependency.** `html.duckduckgo.com` serves flat, script-free markup; a small tag scanner with fixture tests reads it, and an unrecognized page fails so the chain falls back instead of returning nothing.

### Source map

| File | Role |
|---|---|
| [`src/index.ts`](src/index.ts) | Plugin entry: config schema and provider registration |
| [`src/provider.ts`](src/provider.ts) | The `KeylessSearchProvider`: source order, fallback, and combined failures |
| [`src/duckduckgo.ts`](src/duckduckgo.ts) | DuckDuckGo request, challenge detection, result parsing, and redirect decoding |
| [`src/marginalia.ts`](src/marginalia.ts) | Marginalia request and status handling |
| [`src/searxng.ts`](src/searxng.ts) | SearXNG request, base-URL validation, and status handling |
| [`src/results.ts`](src/results.ts) | Mapping of the JSON `results[]` answers |
| [`src/html.ts`](src/html.ts) | Tag scanning, attribute parsing, and entity decoding |
| [`src/transport.ts`](src/transport.ts) | The shared HTTP exchange: deadline, cancellation, redirect refusal, and body cap |

### Search path

A search computes the source order from the current options, bounds the result count by the smaller of the request's and the configured `maxResults`, and runs each source under its own deadline fused with the caller's signal. The first source that answers returns its sources; each failure is passed to the debug log and kept for the combined error.

</details>

-----

<a id="further-exploration"></a>
## Further Exploration

Read these pages when the package-level contract is not enough. They move from the shared vocabulary to the service, the model-facing tools, and the design rationale.

- [Web subsystem](../../../docs/subsystems/web.md) — the exhaustive search request/result vocabulary and error codes.
- [Web package map](../README.md) — the web package family and each role.
- [dsh-web](../web/README.md) — the web service this provider registers into.
- [dsh-tool-web](../tool-web/README.md) — the model-facing `web_search` tool that renders this provider's sources.
- [Web capability seam decision](../../../.agents/notes/implemented/architecture/2026-06-24-web-capability-seam.md) — why search and fetch share one provider-selection service.

-----

<a id="model-experience"></a>
## Model Experience

### Conversation tool result, indirectly

#### What the model sees

Through `dsh-tool-web`, the conversation model sees the answering source's URLs, titles, snippets, and SearXNG publication dates, without the name of the source that answered. Its failures reach the model as their messages: a source's own failure such as `DuckDuckGo is rate-limiting searches (HTTP 202 bot challenge)` or the SearXNG `settings.yml` instruction, and, when every source fails, `Web search failed on every source: <failures>. Public sources limit request rates; retry later, or guide the user to configure a SearXNG instance in web-search-keyless.searxngUrl.`

#### Token effect

Zero direct tokens from registration. Result tokens scale with the returned sources and snippets, at most `maxResults` per search.

#### KV Cache effect

Append-only; a tool result follows the reusable request prefix and does not invalidate existing KV-cache entries.

## Known Limitations and Deferred Work

<a id="known-limitations-and-deferred-work"></a>


These limits define when the provider is a poor fit. They are current package constraints.

- **Public sources throttle** — DuckDuckGo challenges automated traffic and Marginalia's shared key has one rate limit for all its users, so without SearXNG, bursts of searches can fail with `WEB_SEARCH_RATE_LIMITED` until the limits reset.
- **DuckDuckGo markup can change** — the parser reads the current `html.duckduckgo.com` markup; a changed page fails as `WEB_PROVIDER_ERROR` and falls back to Marginalia rather than returning results.
- **Marginalia results carry a non-commercial license** — CC-BY-NC-SA 4.0 applies to results answered through the shared key.
- **The answering source is not reported** — `WebSearchResult` has no metadata field, so consumers cannot tell which source answered or attribute Marginalia results.

<a id="dev-note"></a>
### Dev Note

<details>
<summary>Working context for maintainers — click to expand</summary>

None.

</details>
