# Calendar deployment control

This branch contains deployment control only. Application code lives in separate deploy-unit development streams.

## Deploy units

- `root`: the production application, developed on `agent/solid-refactor` and published at `/calendar/`.
- `old`: kept for historical reasons at `/calendar/old/`.
- `vanilla`: kept for historical reasons at `/calendar/vanilla/`

The control branch itself is not an application source.

## Deployment state

`deployment.json` is authoritative. Each deploy unit records the deployed application commit plus the Actions artifact and verification run that produced its deployable output.

## Development and verification

Development branches may contain arbitrary intermediate commits. Pushing development commits does not run verification and does not deploy.

When a commit is ready to publish at `/calendar/`, run **Verify Candidate** with deploy unit `root` and its exact 40-character commit SHA. Root verification runs the repository tests, Solid behavior tests, strict TypeScript checking, and the Solid production build.

When an old or vanilla candidate is ready, verify it with its corresponding deploy unit.

From a shell with GitHub CLI authentication:

```bash
gh workflow run verify-candidate.yml -f unit=root -f commit="$(git rev-parse HEAD)"
```

Or use **Actions -> Verify Candidate -> Run workflow** in GitHub.

A successful Verify Candidate workflow is the canonical indication that all checks for that deploy unit and SHA passed. It stores the deployable output as a 90-day Actions artifact.

## Promotion

After verification succeeds, run **Promote Deployment** with the same unit and SHA:

```bash
gh workflow run promote-deployment.yml -f unit=root -f commit="$(git rev-parse HEAD)"
```

Or use **Actions -> Promote Deployment -> Run workflow**.

Promotion jobs share the `deployment-promotions` concurrency group with `queue: max`, so concurrent requests wait and each reads the manifest after earlier promotions finish.

## Deployment

Changes to `deployment.json` trigger deployment automatically. Normal operation should use Promote Deployment instead of editing the manifest directly.

Deployment does not rerun unit tests or integration checks. It consumes the verified artifacts recorded in the manifest, assembles the three pinned outputs, and publishes one GitHub Pages artifact.

If a recorded artifact is explicitly expired, deployment rebuilds it by SHA without testing it. If GitHub has already removed the artifact metadata and its recorded expiry time has passed, deployment treats that as normal expiry and rebuilds. If an artifact disappears before its recorded expiry, deployment fails.
