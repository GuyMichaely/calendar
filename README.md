# Calendar deployment control

This branch contains deployment control only. Application code lives in separate deploy-unit development streams.

## Deploy units

- `root`: the original application, currently sourced from `reference/pre-preview-deployment-main`.
- `vanilla`: the vanilla refactor, currently developed on `agent/vanilla-refactor`.
- `solid`: the Solid implementation, currently developed on `agent/solid-refactor`.

The public mapping is:

- `root` -> `/calendar/`
- `vanilla` -> `/calendar/vanilla/`
- `solid` -> `/calendar/solid/`

The control branch itself is not an application source.

## Deployment state

`deployment.json` is authoritative. Each deploy unit records the exact deployed application commit plus the Actions artifact and verification run that produced its deployable output.

A deployment always reads the exact control commit that triggered it. Later manifest changes cannot change an older queued deployment.

## Development and verification

Development branches may contain arbitrary intermediate commits. Pushing development commits does not run verification and does not deploy.

When a commit is ready to verify, run **Verify Candidate** with the deploy unit and exact 40-character commit SHA. Verification runs that unit's complete checks, builds or packages the deployable output, and stores it as a 90-day Actions artifact.

From a shell with GitHub CLI authentication:

```bash
gh workflow run verify-candidate.yml -f unit=solid -f commit="$(git rev-parse HEAD)"
```

Or use **Actions -> Verify Candidate -> Run workflow** in GitHub.

A successful Verify Candidate workflow is the canonical indication that all checks for that deploy unit and SHA passed.

## Promotion

After verification succeeds, run **Promote Deployment** with the same unit and SHA:

```bash
gh workflow run promote-deployment.yml -f unit=solid -f commit="$(git rev-parse HEAD)"
```

Or use **Actions -> Promote Deployment -> Run workflow**.

Promotion jobs share the `deployment-promotions` concurrency group with `queue: max`, so concurrent requests wait and each reads the manifest after earlier promotions finish. Promotion does not rerun verification and does not retest unchanged deploy units. It accepts only an active artifact produced by a successful canonical Verify Candidate run.

Promotion updates only the requested unit in `deployment.json` and commits that manifest state. It then dispatches deployment for that exact control commit. GitHub does not recursively trigger push workflows for commits made with the workflow `GITHUB_TOKEN`, so the explicit dispatch preserves the same manifest-commit semantics.

## Deployment

Direct human changes to `deployment.json` also trigger deployment automatically. Normal operation should use Promote Deployment instead of editing the manifest.

Every manifest commit gets its own deployment attempt. Deployments share the `pages-deployments` concurrency group with `queue: max`; older valid deployments are not canceled when a newer promotion arrives.

Deployment does not rerun unit tests or integration checks. It consumes the verified artifacts recorded in the manifest, assembles the three pinned outputs, and publishes one GitHub Pages artifact.

If a recorded artifact is explicitly expired, deployment rebuilds that exact historically verified application SHA without retesting it. If GitHub has already removed the artifact metadata and its recorded expiry time has passed, deployment treats that as normal expiry and rebuilds. If an artifact disappears before its recorded expiry, deployment fails instead of hiding the inconsistency.

Retired preview directories `framework`, `preact`, and `svelte` are removed during Pages assembly.
