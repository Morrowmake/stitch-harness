# AGENTS.md — GitHub Actions

Every job runs on a standard GitHub-hosted label (`ubuntu-24.04`/`ubuntu-latest`, `ubuntu-24.04-arm`, `macos-latest`, `macos-15-intel`, `windows-2025`/`windows-latest`). Never add in-house pools, larger runners, third-party runner labels, failover expressions, or repository-name guards; `scripts/ci-workflow.spec.ts` enforces this. Pin actions to the exact versions the other workflows use, and check out with `persist-credentials: false` unless a job pushes.

`ci.yml` runs on pull requests, master pushes, and `workflow_dispatch`: parallel `build`, `test`, and `lint` jobs (`pnpm run build`, `pnpm run test`, `pnpm run lint`) on `ubuntu-24.04`, plus the `all checks passed` verdict that branch protection requires. The test job prepares bubblewrap with `scripts/prepare-ci-bubblewrap.sh` because the Linux sandbox suites confine real processes. Python pull-request jobs live in `ci-python.yml` and feed the `python checks passed` verdict; `python-release.yml` builds the complete wheel set on hosted runners and never publishes. Run Windows steps under native `pwsh`.

Secrets are optional. A workflow that consumes one (for example `e2e.yml` with `DEEPSEEK_API_KEY_EXTERNAL`) detects it first and skips its job when the secret is absent, instead of failing. Release tags are `stitch-v<version>`.
