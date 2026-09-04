# Calendar deployment control

This branch contains deployment control only. Application code lives in separate deploy-unit development streams.

## Deploy units

- `root`: the selected Solid application, developed on `agent/solid-refactor` and published at `/calendar/`.
- `old`: the pre-refactor application kept as a rollback/reference build and published at `/calendar/old/`.
- `vanilla`: the vanilla refactor, published at `/calendar/vanilla/` for reference while it remains useful.

The former `solid` deploy unit and `/calendar/solid/` application path are retired. Solid is now the primary application stream and `root` is its production/development deployment target.

The control branch itself is not an application source.

## Deployment state

`deployment.json` is authoritative. Each deploy unit records the exact deployed application commit plus the Actions artifact and verification run that produced its deployable output.

A deployment always reads the exact control commit that triggered it. Later manifest changes cannot change an older queued deployment.

The initial Solid-root topology cutover reuses artifacts that were already verified under the previous unit names. Future candidates are verified and promoted under the current `root`, `old`, and `vanilla` unit names.

## Development and verification

Development branches may contain arbitrary intermediate commits. Pushing development commits does not run verification and does not deploy.

Solid development happens on `agent/solid-refactor`. When a Solid commit is ready to publish at `/calendar/`, run **Verify Candidate** with deploy unit `root` and its exact 40-character commit SHA. Root verification runs the repository tests, Solid behavior tests, strict TypeScript checking, and the Solid production build.

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

Promotion jobs share the `deployment-promotions` concurrency group with `queue: max`, so concurrent requests wait and each reads the manifest after earlier promotions finish. Promotion does not rerun verification and does not retest unchanged deploy units. It accepts only an active artifact produced by a successful canonical Verify Candidate run.

Promotion updates only the requested unit in `deployment.json` and commits that manifest state. It then dispatches deployment for that exact control commit. GitHub does not recursively trigger push workflows for commits made with the workflow `GITHUB_TOKEN`, so the explicit dispatch preserves the same manifest-commit semantics.

## Deployment

Direct human changes to `deployment.json` also trigger deployment automatically. Normal operation should use Promote Deployment instead of editing the manifest.

Every manifest commit gets its own deployment attempt. Deployments share the `pages-deployments` concurrency group with `queue: max`; older valid deployments are not canceled when a newer promotion arrives.

Deployment does not rerun unit tests or integration checks. It consumes the verified artifacts recorded in the manifest, assembles the three pinned outputs, and publishes one GitHub Pages artifact:

- `root` at `/calendar/`
- `old` at `/calendar/old/`
- `vanilla` at `/calendar/vanilla/`

If a recorded artifact is explicitly expired, deployment rebuilds that exact historically verified application SHA without retesting it. If GitHub has already removed the artifact metadata and its recorded expiry time has passed, deployment treats that as normal expiry and rebuilds. If an artifact disappears before its recorded expiry, deployment fails instead of hiding the inconsistency.

Retired directories `solid`, `framework`, `preact`, and `svelte` are removed during Pages assembly.
