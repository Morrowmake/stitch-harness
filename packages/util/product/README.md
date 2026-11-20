---
description: "Zero-dependency, browser-safe product identity constants shared by CLI, host, desktop, and client."
kind: "package-library"
---

# @deepseek-ai/dsh-product

English | [中文](README.zh.md)

## Summary

`dsh-product` is the single source of the product identity: `PRODUCT_NAME`, `CLI_COMMAND`, `HOME_DIR_NAME`, `PROJECT_DIR_NAME`, `ENV_PREFIX`, `REPOSITORY`, `REPOSITORY_URL`, `DOCS_URL`, `NPM_PACKAGE`, `PROTOCOL_SCHEME`, `DESKTOP_APP_ID`, and `PLUGIN_INDEX_REPOSITORY`. It has no dependencies and is safe to import from browser code.

## Table of Contents

- [Use this package](#use-this-package)
- [Understand the implementation](#understand-the-implementation)
- [Further Exploration](#further-exploration)
- [Known Limitations and Deferred Work](#known-limitations-and-deferred-work)
- [Dev Note](#dev-note)

-----

<a id="use-this-package"></a>
## Use this package

Import a constant instead of hard-coding the product name, repository, or home directory:

```ts
import { PRODUCT_NAME, REPOSITORY_URL } from '@deepseek-ai/dsh-product'
```

-----

<a id="understand-the-implementation"></a>
## Understand the implementation

<details>
<summary>Implementation internals — click to expand</summary>

### Source map

| File | Role |
|---|---|
| [`src/index.ts`](src/index.ts) | Product identity string constants |

</details>

-----

<a id="further-exploration"></a>
## Further Exploration

- [Home paths package](../home-paths/README.md) — resolves the home directory named here.

-----

## Known Limitations and Deferred Work

<a id="known-limitations-and-deferred-work"></a>

These limits define when the constants are not the right tool. They are current package constraints, not a task backlog.

- **Build-time only** — the values are compile-time strings; nothing reads them from the environment or configuration, so a downstream rename needs a source change and rebuild.
- **Names, not behavior** — the package does not resolve paths, read environment variables, or open URLs; consumers such as the home-paths package own that logic.

<a id="dev-note"></a>
## Dev Note

<details>
<summary>Working context for maintainers — click to expand</summary>

None.

</details>
