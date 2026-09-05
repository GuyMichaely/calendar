# Calendar deployment control

This branch contains deployment control only. Application code lives on separate development branches.

## Deploy units

`deployment.json` defines each unit and its deployment path relative to the GitHub Pages site root. For this repository, `/` is published at `/calendar/`, `/old/` at `/calendar/old/`, and `/vanilla/` at `/calendar/vanilla/`.

## Deployment state

`deployment.json` is authoritative. Each deploy unit records:

- `path`: deployment path relative to the Pages site root.
- `sha`: exact application commit that is deployed.
- `artifact`: GitHub Actions artifact ID for the verified build.

Artifact IDs uniquely pin the build artifact in this repository. The manifest does not duplicate artifact name, verification run ID, expiry timestamp, or digest metadata.

Candidate artifacts are still named `deploy-<unit>-<sha>`. Promotion starts with a requested unit and application revision, before it knows the artifact ID, so the unit and SHA in the artifact name provide the lookup key. Promotion verifies that the matching artifact came from a successful canonical candidate workflow, then records only its artifact ID in the manifest.

If a pinned artifact has expired or is otherwise unavailable, Pages deployment rebuilds that unit from the manifest's exact `sha` without rerunning tests.

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

`operation` is `test` or `deploy`. `unit` is a unit name (currently one of `root`, `old`, or `vanilla`). `revision` is a Git revision.

## Testing

A `test` request runs `.github/workflows/test-and-build-candidate.yml` for the resolved application commit and stores deployable output as `deploy-<unit>-<sha>`.

## Deploying

A `deploy` request invokes `.github/workflows/promote-deployment.yml`. Promotion only accepts a candidate with a successful test/build artifact for the same unit and SHA.

Promotion jobs share the `deployment-promotions` concurrency group with `queue: max`, so promotions wait one at a time until previous promotions complete.

Successful promotion updates `deployment.json` on this branch. That control-state commit is then used for the Pages deployment.

## Pages deployment

Changes to `deployment.json` on `deployment-control` trigger deployment automatically. Normal operation should use promotion instead of editing the manifest directly.

Deployment does not rerun unit tests or integration checks. It materializes the pinned units, places each one at the `path` recorded in the manifest, assembles one GitHub Pages artifact, and publishes it.
