# Calendar action trigger

This branch is the command channel for agents that can edit repository files but cannot directly invoke GitHub Actions workflows.

To request an action, commit a new `action-request.json` with this shape:

```json
{
  "operation": "test",
  "unit": "prod",
  "revision": "main"
}
```

Allowed operations are `test` and `deploy`. `unit` may be any label that starts with an alphanumeric character and otherwise contains only letters, numbers, `.`, `_`, or `-`. `revision` may be any Git revision that resolves to a commit in this repository.

A test request may use a unit label that is not yet present in `deployment.json`. A deploy request may optionally include `path`, for example:

```json
{
  "operation": "deploy",
  "unit": "preview",
  "revision": "feature-branch",
  "path": "/preview/"
}
```

For an existing unit, omitting `path` preserves its current deployment path. Supplying `path` changes the path, and supplying a new unit together with `path` creates that unit in `deployment.json`. A deploy request for an unknown unit without `path` fails.

When `action-request.json` changes, the `action-request` workflow passes the updating commit SHA to the `dispatch-request.yml` workflow on `deployment-control`. The deployment-control dispatcher reads `action-request.json` from the given commit, resolves the requested revision to an exact commit SHA, and executes the requested command.

Do not add build, test, deployment, or request-parsing logic to this branch. Those definitions belong on `deployment-control`.
