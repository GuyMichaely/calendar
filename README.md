# Calendar

A personal calendar and task planner built around the distinction between an open task and a task that is actionable right now.

## Current implementation

The selected frontend is SolidJS + TypeScript + Vite. `agent/solid-refactor` is the primary application development stream and its verified `root` candidates are published at `/calendar/`.

The app supports:

- task and event creation/editing;
- task states: open, completed, canceled;
- available-from, due, and latest-start times;
- recurring action windows for persistent tasks, such as office hours;
- sleep as a separate user-imposed suppression layer, either until a chosen time or indefinitely;
- one-click sleep until the next calendar day plus a dedicated custom sleep dialog;
- conversion between a finite sleep date and an available-from wait date;
- task sections for Can do now, a combined Upcoming/Waiting view, All open, and Completed;
- sleeping tasks folded into the bottom of the combined Upcoming/Waiting section;
- optional upcoming horizons: rolling 1/7/30 days or calendar-boundary Today/This week/This month;
- keyboard task navigation and configurable task shortcuts;
- month calendar projection with sleep-aware task starts;
- calendar search that dims nonmatching items;
- tags and local file attachments on tasks and events, with file-picker and drag/drop attachment input;
- compact task cards with a notes preview;
- queued, click-to-dismiss toast notifications;
- JSON backup/export and import, including attachment contents;
- local session undo/redo;
- a dark responsive interface.

Waiting is derived from real availability constraints. Sleep does not change a task's underlying actionability. It controls whether the task is surfaced and, in the calendar, whether sleep is treated as an additional delay when projecting a work opportunity.

## Local data and Automerge

The Solid development stream uses one Automerge document as the canonical local calendar/task state. The document is stored in the `calendar-automerge` IndexedDB database and is designed to be the unit exchanged by the future remote `/sync` endpoint.

Calendar item updates are represented as fine-grained Automerge changes where practical. Title and notes use Automerge collaborative text operations; tags, attachment metadata, task fields, and tombstones have separate operations. Deletion is represented by an application-level `deletedAt` tombstone so an offline edit cannot accidentally resurrect a deleted item.

Attachment bytes are deliberately not placed in the Automerge document. Attachment metadata participates in the CRDT; local `Blob` contents are stored separately in the `attachments` object store and will use a separate content-addressed remote blob path when cloud synchronization is added.

`readSyncSnapshot()` and `mergeSyncSnapshot()` in `site/storage.js` expose the current serialized Automerge document boundary for the later request/response sync client. There is no remote service configured in the Solid application yet.

Undo/redo history remains in the separate `calendar-history` IndexedDB database and is session-scoped. It is never part of the Automerge document and must never be synchronized between devices. Undo/redo is applied as new local CRDT changes rather than restoring the entire remote-sync document wholesale, so unrelated merged list/history changes are retained.

## Data migrations

Application code assumes the current storage/schema format. It does not contain runtime compatibility or automatic migration paths for older data.

The switch from the old `calendar-app/items` store to the Automerge-backed store therefore has a one-off migration:

```text
migrations/2026-09-automerge-storage.js
```

Run it explicitly in DevTools on the calendar origin before using an Automerge-backed deployed candidate with existing data. Back up first. The migration:

- reads the existing `calendar-app/items` records;
- writes one versioned Automerge document to `calendar-automerge`;
- moves attachment blobs into the separate local attachment store while keeping only metadata in the CRDT;
- leaves the old `calendar-app` database untouched for `/calendar/old/` rollback/reference use;
- starts a new local undo-history session rather than migrating undo state;
- refuses to overwrite a non-empty Automerge database unless the script is deliberately edited to force replacement.

After migration, changes made in `/calendar/old/` and the new Solid app are independent because they use different local data stores.

## Local development

Install dependencies and run the Solid dev server:

```bash
npm install
npm run dev:solid
```

Validation commands used for a Solid root candidate are:

```bash
npm test
npm run test:solid
npm run typecheck:solid
npm run build:solid
```

The production Vite base is `/calendar/` and the build output is `site/solid/`.

## Deployment

Deployment infrastructure lives on the separate default branch `deployment-control`; that branch is control-plane only and is not application source.

Current public deploy units are:

- `root`: Solid, published at `/calendar/`;
- `old`: the pre-refactor application, published at `/calendar/old/`;
- `vanilla`: the vanilla refactor retained for reference at `/calendar/vanilla/`.

The old `/calendar/solid/` deployment is retired.

Pushing development commits does not verify or deploy them. To publish a Solid commit, run **Verify Candidate** from `deployment-control` with unit `root` and the exact Solid commit SHA. A successful verification runs the repository tests, Solid behavior tests, strict TypeScript checking, and the Vite build and records the resulting artifact. Then run **Promote Deployment** with the same unit/SHA. Promotion updates only the `root` entry in `deployment.json`; deployment assembles the pinned already-verified `root`, `old`, and `vanilla` artifacts.

See the `deployment-control` branch README for the authoritative deployment protocol.
