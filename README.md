# @vttech/portal-qa

> Lightweight, install-anywhere QA summary renderer + memory hooks + HTTP server.
> Same renderer that powers `~/.dsh/scripts/render-qa-summary.mjs`, now publishable to npm, GitHub Packages, or any private registry.

## Install

```bash
# npm public registry (default)
npm install -g @vttech/portal-qa

# or one-shot, no install
npx @vttech/portal-qa render ./my-run

# GitHub Packages
npm install @vttech/portal-qa --registry=https://npm.pkg.github.com

# private registry (e.g. Azure Artifacts)
npm install @vttech/portal-qa --registry=https://pkgs.dev.azure.com/<org>/_packaging/<feed>/npm/registry/
```

## CLI

```bash
qa render <run-dir>             # render results.json + evidence/ → summary.html
qa verify [--dir <demo-dir>]    # self-test: render demo, toggle trend.json, assert markers
qa learn  <run-dir>             # merge a run into ~/.dsh/qa-memory/learn.json
qa serve  [--port 4173]         # tiny HTTP server for in-pipeline inspection
qa --version
```

## Node API

```js
import { renderSummary } from "@vttech/portal-qa/renderer";
import { readTrend, appendTrend } from "@vttech/portal-qa/memory/trend";
import { mergeLearn } from "@vttech/portal-qa/memory/learn";

const totals = await renderSummary("./my-run");
await appendTrend({ date: "2026-08-20", passRate: 80 });
```

## HTTP server

```bash
qa serve --port 4173
```

| Method | Path | Purpose |
|---|---|---|
| `GET`  | `/health` | `{ ok, version }` |
| `GET`  | `/render?runDir=…` | renders and returns totals |
| `POST` | `/render` | body `{ "runDir": "…" }` → renders, returns totals |
| `GET`  | `/` | lists run dirs under `~/.dsh/runs/` (override via `DSH_RUNS_DIR`) |

Binds `127.0.0.1` by default. `--host 0.0.0.0` for containers.

## Azure DevOps pipeline

See [`azdevops/task.yml`](./azdevops/task.yml). Reference in your `azure-pipelines.yml`:

```yaml
- task: vuthanh.portal-qa.render@1
  inputs:
    runDir: $(Build.SourcesDirectory)/qa-run
    memoryDir: $(Pipeline.Workspace)/qa-memory
```

## CI/CD release verification

This package verifies its own release. Tag `v*.*.*` to trigger:

1. `npm ci`
2. `npm test` (runs `qa verify` — every renderer feature smoke-tested)
3. `npm pack --dry-run` (asserts tarball contents)
4. `npm publish --provenance`

See [`.github/workflows/release.yml`](./.github/workflows/release.yml).

## Features

- Counts bar (Total / OK / FAIL / SKIP / Flaky / Duration / Pass rate) + status filters
- Priority grouping P0 → P3
- Pass-rate trend sparkline (reads `trend.json` if present, omits silently otherwise)
- Screenshot lightbox (click image → full-screen; Esc / click outside to close)
- Copy-defect button on FAIL rows
- `a11y` chip + detail list when `a11yIssues` present
- `⚡ slow` chip when `pageLoadMs > 5000`
- REGRESSION section, slowest tests (top 5), defects ledger, recommendation, learn summary

Zero runtime dependencies. Single-quoted JS, plain Node ESM, `node --check` clean.