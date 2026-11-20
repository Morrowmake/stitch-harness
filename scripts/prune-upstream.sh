#!/usr/bin/env bash
# Re-delete the DeepSeek Harness repository machinery Stitch does not use.
#
# Run from the repository root after merging an upstream release:
#   bash scripts/prune-upstream.sh          # delete, then review `git status`
#   bash scripts/prune-upstream.sh --dry-run  # list what would be deleted
#
# Upstream keeps adding files under these paths. Deleting them again here is
# cheaper than resolving each modify/delete conflict by hand. During a merge
# with such conflicts, run this script and then `git add -A` the listed paths.
# Keep this list in sync with CLAUDE.md ("Upstream merges").
set -euo pipefail

cd "$(git rev-parse --show-toplevel)"

paths=(
  # Dead publishing and infrastructure workflows.
  .gitlab-ci.yml
  .github/workflows/pi-ai-provider-e2e.yml
  .github/workflows/expected-filenames.yml
  .github/workflows/release.yml
  .github/workflows/release-vendor.yml
  .github/workflows/docs-pages.yml
  .github/workflows/publish-ssh-helper.yml
  scripts/check-expected-filenames.sh

  # npm release machinery (desktop packaging keeps families/pack/process/tarball).
  scripts/release/bump.ts
  scripts/release/verify.ts
  scripts/release/publish.ts
  scripts/release/publish.spec.ts
  scripts/release/families.spec.ts
  scripts/release/verify-packed-install.ts
  scripts/release/verify-packed-install.spec.ts
  scripts/release/installed-product-isolation.ts
  scripts/release/installed-product-isolation.spec.ts
  scripts/publish-npm-baseline.ts
  scripts/npm-baseline-packages.ts
  scripts/npm-baseline-packages.spec.ts
  scripts/publint-all.ts
  scripts/publint-all.spec.ts
  scripts/publint-browser-format.ts
  scripts/verify-npm-install-layout.ts
  scripts/verify-npm-install-layout.spec.ts
  scripts/benchmark-next-package-dependency.ts
  scripts/benchmark-next-package-dependency.spec.ts

  # Orphaned scripts.
  scripts/wine-windows-gates.sh
  scripts/attribute-chunk-bytes.mjs
  scripts/migrate-packed-session-fixtures.ts
  scripts/demo-ptc.mjs
  scripts/migrate-sessions-to-v4.ts
  scripts/migrate-sessions-to-v4.spec.ts
  scripts/install-lefthook.mjs
  scripts/install-lefthook.spec.ts

  # Benchmarks and perf/stress lanes.
  benchmarks
  BENCHMARK.md
  vitest.bench.config.ts
  vitest.web.perf.config.ts
  vitest.web-stress.config.ts
  scripts/run-bench-suite.ts
  scripts/run-ci-bench.ts
  scripts/run-memory-pressure-bench.ts
  scripts/run-memory-pressure-bench.spec.ts
  apps/web/stress-tests
  apps/web/tests/complex-history.perf.ts
  packages/client/ui-conversation/tests/history-transport.perf.client.ts

  # Agent Notes outside the read-only implemented/ reference, and their gates.
  .agents/notes/archived
  .agents/notes/proposed
  .agents/notes/rejected
  scripts/agent-note-tree.ts
  scripts/archived-agent-notes.ts
  scripts/archived-agent-notes.spec.ts
  scripts/verify-agent-note-classification.ts
  scripts/verify-agent-note-format.ts
  scripts/verify-archived-agent-notes.ts

  # Agent Notes about DeepSeek-only process and infrastructure.
  .agents/notes/implemented/process/2026-07-21-serial-cross-platform-ci-reference.*
  .agents/notes/implemented/process/2026-07-26-ci-failover-runbook.*
  .agents/notes/implemented/process/2026-07-26-frozen-agent-note-archive.*
  .agents/notes/implemented/process/2026-07-27-worktree-local-lefthook.*
  .agents/notes/implemented/process/2026-08-02-native-github-stacks-and-optional-rebases.*
  .agents/notes/implemented/process/2026-08-08-native-windows-pull-request-ci.*
  .agents/notes/implemented/process/2026-08-08-unified-github-label-taxonomy.*
  .agents/notes/implemented/process/2026-08-10-event-directed-pr-review-status.*
  .agents/notes/implemented/process/2026-08-10-npm-release-sequences.*
  .agents/notes/implemented/process/2026-08-26-published-dependency-faces.*
  .agents/notes/implemented/process/2026-09-09-blacksmith-failover-leg.*
  .agents/notes/implemented/process/2026-09-09-parallel-macos-notarization.*
  .agents/notes/implemented/process/2026-09-17-windows-runtime-signature-cache.*
  .agents/notes/implemented/process/2026-09-17-windows-signature-completion.*
  .agents/notes/implemented/process/2026-09-28-dual-release-install-layout-work-budget.*
  .agents/notes/implemented/process/2026-10-05-pr-artifact-typechecks.*
  .agents/notes/implemented/process/2026-10-08-published-source-and-docs.*
  .agents/notes/implemented/process/2026-10-20-weighted-approval-status-gate-with-check-run-label.*

  # DeepSeek process and pull-request skills.
  .agents/skills/cordis-styling-nitpicking
  .agents/skills/dsh-archive-agent-notes
  .agents/skills/dsh-ci-test-reliability
  .agents/skills/dsh-code-review
  .agents/skills/dsh-create-upgrade-guide
  .agents/skills/dsh-cua-macos-signing
  .agents/skills/dsh-find-simplifications
  .agents/skills/dsh-merging-stacked-prs
  .agents/skills/dsh-official-plugin-artwork
  .agents/skills/dsh-pr-description
  .agents/skills/dsh-pre-push-checks
  .agents/skills/dsh-prose-standard
  .agents/skills/dsh-speed-up-perf
  .agents/skills/dsh-trim-cot-leakage
  .agents/skills/record-browser-gif
  scripts/cua-macos-signing.spec.ts

  # native/system npm release scripts and docs.
  native/system/scripts/assemble-prebuilds.mjs
  native/system/scripts/bump-release.mjs
  native/system/scripts/commit-release.mjs
  native/system/scripts/pack-release.mjs
  native/system/scripts/publish-release.mjs
  native/system/scripts/verify-release.mjs
  native/system/scripts/verify-packed-install.mjs
  native/system/test/release-packing.test.js
  native/system/test/package-matrix.test.js
  native/system/docs/release.md
  native/system/docs/packaging.md
  native/system/docs/support-matrix.md
  packages/sandbox/sandbox-local/tests/packed-install.e2e.ts

  # VitePress documentation site.
  website
  scripts/project-doc-site.ts
  scripts/project-doc-site.spec.ts
  scripts/verify-doc-site-fragments.ts
  scripts/verify-doc-site-fragments.spec.ts
)

dry_run=false
[[ "${1:-}" == "--dry-run" ]] && dry_run=true

shopt -s nullglob
removed=0
for pattern in "${paths[@]}"; do
  # Unquoted on purpose: entries ending in `.*` expand to every sidecar.
  for path in $pattern; do
    [[ -e "$path" || -L "$path" ]] || continue
    echo "prune: $path"
    removed=$((removed + 1))
    $dry_run || rm -rf -- "$path"
  done
done

echo "prune: ${removed} path(s) $($dry_run && echo 'would be removed' || echo 'removed')"
