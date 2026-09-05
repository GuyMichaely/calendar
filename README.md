# Calendar action trigger

This branch is the command channel for agents that can edit repository files but cannot directly invoke GitHub Actions workflows.

To request an action, commit a new `action-request.json` with this shape:

```json
{
  "operation": "test",
  "unit": "root",
  "revision": "main"
}
```

Allowed operations are `test` and `deploy`. Allowed units are currently `root`, `old`, and `vanilla`, matching the units in `deployment.json` on the `deployment-control` branch. `revision` may be any Git revision that resolves to a commit in this repository.

When `action-request.json` changes, the `action-request` workflow passes the updating commit SHA to the `dispatch-request.yml` workflow on `deployment-control`. The deployment-control dispatcher reads `action-request.json` from the given commit and parses it to execute the command requested inside.

Do not add build, test, deployment, or request-parsing logic to this branch. Those definitions belong on `deployment-control`.
