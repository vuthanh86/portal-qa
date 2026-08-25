# Azure DevOps wrapper for `@vttech/portal-qa`

This folder packages the CLI as an Azure DevOps custom task.
Reference it in your `azure-pipelines.yml` after publishing to a feed or
the Visual Studio Marketplace.

## Pipeline usage

```yaml
- task: vuthanh.portal-qa.render@1
  inputs:
    command: render     # render | verify | learn | serve
    runDir: $(Build.SourcesDirectory)/qa-run
    memoryDir: $(Pipeline.Workspace)/qa-memory
    registry: https://pkgs.dev.azure.com/<org>/_packaging/<feed>/npm/registry/
    cliVersion: 0.1.0
    port: 4173          # only used by `serve`
```

Outputs (`$(portal-qa.summaryPath)`, `$(portal-qa.totals)`) become available
to downstream tasks after the step completes.

## Local sideload (developer workflow)

1. Install the Azure DevOps extension SDK: `npm i -g tfx-cli`.
2. From the repo root: `tfx extension create --manifest-globs azdevops/vss-extension.json --output ./dist`.
3. Upload the generated `.vsix` to your org's Marketplace via
   `https://marketplace.visualstudio.com/manage`.

The task expects the CLI to be discoverable on PATH (locally that means a
plain `npm install -g @vttech/portal-qa`, in CI the agent installs on demand
via `npm exec --yes`).