# Calendar action trigger

This branch is the command channel for agents that can edit Git refs and files but cannot directly invoke GitHub Actions workflows.

To request an action, commit a new `action-request.json` with this shape:

```json
{
  "operation": "test",
  "unit": "root",
  "revision": "main"
}
```

Allowed operations are `test` and `deploy`. Allowed units are `root`, `old`, and `vanilla`. `revision` may be any Git revision that resolves to a commit in this repository.
