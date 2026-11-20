# CLAUDE.md — Stitch

Stitch is a fork of DeepSeek Harness. `AGENTS.md` (imported at the end) is the upstream file. It is kept unchanged so upstream merges stay clean. Where this file and `AGENTS.md` disagree, this file wins.

## How Stitch works

- Work happens in GitHub pull requests against `master`. Keep each pull request to one change and describe it with `.github/pull_request_template.md`.
- CI (`.github/workflows/ci.yml`) runs four checks: `pnpm run build`, `pnpm run test`, `pnpm run lint`, and `pnpm run test:snapshot`. These are the only required checks. Run the ones that match your change before you push.
- Stitch does not publish to npm. Desktop installers for macOS and Windows are built unsigned by `desktop-release.yml` when a `stitch-v<version>` tag is pushed. Python wheels are built in CI but not published.
- Record user-visible changes in `CHANGELOG.md` under "Unreleased".
- Git hooks (`lefthook.yml`) lint staged files, check whitespace, check translation pairs, and guard `vendor/`. They install with `pnpm install`.

## Upstream rules to ignore

Ignore these parts of `AGENTS.md`:

- `gh stack`, stacked pull requests, "Choose PR history deliberately", the label taxonomy, and `dsh-pr-description`.
- `dsh-pre-push-checks` and any other link to a skill under `.agents/skills/` that no longer exists.
- Agent Notes: do not write new ones. `.agents/notes/implemented/` is read-only background; the archived, proposed, and rejected notes were removed.
- Upgrade guides: do not write new ones. `docs/upgrade-guide/` is frozen history from DeepSeek Harness; use `CHANGELOG.md` instead.
- Persistence-change records: do not add new records under `docs/persistence-changes/`; that directory is frozen. A change to a persisted Session type needs a session-format version bump, a migration, and a migration test. Keep the session-format code and the `snapshots/` corpus.
- "`test:coverage` is the CI coverage gate" and "CI owns exhaustive coverage": no workflow runs coverage. Coverage is optional.
- The `doc-sync`, `hygiene`, `check:*`, `verify-*`, and `gen-*` scripts are optional and run by hand. Word-budget, prose-style, and "ban prove/nance" rules are optional.
- Designer approval for plugin artwork, the `node 24 / benchmarks` job, `benchmarks/`, and `pnpm run demo:ptc` (all removed).
- "`CLAUDE.md` symlinks `AGENTS.md`": the root `CLAUDE.md` is this file.

The architecture, code-quality, type-safety, error-handling, and testing rules in `AGENTS.md` still apply.

## Upstream merges

After merging an upstream DeepSeek Harness release, run:

```sh
bash scripts/prune-upstream.sh
```

It deletes again the upstream files Stitch removed (release and benchmark machinery, the documentation website, Agent Notes outside `implemented/`, and DeepSeek process skills), including files upstream added under those paths. Resolve any remaining conflicts by hand, then run the four CI checks. When you remove another upstream path, add it to the list in that script.

@AGENTS.md
