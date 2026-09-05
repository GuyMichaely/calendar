# Calendar deployment control

This branch contains deployment control only. Application code lives on separate development branches.

## Deployment state

`deployment.json` controls deployment and should only be edited via the `promote-deployment.yml` workflow:

- `path`: deployment path relative to the Pages site root
- `revision`: commit to deploy

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

`operation` is `test` or `deploy`. `unit` is a unit name. `revision` is a Git revision.

## Testing

A `test` request runs `.github/workflows/test-and-build-candidate.yml` for the resolved application commit and stores deployable output as `deploy-<unit>-<sha>`.

## Deploying

A `deploy` request invokes `.github/workflows/promote-deployment.yml`. Promotion confirms that the given unit and SHA have a build output that came from `test-and-build-candidate.yml` and then updates the SHA for the given unit in `deployment.json`, triggering a deploy.

Promotion jobs share the `deployment-promotions` concurrency group with `queue: max`, so promotions wait one at a time until previous promotions complete.

## Pages deployment

Changes to `deployment.json` on `deployment-control` trigger deployment automatically. Normal operation should use promotion instead of editing the manifest directly.

For each unit, deployment looks up the artifact named for the unit-revision pair. If it exists, it is used. If none is available, the exact recorded revision is rebuilt without rerunning tests. The resulting units are placed at their manifest `path`, assembled into one GitHub Pages artifact, and published.
