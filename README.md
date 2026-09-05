# Calendar deployment control

This branch contains deployment control only. Application code lives on separate development branches.

## Deployment state

`deployment.json` is authoritative desired state. Each deploy unit records:

- `path`: deployment path relative to the Pages site root.
- `revision`: exact application commit that should be deployed.

Artifact IDs and workflow-run metadata are intentionally not persisted in the manifest.

## Agent action requests

Agents that cannot invoke `workflow_dispatch` directly should use the dedicated `action-trigger` branch. That branch has a workflow that listens for push and invokes the `dispatch-request` workflow in this branch.

The request format is:

```json
{
  "operation": "test",
  "unit": "root",
  "revision": "main"
}
```

`operation` is `test` or `deploy`. `unit` is a unit name (currently one of `root`, `old`, or `vanilla`). `revision` is a Git revision. The dispatcher resolves it to an exact commit SHA before canonical work begins.

## Testing

A `test` request runs `.github/workflows/test-and-build-candidate.yml` for the resolved application commit and stores deployable output as `deploy-<unit>-<sha>`.

The SHA remains in the artifact name because GitHub associates an artifact with the top-level workflow run. For requests arriving through `action-trigger`, that run's own `head_sha` is the request commit, not the application commit being built. The artifact name is therefore the direct index from unit and application revision to build output.

Multiple successful artifacts for the same unit and SHA are treated as equivalent. The deployment system assumes build output is a pure function of the application code and does not give newer artifacts special meaning.

## Deploying

A `deploy` request invokes `.github/workflows/promote-deployment.yml`. Promotion first confirms that an active artifact for the unit and exact SHA came from a successful canonical candidate-build workflow. It then records only that SHA as the unit's `revision` in `deployment.json`.

Promotion jobs share the `deployment-promotions` concurrency group with `queue: max`, so promotions wait one at a time until previous promotions complete.

Successful promotion updates `deployment.json` on this branch. That control-state commit is then used for the Pages deployment.

## Pages deployment

Changes to `deployment.json` on `deployment-control` trigger deployment automatically. Normal operation should use promotion instead of editing the manifest directly.

For each unit, deployment looks for any active successful canonical artifact named for the unit and recorded revision. If one exists, it is used. If none is available, the exact recorded revision is rebuilt without rerunning tests. The resulting units are placed at their manifest `path`, assembled into one GitHub Pages artifact, and published.
