# Calendar deployment control

This branch contains deployment control only. Application code lives on separate development branches.

## Deploy units

- `root`: the production Solid application, developed on `main` and published at `/calendar/`.
- `old`: the pre-refactor application, published at `/calendar/old/`.
- `vanilla`: the vanilla refactor retained at `/calendar/vanilla/`.

The control branch itself is not an application source.

## Deployment state

`deployment.json` is authoritative. Each deploy unit records the deployed application commit plus the Actions artifact and candidate-build run that produced its deployable output.

## Agent action requests

Agents that cannot invoke `workflow_dispatch` directly use the dedicated `action-trigger` branch. That branch contains a permanent `.github/workflows/action-request.yml` dispatcher and `action-request.json`.

The request format is:

```json
{
  "operation": "test",
  "unit": "root",
  "revision": "main"
}
```

`operation` is `test` or `deploy`. `unit` is `root`, `old`, or `vanilla`. `revision` may be a branch name, tag, full or abbreviated commit ID, or another Git revision that resolves unambiguously to a commit in this repository.

An agent requests work by committing a new `action-request.json` to `action-trigger`. The push-triggered dispatcher resolves `revision` immediately and records the exact 40-character commit SHA in the Actions log. All subsequent test, build, verification, and deployment work uses that SHA even if the named branch later moves.

The trigger commit itself identifies the request, so the JSON does not need a separate request ID. Repeating the same request requires a new commit so that GitHub receives another push event.

The dispatcher delegates canonical work to reusable workflows on `deployment-control`. Application development branches do not need GitHub Actions listener files merely to let agents request CI or deployment.

Do not rewrite or force-push away `action-trigger` history during normal operation. Its commits provide a human-readable request audit trail alongside the GitHub Actions run history.

## Testing

A `test` request runs the canonical checks for the resolved application commit and stores deployable output as `deploy-<unit>-<sha>`. It does not publish anything.

Humans can still invoke **Test and Build Candidate** manually with an exact SHA through GitHub Actions or `gh workflow run`. Manual dispatch is a fallback and diagnostic interface, not the agent protocol.

## Deploying

A `deploy` request resolves the requested revision to an exact SHA and invokes **Promote Deployment**. Promotion only accepts a candidate with a successful canonical test/build artifact for the same unit and SHA.

Promotion jobs share the `deployment-promotions` concurrency group with `queue: max`, so promotions wait one at a time until previous promotions complete.

Successful promotion updates `deployment.json`. That manifest update triggers the Pages deployment.

Humans can still invoke **Promote Deployment** manually with an exact SHA when needed.

## Pages deployment

Changes to `deployment.json` trigger deployment automatically. Normal operation should use promotion instead of editing the manifest directly.

Deployment does not rerun unit tests or integration checks. It consumes the candidate-build artifacts recorded in the manifest, assembles the three pinned outputs, and publishes one GitHub Pages artifact.

If a recorded artifact is explicitly expired, deployment rebuilds it by SHA without testing it. If GitHub has already removed the artifact metadata and its recorded expiry time has passed, deployment treats that as normal expiry and rebuilds. If an artifact disappears before its recorded expiry, deployment fails.
