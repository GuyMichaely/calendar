# Calendar action trigger

This branch is the command channel for agents that can edit Git refs and files but cannot directly invoke GitHub Actions workflows.

Do not develop application code here. Application development belongs on the appropriate development branch. Canonical CI and deployment implementation belongs on `deployment-control`.

To request an action, commit a new `action-request.json` with this shape:

```json
{
  "operation": "test",
  "unit": "root",
  "revision": "main"
}
```

Allowed operations are `test` and `deploy`. Allowed units are `root`, `old`, and `vanilla`. `revision` may be any Git revision that resolves unambiguously to a commit in this repository, including a branch, tag, full SHA, or abbreviated SHA.

`.github/workflows/action-request.yml` resolves the requested revision to an exact 40-character SHA before invoking canonical reusable workflows on `deployment-control`. The resolved SHA is what the build or deployment operates on.

The trigger commit itself is the request identifier. Do not add a request ID to the JSON merely to make requests unique. To repeat an identical request, create another commit. Preserve this branch's history so the request commits remain available for audit.
