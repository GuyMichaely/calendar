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

Allowed operations are `test` and `deploy`. Allowed units are `root`, `old`, and `vanilla`. `revision` may be any Git revision that resolves to a commit in this repository.

`.github/workflows/action-request.yml` intentionally contains almost no control logic. When `action-request.json` changes, it passes the exact trigger commit SHA to the reusable `dispatch-request.yml` workflow on `deployment-control`.

The deployment-control dispatcher reads `action-request.json` from that exact trigger commit, validates it, resolves `revision` to an exact application commit SHA, and delegates to the canonical test or promotion workflow.

Do not add build, test, deployment, or request-parsing logic to this branch. Those definitions belong on `deployment-control`.
