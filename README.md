# Calendar deployment control

This branch contains deployment control only. Application code lives in separate deploy-unit development streams.

## Deploy units

- `root`: the production application, developed on `agent/solid-refactor` and published at `/calendar/`.
- `old`: kept for historical reasons at `/calendar/old/`.
- `vanilla`: kept for historical reasons at `/calendar/vanilla/`

The control branch itself is not an application source.

## Deployment state

`deployment.json` is authoritative. Each deploy unit records the deployed application commit plus the Actions artifact and candidate-build run that produced its deployable output.

## Development and testing

Development branches may contain arbitrary intermediate commits. Pushing development commits does not run tests, build, or deploy.

Use **Test and Build Candidate** whenever you want GitHub to run the canonical checks for a commit. Test semantics are defined per unit in the action.

From a shell with GitHub CLI authentication:

```bash
gh workflow run test-and-build-candidate.yml -f unit=root -f commit="$(git rev-parse HEAD)"
```

Or use **Actions -> Test and Build Candidate -> Run workflow** in GitHub.

A successful run is meant to indicate that all tests pass and the app builds. It stores the deployable output as `deploy-<unit>-<sha>`. Running it does not deploy anything; use Promote Deployment for that.

## Deploying

When you want to deploy a build, run **Promote Deployment** with the unit name and SHA:

```bash
gh workflow run promote-deployment.yml -f unit=<unit-name> -f commit="$(git rev-parse HEAD)"
```

Or use **Actions -> Promote Deployment -> Run workflow**.

Promotion jobs share the `deployment-promotions` concurrency group with `queue: max`, so promotions wait one at a time until all previous promotions complete.

Successful promotion jobs modify `deployment.json`, triggering a deploy.

## Deployment

Changes to `deployment.json` trigger deployment automatically. Normal operation should use Promote Deployment instead of editing the manifest directly.

Deployment does not rerun unit tests or integration checks. It consumes the candidate-build artifacts recorded in the manifest, assembles the three pinned outputs, and publishes one GitHub Pages artifact.

If a recorded artifact is explicitly expired, deployment rebuilds it by SHA without testing it. If GitHub has already removed the artifact metadata and its recorded expiry time has passed, deployment treats that as normal expiry and rebuilds. If an artifact disappears before its recorded expiry, deployment fails.
