# Calendar

A personal calendar and task planner built around the distinction between an open task and a task that is actionable right now.

## Current implementation

The app is a static web app that runs entirely in the browser:

- task and event creation/editing;
- IndexedDB persistence;
- task states: open, completed, canceled;
- available-from, due, and latest-start times;
- recurring action windows for persistent tasks, such as office hours;
- sleep as a separate user-imposed suppression layer, either until a chosen time or indefinitely;
- one-click sleep until the next calendar day plus a dedicated custom sleep dialog;
- conversion between a finite sleep date and an available-from wait date;
- task sections for Can do now, a combined Upcoming/Waiting view, All open, and Completed;
- sleeping tasks folded into the bottom of the combined Upcoming/Waiting section;
- optional upcoming horizons: rolling 1/7/30 days or calendar-boundary Today/This week/This month;
- turning the horizon off shows all tasks with a known future opportunity, i.e. Waiting;
- keyboard task navigation: click or arrow-focus task cards, use Up/Down between visible tasks, Enter to open details, and Tab through a focused card's controls;
- configurable task hotkeys for completion, sleep until tomorrow, indefinite sleep, and custom sleep;
- icon sleep actions with accessible labels/tooltips;
- month calendar rendering one projected start marker per task, plus distinct latest-start, due, and sleep-wake markers;
- a calendar-only toggle that moves each projected task start according to whether sleep is respected or ignored;
- calendar-day creation flow for events or tasks with the selected day prefilled;
- calendar search that dims nonmatching items without leaving the calendar view;
- tags and local file attachments on tasks and events, with file-picker and drag/drop attachment input;
- compact task cards that retain a two-line notes preview;
- queued, click-to-dismiss toast notifications;
- text/tag/attachment-name search;
- local file attachments stored in IndexedDB;
- JSON backup/export and import, including attachment contents;
- session undo/redo for item mutations, available from the menu and via Ctrl/Cmd+Z, Ctrl/Cmd+Shift+Z, or Ctrl+Y;
- a top-left hamburger menu anchored to its trigger;
- a dark interface with responsive desktop and Android-sized layouts;
- service-worker shell caching for basic offline use.

Waiting is derived from real availability constraints. Sleep does not change a task's underlying actionability. It only controls whether the task is surfaced to the user and, when enabled in the calendar, whether sleep is treated as an additional delay while projecting the next work opportunity.

There is deliberately no cloud backend yet. Data is local to each browser/device. The storage boundary is isolated so a cloud-backed implementation can replace or supplement IndexedDB later.

Undo/redo history is deliberately stored in the separate `calendar-history` IndexedDB database and is session-scoped. A future cloud-sync implementation should sync calendar items and attachments, not the undo-history database.

## Data migrations

The application code under `site/` assumes the current data schema. It should not contain runtime compatibility or automatic migration paths for older schemas.

When a schema change requires existing local data to be converted, put the conversion in a one-off script under `migrations/` and run it explicitly before using the new application version.

## Local development

No build step is required.

```bash
python3 -m http.server 8000 -d site
```

Then open `http://localhost:8000`.

Run domain tests with:

```bash
npm test
```

## Deployment

GitHub Pages publishes one artifact for this repository. The deployment workflow assembles that artifact from three independently developed sources:

- `main` is published at `/calendar/`;
- `agent/vanilla-refactor` is published at `/calendar/vanilla/`;
- `agent/framework-preact-refactor` is built and published at `/calendar/framework/`.

`scripts/assemble-pages.mjs` creates the final artifact without changing any source tree. The root app is copied first, then each preview replaces only its own subdirectory. The deployment workflow runs the tests for all three sources and the framework typecheck/build before publishing.

The Pages deployment runs after `main` changes, can be dispatched manually, and is also refreshed after successful `Calendar CI` runs on either preview branch. Browser assets use relative URLs, so the same frontend source can operate at its assigned subpath without hard-coding `/calendar/`.

Frontend branches do not own deployment files. `.github/workflows/pages.yml`, `.github/workflows/deploy-pages.yml`, `scripts/assemble-pages.mjs`, `tests/pages-deployment.test.js`, and `site/sw.js` are maintained on `main` and should remain identical in both frontend branches. Service-worker shell manifests are not tracked source files: the assembler generates `sw-shell.js` independently for each deployed frontend from that frontend's actual static files. This lets each preview have the correct offline shell without creating a branch-owned deployment file that can conflict with `main`.

A frontend change is deployed by pushing to its existing preview branch. The shared `Calendar CI` workflow validates the branch. A successful run triggers the `main` deployment workflow, which rebuilds and tests the combined artifact before publishing. Frontend agents should not add branch-specific Pages jobs, service-worker deployment manifests, or modify the deployment aggregator to publish their own preview.

When shared deployment infrastructure changes, change and validate it on `main` first, then merge that `main` commit into both frontend branches before further frontend work. Shared deployment files should arrive through that merge unchanged. Changes to backend, sync, authentication, or other non-frontend branches are outside this protocol.
