# Interface redesign

The `ui/redesign` branch explores a quieter planning workspace. It changes presentation and navigation; the task model, Automerge document, native sync protocol, auth, and backend remain the same.

## The design

- **My day** brings together tasks that can be worked on and upcoming or sleeping tasks. **All tasks** and **Completed** are separate views, so items do not repeat down one long page.
- A persistent desktop sidebar separates working on tasks from planning in the calendar. On phones, bottom navigation keeps creation and settings within reach. Search expands when needed.
- Quick capture adds a task with a title and Enter. The detail editor remains available for dates, notes, subtasks, and attachments.
- Task rows use less visual framing. Hierarchy, completion, notes, and two direct actions take priority. The sleep dialog offers tomorrow, indefinitely, or a specific date; existing keyboard shortcuts still work.
- A selected-day agenda sits beside the desktop month and below it on mobile. Phones use date indicators rather than tiny, truncated event titles; the agenda exposes every entry, including those behind “more.”
- Item details open beside the workspace in a single-scroll panel. The title is editable, dates precede notes, working hours are expandable, and subtasks and attachments have clear sections.
- A single stylesheet defines the warm light surfaces, charcoal navigation, restrained orange accents, and responsive layouts. It replaces seven overlapping stylesheets. There are no new packages, fonts, remote assets, or services.

## Interaction contracts

Task identity and focus remain stable through edits, sync refreshes, completion, and disclosure. Arrow navigation includes only visible tasks and loops at the ends. Whole-card dragging, touch holds, nesting, moving drop gaps, and the conditional top-level target remain available. The animation preference still controls task transitions. Quick capture and detail edits use the existing serialized storage, undo, and sync paths.

## Try it

Run `./scripts/bun run dev:solid --host 127.0.0.1 --port 5177`, then open `http://127.0.0.1:5177/calendar/`. The local origin has its own browser storage. Use quick capture or import a backup in Settings to populate it. Production at `guymichaely.com/calendar` is unchanged until this branch is merged to `main`.

The visual review used representative sample tasks and events in an isolated browser profile. No sample data is bundled in the app.

## Validation

The branch passed the existing 103 repository tests and 21 Solid tests, TypeScript checking, and a production build. Isolated browser checks covered quick capture, view scopes, autosave, calendar agendas, settings, mobile layouts and search, task completion and undo, stable title alignment and DOM identity, looping keyboard focus, mouse nesting, and touch drag/cancel. No browser console errors were reported.
