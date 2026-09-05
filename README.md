# Calendar deployment control

This branch contains deployment control only. Application code lives on separate development branches.

## Deployment state

`deployment.json` controls deployment. Each key under `units` defines one deployed unit:

- `path`: deployment path relative to the Pages site root
- `revision`: application commit currently pinned for that unit

Changes to `deployment.json` automatically initiate Pages deployment. Normal changes should be done via `promote-deployment.yml`. Edit `deployment.json` directly at your own risk.

Deployment paths must be unique and may share parent directories. For example, `/parent/child1/` and `/parent/child2/` are valid. A non-root unit may not own a path that contains another unit's path, so `/parent/` and `/parent/child/` cannot both be deployment units. A unit at `/` may coexist with subpath units.

## Agent action requests

Agents that cannot invoke `workflow_dispatch` directly should use the dedicated `action-trigger` branch. That branch has a workflow that listens for push and invokes the `dispatch-request` workflow in this branch.

The basic request format is:

```json
{
  "operation": "test",
  "unit": "prod",
  "revision": "main",
  "requestNonce": "any arbitrary value"
}
```

A deploy request may also include `path`:

```json
{
  "operation": "deploy",
  "unit": "preview",
  "revision": "feature-branch",
  "path": "/preview/",
  "requestNonce": "another arbitrary value"
}
```

`operation` is `test` or `deploy`. `unit` is a syntactically valid unit label. `revision` is a Git revision resolving to a commit. The dispatcher resolves the revision to a commit SHA to pin against. `path` is only valid for deploy requests and is optional when promoting an existing unit.

Additional top-level JSON fields are allowed. The dispatcher ignores them. Agents can therefore change an arbitrary field such as `requestNonce` when they need a new commit to submit an otherwise identical request.

## Testing and building

A `test` request runs `.github/workflows/test-and-build-candidate.yml`. The workflow builds a deploy-ready artifact if all tests succeed. Supply a previously unused unit label if you want to prepare a new deploy unit for a later deployment.

The candidate revision itself determines how it is built. Revisions with a `build:solid` package script are built from `site/solid`; other revisions use `site`. Tests and typechecking are run when the corresponding package scripts exist.

If the candidate passes, deployable output is stored as `deploy-<unit>-<sha>`. A build refuses to create another active artifact for the same unit-commit pair.

## Deploying

A `deploy` request invokes `.github/workflows/promote-deployment.yml`. Promotion accepts any syntactically valid unit label and confirms that the exact unit-SHA candidate artifact exists and came from `test-and-build-candidate.yml`.

If the unit already exists and no `path` is supplied, promotion preserves its current path and updates only its revision. If `path` is supplied, promotion writes that path; this can also create a previously unknown unit. A new unit without a path fails because there is no deployment location to record.

Promotion jobs share the `deployment-promotions` concurrency group with `queue: max`, so promotions wait one at a time until previous promotions complete.

## Pages deployment

Changes to `deployment.json` on `deployment-control` trigger deployment automatically. Normal operation should use promotion for revision and path changes.

For every unit defined in the manifest, deployment looks up the artifact named for the unit-revision pair. If it exists, it is used. If none is available, the exact recorded revision is rebuilt without rerunning tests. The resulting units are placed at their manifest `path`, assembled into one GitHub Pages artifact, and published.
