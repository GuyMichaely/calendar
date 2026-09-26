# Interface redesign

The redesign provides a quieter planning workspace while preserving the Automerge document and native sync protocol. Authentication also supports returning to the explicitly allowed local preview after Google sign-in.

## The design

- **Tasks** brings together actionable tasks and Upcoming, including sleeping tasks and tasks with no known next action window. **Completed** remains separate. Turning off the horizon shows every other open task without changing the Upcoming label.
- A persistent desktop sidebar separates working on tasks from planning in the calendar. On phones, bottom navigation keeps creation and settings within reach. Search expands when needed.
- Quick capture adds a task with a title and Enter. The detail editor remains available for dates, notes, subtasks, and attachments.
- Task rows use less visual framing. Hierarchy, completion, notes, and two direct actions take priority. The sleep dialog offers tomorrow, indefinitely, or a specific date; existing keyboard shortcuts still work.
- A selected-day agenda sits beside the desktop month and below it on mobile. Phones use date indicators rather than tiny, truncated event titles; the agenda exposes every entry, including those behind “more.”
- Item details open beside the workspace in a single-scroll panel. The title is editable, dates precede notes, working hours are expandable, and subtasks and attachments have clear sections.
- A single stylesheet defines the dark green surfaces, charcoal navigation, warm orange accents, and responsive layouts. It replaces seven overlapping stylesheets. There are no new packages, fonts, remote assets, or services.

## Interaction contracts

Task identity and focus remain stable through edits, sync refreshes, completion, and disclosure. Arrow navigation includes only visible tasks and loops at the ends. Whole-card dragging, touch holds, nesting, moving drop gaps, and the conditional top-level target remain available. The animation preference still controls task transitions. Quick capture and detail edits use the existing serialized storage, undo, and sync paths.

## Sleep and ordering

Respect sleep and Hide sleeping tasks are shared between Tasks and Calendar, with controls above each view and in Settings → Tasks. Ignoring sleep restores the task's ordinary availability, including its recurring working hours. Hiding sleeping tasks removes them from lists, calendar markers, and counts independently of the respect setting. These are browser preferences; they do not change task data.

Sleeping tasks join Upcoming with a moon indicator, ordered alongside other tasks. The default is Can start, then due; respecting sleep uses the later of the start and wake time. The alternative date order uses the later of Can start and due before applying wake time. Creation date (oldest first) breaks date ties before title. A due date changes ordering, not when a task becomes workable. The horizon uses the next actionable time; indefinite sleepers and tasks without a known next action window remain visible even with a horizon. Sorting is within siblings so children stay with their parent. Dragging before/after another task switches to Manual order; nesting alone keeps the current sort.

A task with a due date cannot be put to sleep past it or indefinitely. The editor, shortcuts, sleep dialog, imports, and local storage edits enforce this, including a stale editor whose saved due date has since changed. Existing task history and remote sync remain intact.

## Try it

Run `./scripts/bun run dev:solid --host 127.0.0.1 --port 5177`, then open `http://127.0.0.1:5177/calendar/`. The local origin has its own browser storage. Use quick capture or import a backup in Settings to populate it. Production at `guymichaely.com/calendar` is published from `main` after the verification workflow succeeds. The preceding interface remains available in Git history.

The visual review used representative sample tasks and events in an isolated browser profile. No sample data is bundled in the app.

## Validation

The branch passed the existing 103 repository tests and 21 Solid tests, TypeScript checking, and a production build. Isolated browser checks covered quick capture, view scopes, autosave, calendar agendas, settings, mobile layouts and search, task completion and undo, stable title alignment and DOM identity, looping keyboard focus, mouse nesting, and touch drag/cancel. No browser console errors were reported.

Sleep follow-up: all 104 repository tests and 32 Solid tests pass, together with TypeScript and production build checks. Isolated desktop/mobile browser checks verify shared preferences and reload persistence, integrated sleep ordering, hiding from both views, nested-parent visibility, touch toggles, and sleep/deadline validation.

The calendar uses a compact toolbar, reduced outer padding, and only the weeks needed for the displayed month. Tasks are excluded from browser scroll anchoring so changing sleep visibility moves rows rather than the page heading.

Navigation/density follow-up: 107 repository tests and 35 Solid tests pass with TypeScript and production build checks. Browser checks cover desktop/mobile scroll offsets of 100, 650, and 1500 pixels with animations on and off, unchanged heading/capture positions through both sleep-toggle directions, and four-, five-, and six-week months.

Tasks use a compact heading with inline counts, narrower outer margins, closer controls and sections, and shorter rows. Notes remain visible by default; Compact mode additionally hides notes, tags, and attachment previews. Desktop and mobile browser checks cover scrolling through sleep changes, navigation, and widths from 320 to 1280 pixels.

## Prototype 1: task details beside the list

Published at `guymichaely.com/calendar/prototype1/`. At 1180 pixels and wider, the tasks view keeps the list on the left and the selected task's editor on the right, following the Branch prototype. The selection is part of the address (`#tasks/<id>`), so reload, back, and forward keep it; subtasks and the parent path navigate the same way. The editor saves before another task opens and when it is replaced, reloads when the task changes elsewhere while idle, and adds subtasks inline. Narrower screens and the calendar keep the drawer. Editors now record their initial values as soon as they open, so an edit made before the first animation frame is saved rather than absorbed into the baseline.
