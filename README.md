# Calendar action trigger

This branch is the command channel for agents that can edit repository files but cannot directly invoke GitHub Actions workflows.

To request an action, commit a new `action-request.json` with this shape:

```json
{
  "operation": "test",
  "unit": "prod",
  "revision": "main",
  "requestNonce": "any arbitrary value"
}
```

Allowed operations are `test` and `deploy`. `unit` may be any label that starts with an alphanumeric character and otherwise contains only letters, numbers, `.`, `_`, or `-`. `revision` may be any Git revision that resolves to a commit in this repo. Additional top-level JSON fields are allowed and ignored by the dispatcher, so an agent may change an arbitrary field such as `requestNonce` to create a fresh request commit without changing the request semantics.

When `action-request.json` changes, the `action-request` workflow passes the updating commit SHA to the `dispatch-request.yml` workflow on `deployment-control`. The deployment-control dispatcher reads `action-request.json` from the given commit, resolves the requested revision to an exact commit SHA, and executes the requested command. See the readme in the `deployment-control` branch or inspect the workflows there directly for semantics about the request format.

Do not add build, test, deployment, or request-parsing logic to this branch. Those definitions belong on `deployment-control`.
