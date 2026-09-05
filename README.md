# Calendar deployment control

This branch contains deployment control only. Application code lives on separate development branches.

## Deploy units

- `root`: the production Solid application, developed on `main` and published at `/calendar/`.
- `old`: the pre-refactor application, published at `/calendar/old/`.
- `vanilla`: the vanilla refactor retained at `/calendar/vanilla/`.

The control branch itself is not an application source.

## Deployment state

`deployment.json` on `deployment-control` is authoritative. Each deploy unit records the deployed application commit plus the Actions artifact and candidate-build run that produced its deployable output.

## Agent action requests

Agents that cannot invoke `workflow_dispatch` directly use the dedicated `action-trigger` branch. That branch contains only the push listener, request file, and branch documentation.

The request format is:

```json
{
  "operation": "test",
  "unit": "root",
  "revision": "main"
}
```

`operation` is `test` or `deploy`. `unit` is `root`, `old`, or `vanilla`. `revision` may be a branch name, tag, full or abbreviated commit ID, or another Git revision that resolves unambiguously to a commit in this repository.

When `action-request.json` changes, `.github/workflows/action-request.yml` on `action-trigger` passes the exact trigger commit SHA to `.github/workflows/dispatch-request.yml` on this branch. The dispatcher reads the request from that exact commit, validates it, resolves `revision` immediately to an exact 40-character application commit SHA, and selects the canonical test or promotion workflow.

The trigger branch does not implement parsing, testing, building, promotion, or deployment. Those definitions live here.

The trigger commit itself identifies the request, so the JSON does not need a separate request ID. Repeating the same request requires a new commit so that GitHub receives another push event. Do not rewrite or force-push away `action-trigger` history during normal operation.

## Testing

A `test` request runs `.github/workflows/test-and-build-candidate.yml` for the resolved application commit and stores deployable output as `deploy-<unit>-<sha>`. It does not publish anything.

## Deploying

A `deploy` request invokes `.github/workflows/promote-deployment.yml`. Promotion only accepts a candidate with a successful canonical test/build artifact for the same unit and SHA.

Promotion jobs share the `deployment-promotions` concurrency group with `queue: max`, so promotions wait one at a time until previous promotions complete.

Successful promotion updates `deployment.json` on this branch. That control-state commit is then used for the Pages deployment.

## Pages deployment

Changes to `deployment.json` on `deployment-control` trigger deployment automatically. Normal operation should use promotion instead of editing the manifest directly.

Deployment does not rerun unit tests or integration checks. It consumes the candidate-build artifacts recorded in the manifest, assembles the three pinned outputs, and publishes one GitHub Pages artifact.

If a recorded artifact is explicitly expired, deployment rebuilds it by SHA without testing it. If GitHub has already removed the artifact metadata and its recorded expiry time has passed, deployment treats that as normal expiry and rebuilds. If an artifact disappears before its recorded expiry, deployment fails.
