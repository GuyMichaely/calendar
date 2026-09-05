# Calendar deployment control

This branch contains deployment control only. Application code lives on separate development branches.

## Deploy units

- `root`: the production Solid application, developed on `main` and published at `/calendar/`.
- `old`: the pre-refactor application, published at `/calendar/old/`.
- `vanilla`: the vanilla refactor retained at `/calendar/vanilla/`.

## Deployment state

`deployment.json` is authoritative. Each deploy unit records the deployed application commit plus the Actions artifact and candidate-build run that produced its deployable output.

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

A `test` request runs `.github/workflows/test-and-build-candidate.yml` for the resolved application commit and stores deployable output as `deploy-<unit>-<sha>`

## Deploying

A `deploy` request invokes `.github/workflows/promote-deployment.yml`. Promotion only accepts a candidate with a successful test/build artifact for the same unit and SHA.

Promotion jobs share the `deployment-promotions` concurrency group with `queue: max`, so promotions wait one at a time until previous promotions complete.

Successful promotion updates `deployment.json` on this branch. That control-state commit is then used for the Pages deployment.

## Pages deployment

Changes to `deployment.json` on `deployment-control` trigger deployment automatically. Normal operation should use promotion instead of editing the manifest directly.

Deployment does not rerun unit tests or integration checks. It consumes the candidate-build artifacts recorded in the manifest, assembles the three pinned outputs, and publishes one GitHub Pages artifact.

If a recorded artifact is explicitly expired, deployment rebuilds it by SHA without testing it. If GitHub has already removed the artifact metadata and its recorded expiry time has passed, deployment treats that as normal expiry and rebuilds. If an artifact disappears before its recorded expiry, deployment fails.
