# Calendar deployment control

This branch contains deployment control only. Application code lives on separate development branches.

## Deployment state

`deployment.json` controls deployment. Each key under `units` defines one deployed unit:

- `path`: deployment path relative to the Pages site root
- `revision`: exact application commit currently pinned for that unit

Normal changes should go through `promote-deployment.yml`. Promotion can update an existing unit's revision, change its path when a path is supplied, or create a new unit when both a previously unused unit label and a path are supplied.

Deployment paths must be unique, but they may share parents or be nested. For example, `/parent/child1/` and `/parent/child2/` are valid, as are `/parent/` and `/parent/child/`. A unit at `/` is optional.

## Agent action requests

Agents that cannot invoke `workflow_dispatch` directly should use the dedicated `action-trigger` branch. That branch has a workflow that listens for push and invokes the `dispatch-request` workflow in this branch.

The basic request format is:

```json
{
  "operation": "test",
  "unit": "prod",
  "revision": "main"
}
```

A deploy request may also include `path`:

```json
{
  "operation": "deploy",
  "unit": "preview",
  "revision": "feature-branch",
  "path": "/preview/"
}
```

`operation` is `test` or `deploy`. `unit` is a unit label. `revision` is any Git revision that resolves to a commit in this repository. The dispatcher resolves the revision to an exact commit SHA before canonical work begins. `path` is only valid for deploy requests and is optional when promoting an existing unit.

## Testing and building

A `test` request runs `.github/workflows/test-and-build-candidate.yml`. Unit labels are not limited to the units already present in `deployment.json`, so an unused label can be used to prepare a candidate build before that unit exists in the manifest.

The candidate revision itself determines how it is built. Revisions with a `build:solid` package script are built from `site/solid`; other revisions use `site`. Tests and typechecking are run when the corresponding package scripts exist.

If the candidate passes, deployable output is stored as `deploy-<unit>-<sha>`. A build refuses to create another active artifact for the same unit and exact commit.

## Deploying

A `deploy` request invokes `.github/workflows/promote-deployment.yml`. Promotion accepts any syntactically valid unit label and confirms that the exact unit-SHA candidate artifact exists and came from `test-and-build-candidate.yml`.

If the unit already exists and no `path` is supplied, promotion preserves its current path and updates only its revision. If `path` is supplied, promotion writes that path; this can also create a previously unknown unit. A new unit without a path fails because there is no deployment location to record.

Promotion jobs share the `deployment-promotions` concurrency group with `queue: max`, so promotions wait one at a time until previous promotions complete.

## Pages deployment

Changes to `deployment.json` on `deployment-control` trigger deployment automatically. Normal operation should use promotion for revision and path changes.

For every unit defined in the manifest, deployment looks up the artifact named for the unit-revision pair. If it exists, it is used. If none is available, the exact recorded revision is rebuilt without rerunning tests. The resulting units are placed at their manifest `path`, assembled into one GitHub Pages artifact, and published.
