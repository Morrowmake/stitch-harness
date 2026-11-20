# Plugin indexes

English | [中文](plugin-market.zh.md)

## Summary

A plugin index is one JSON file that lists installable Stitch bundles with their titles, icons, authors, and versions. The **Discover** tab on the Plugins page browses indexes and installs a listed version after a confirmation. To publish an index, write or generate an index file and serve it, together with its icon files, from any static host.

## Table of Contents

- [Open Discover](#turn-on)
- [Browse and install](#browse-and-install)
- [Running DeepSeek Harness plugins](#deepseek-harness-plugins)
- [Claude Code and Codex subagents](#claude-code-and-codex)
- [Publish an index](#publish-an-index)
- [Generate an index with the reference generator](#generate-an-index)
- [Index format reference](#index-format)
- [Further Exploration](#further-exploration)

<a id="turn-on"></a>
## Open Discover

Open **Plugins** and select **Discover** next to **Installed**, or choose **More → Browse other plugins** in the sidebar. Every Web profile has the tab. To let the agent in Creator mode search indexes for you with the read-only `plugin_market` tool, choose **Show advanced** in Plugins and switch on **Plugin market tool for the agent**; it is off by default so the agent's instructions stay short.

Discover lists only the Stitch plugin index at first; it is not fetched until you open it. While it lists no plugins, Discover says so and offers the community indexes. Two community indexes from DeepSeek Harness are offered in **Manage index sources…** under **Community indexes**: **Awesome plugins for DeepSeek Harness** (`https://awesome-dsh-plugin.com/index.json`) and **DeepSeek Harness plugin market** (`https://cdn.dsh.so/market/index.json`). To add another, choose **Add index source** and enter the URL of an index file. A URL must use `http:` or `https:` and must not contain a user name, password, or `#` fragment. Anyone on the network path can change an `http:` index, including the install specs it lists, so use `https:` for an index reached over a network you do not control. Each source belongs to the current profile.

<a id="browse-and-install"></a>
## Browse and install

The index menu at the left of the toolbar switches between sources and opens **Manage index sources…**, where each source shows its last error. Search matches names, authors, keywords, and titles, descriptions, categories, and labels in every language, and tolerates typos; results come in best-match order until you choose another. The **Labels** menu, category pills, and **Sort** menu use the categories, labels, and sort keys that the index declares, and **Publish date** sorts by each plugin's latest version.

Each card shows the plugin's recommended version: the highest version compatible with the running Stitch that is not a prerelease, or the highest compatible prerelease when the plugin lists no version without a prerelease tag. **Install** opens a confirmation with that version's source: the npm package and registry, or the Git repository, commit, and directory. Confirming starts the normal plugin installation, including its compatibility and registry checks; nothing is installed without that confirmation.

Select a card to open its page. The **Versions** list shows every listed version with its compatibility and offers **Install** for any version Stitch accepts, including older releases and prereleases. A card that shows **Installed**, **Update available**, or **Provided by Stitch** opens the installed bundle instead.

Indexes are third-party content. An index chooses each plugin's title, description, icon, author, and source; Stitch checks the file format but not those claims. Every index except the Stitch index is marked **Community — not reviewed by Stitch**, and a verdict it gives, such as a low-risk or install-verified label, names that index ("Rated low risk by …") rather than reading as Stitch's. Community cards also say when a plugin is made for DeepSeek Harness, needs another Stitch version, or doesn't say which Stitch versions it supports. Add only sources you trust, and check the source in the confirmation before installing.

<a id="deepseek-harness-plugins"></a>
## Running DeepSeek Harness plugins

Stitch runs plugins written for DeepSeek Harness (DSH). Install one from Discover, or from the command line:

```sh
stitch plugin --profile web add <package>
```

A small compatibility layer lets these plugins run unchanged:

- **Environment.** When a `STITCH_` variable such as `STITCH_HOME`, `STITCH_AGENTS_HOME`, or `STITCH_PERMISSION_MODE` is unset, Stitch reads its `DSH_` spelling instead; a `STITCH_` value always wins. Shell commands and terminals receive `DSH_SESSION_ID` and `DSH_WEB_URL` with the same values as `STITCH_SESSION_ID` and `STITCH_WEB_URL`, and a plugin may register shell variables named `DSH_*` as well as `STITCH_*`.
- **Skills.** Skills in an existing `~/.dsh/skills` or `<project>/.dsh/skills` directory are available. Stitch only reads these directories and never creates them; a Stitch skill with the same name wins.
- **Indexes.** Discover offers the DeepSeek Harness community indexes, as described under [Open Discover](#turn-on); they are not added by default.

Some plugins still do not work:

- A plugin that hard-codes `~/.dsh` keeps its data there rather than under `~/.stitch`.
- A plugin whose Harness peer range is an exact version or below `0.2.0` fails the compatibility check. To install it anyway, approve that exact pair with `stitch plugin --profile web allow-version <package@version> --stitch-version <exact> --accept-risk`.
- A plugin that runs a `dsh` executable fails, because Stitch installs only `stitch`.
- A plugin that depends on DeepSeek services or on DeepSeek Harness packages that Stitch removed does not work.

<a id="claude-code-and-codex"></a>
## Claude Code and Codex subagents

The **Claude Code subagent** and **Codex subagent** plugins run the real Claude Code or Codex program, which Stitch does not ship. Each plugin's page has a **Program** section that shows the copy Stitch found: your own install (for example from `npm install -g @anthropic-ai/claude-code` or `npm install -g @openai/codex`), a copy Stitch downloaded, or none. When none is found, or yours is too old, choose **Download** to fetch the pinned version (about 200–400 MB) into the Stitch home; **Remove** deletes only that download. Turning the plugin on never downloads anything, and a delegation without a program fails with a message that says how to install it.

<a id="publish-an-index"></a>
## Publish an index

An index is a UTF-8 JSON file, at most 128 MiB by default, served with a 2xx status and without redirects. Put it on any static host, for example GitLab Pages, GitHub Pages, or an object store behind https.

Icons can be inline or separate files. An inline icon is a base64 `data:` URL in the index; it needs no extra request but makes the index larger. A separate icon is a URL. A relative icon resolves against the index URL, the way an image in a web page resolves against the page: for an index at `https://market.example/dsh/index.json`, `"icon": "icons/foo.svg"` loads `https://market.example/dsh/icons/foo.svg`. Publishing the index and an `icons/` directory side by side therefore works on any host without editing the file. An absolute icon URL on another origin (scheme, host, and port) must use `https:`.

This is a minimal index with one npm plugin and one plugin from a Git monorepo:

```json
{
  "format": 1,
  "title": { "en": "Team plugins", "zh": "团队插件" },
  "plugins": [
    {
      "name": "dsh-plugin-foo",
      "title": "Foo",
      "description": "Adds the foo tool",
      "icon": "icons/foo.svg",
      "author": "Jane Doe",
      "homepage": "https://github.com/jane/dsh-plugin-foo#readme",
      "repository": { "url": "https://github.com/jane/dsh-plugin-foo" },
      "versions": [
        { "version": "1.1.0", "publishTimestamp": 1790476800, "source": { "type": "npm" }, "engines": { "dsh": ">=0.2.0-rc.2" } },
        { "version": "1.0.0", "publishTimestamp": 1788000000, "source": { "type": "npm" } }
      ]
    },
    {
      "name": "@team/dsh-bar",
      "versions": [
        {
          "version": "0.3.0",
          "publishTimestamp": 1789000000,
          "source": {
            "type": "git",
            "url": "https://gitlab.example.com/team/dsh-plugins",
            "commit": "3f9c2e1d8a4b6c0e7f1a2b3c4d5e6f708192a3b4",
            "path": "packages/bar"
          }
        }
      ]
    }
  ]
}
```

Stitch rejects the whole index when any rule below is violated and shows the reason, with the JSON path of the offending value, under the source in **Manage index sources…**.

<a id="generate-an-index"></a>
## Generate an index with the reference generator

The repository includes a [reference generator](../../../apps/plugin-market-generator/README.md) that builds an index from a plain list. Write one npm package name or https Git repository URL per line; blank lines and lines starting with `#` are ignored:

```text
@team/dsh-foo
https://gitlab.example.com/team/dsh-plugins
```

Run it from a Stitch checkout:

```sh
pnpm --filter @deepseek-ai/dsh-plugin-market-generator start --input plugins.txt --output site/index.json --title "Team plugins"
```

For an npm package, the index lists every version that is neither deprecated nor private and declares `dsh.bundle`. For a Git repository, it finds the bundle packages on the default branch whose `package.json` does not set `"private": true` and lists their versions at `vX.Y.Z`, `X.Y.Z`, and `<name>@X.Y.Z` tags, plus each package's version on the default branch. Titles, descriptions, icons, authors, and homepages come from each plugin's highest version. Paths are relative to the directory where you run pnpm.

The generator only downloads and reads files; it never installs packages or runs their code. It keeps package data in `.plugin-market-cache` next to the list and reuses unchanged versions and commits. Each run still reads source documents or Git refs and refreshes enabled metrics; unavailable metric values are omitted. Set `GITHUB_TOKEN` to collect GitHub stars; without a nonblank token, GitHub metric requests and `github_stars` are omitted while npm weekly downloads remain enabled. Publish the output directory, `index.json` together with its `icons/` directory, as described above.

<a id="index-format"></a>
## Index format reference

Text fields marked `LocalizedText` are a string or an object of strings keyed by lowercase language ids, such as `{ "en": "Foo", "zh": "甲" }`; an object must contain `en`. Stitch ignores unknown object fields at every level. Known fields and `source.type` still require valid values; keys inside declaration, localized-text, and plugin sort-value maps are validated as data.

| Index field | Required | Meaning |
|---|---|---|
| `format` | yes | `1`. |
| `title`, `description` | `title` only | Index name and description, `LocalizedText`. |
| `metadata.categories`, `metadata.labels` | no | Objects mapping an id to `{ "title": LocalizedText }`. |
| `metadata.sortKeys` | no | Object mapping an id to `{ "title": LocalizedText, "order": "asc" \| "desc" }`; `order` is the initial direction. |
| `plugins` | yes | Plugins in the publisher's default order; clients must preserve this array order on initial display and when filtering, unless the user chooses another sort or text search ranks by relevance. |

| Plugin field | Required | Meaning |
|---|---|---|
| `name` | yes | npm package name, unique in the index. |
| `title`, `description` | no | `LocalizedText`; the card shows `name` without a title. |
| `icon` | no | Inline `data:` URL (SVG, PNG, JPEG, or WebP, at most 32 KiB) or URL, as described above. |
| `author` | no | Display text. |
| `homepage` | no | Absolute `https:` or `http:` URL of a page about the plugin; the plugin page links it. |
| `repository` | no | `{ "url": string, "directory"?: string }`: the source repository's web page, and the package directory inside it. The plugin page links it as **Source code**. |
| `metadata.category` | no | One declared category id. |
| `metadata.labels` | no | Declared label ids. |
| `metadata.sortKeys` | no | Object mapping declared sort-key ids to finite numbers, or `null` when unavailable. |
| `versions` | yes | At least one version, in any order. |

A plugin may omit `metadata`, any of its fields, or individual sort values, or use `null` for unavailable data. Missing values sort last in both directions; a real zero is a value, not missing data. The recommended definitions standardize `github_stars` as a repository's GitHub star count and `npm_weekly_downloads` as a public npm package's download count over npm's `last-week` window. Both are non-negative integers; weekly downloads are not a monthly count. Publishers using these keys declare them under root `metadata.sortKeys` and populate available values under each plugin's `metadata.sortKeys`. Other declared numeric keys remain supported.

| Version field | Required | Meaning |
|---|---|---|
| `version` | yes | Exact SemVer version, unique within the plugin. |
| `publishTimestamp` | yes | Publish time in Unix seconds. |
| `source` | yes | `{ "type": "npm", "registry"?: url }`, or `{ "type": "git", "url": https-url, "commit": 40-hex-sha, "path"?: directory }`. |
| `engines.dsh` | no | SemVer range of Stitch versions this version runs on; absent means any. |

Stitch installs an npm version as `name@version`, asking `registry` first when present, and a Git version as `git+<url>.git#<commit>` with `&path:/<path>` for a package in a subdirectory. `engines.dsh` should match the package's own `engines.dsh`, which Stitch checks again at installation; a package without one is checked against its `@deepseek-ai/dsh*` peer dependencies instead. The [format note](../../../.agents/notes/implemented/feature/2026-10-02-plugin-market-index-format.md) defines every rule.

<a id="further-exploration"></a>
## Further Exploration

- [Discover tab reference](../../../packages/client/ui-plugin-market/README.md) describes the tab's controls and states.
- [Plugin index service](../../../packages/boot/plugin-market/README.md) covers fetch limits, caching, and the `plugin_market` tool.
- [Index validator](../../../packages/util/plugin-market-index/README.md) is the library generators can use to check an index before publishing it.

## Dev Note

None.
