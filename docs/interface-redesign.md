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

## Groups replace the task list

The Groups view replaces the Tasks view. Groups are items of kind `group` with an optional parent group and a manual `sortOrder`, so they form a strict tree; a group without a parent is top level. Top-level tasks carry an optional `groupId`; subtasks appear under their parent task. Top-level groups are board columns, ordered with the arrow buttons; nested groups stack inside their column and can be moved under another group from the options menu. Ungrouped tasks appear in the "No group" column. Deleting a group moves its tasks and subgroups to its parent in one undo step. Completed tasks are hidden unless "Show completed" is on. Storage rejects group cycles, non-group parents, and task group IDs that point at non-groups; backups include groups.

Top-level groups store a `boardColumn` and are ordered within it, so several can share a column; dragging a group's handle moves it between groups in a column or into a new column. The built-in Available, Upcoming, Sleeping, and No group sections move the same way. They are stored as groups with fixed IDs and a `builtin` field only once first moved, hold no tasks, and are excluded from pickers and the group tree.

This is an MVP. The keyboard-shortcut and animation settings still exist but no longer act on the board, and the stylesheet still contains rules for the removed task list.

## Dependent tasks

A dependent task is a prepared next step for another task (`dependentOf`). It stays dormant — out of groups, the built-in lists, and the calendar — and shows dimmed in a "Dependent tasks" section under its parent task until started. Each of its dates is fixed or a number of days after starting (`relativeDates`); starting it fixes those dates from that moment, clears `dependentOf`, and leaves it a normal task in its group (by default its parent task's group). "Start & complete" also completes the parent task in the same undo step, and checking off a task with unstarted dependent tasks offers to start one. Unstarted dependent tasks of a completed task are hidden with it, and deleting a task deletes them. The calendar's "Show dependent tasks" toggle draws them as dashed what-if entries, as if started on the parent task's due date (else its latest start, else today), following chains.

## Today replaces the board (prototype2)

The Today view puts every open task in exactly one section, by the first rule that fits: **Firm** (has a due date and is within its Firm-from lead time, 24 hours by default; overdue first), **Closing today** (its window is open now, soonest close first), **Opens later today**, **Upcoming** (can't start yet, or its window doesn't open today), else **Available**. **Completed** is always listed, collapsed at first. The logic is `solid/src/today.ts`.

- **Windows** are named items (`kind: "window"`: days, start, end, local time) managed in Settings → Windows. A task references one by `windowId`; editing the window moves every task using it. Legacy inline working hours still count until the task picks a named window. The calendar reads a task's window as its working hours.
- **Firm from** is a lead time before the due date (`warnHours`, 1 hour to 1 week; a legacy exact `warnAt` still counts). The field is always shown, disabled without a due date, so setting one doesn't move the rest of the form.
- **Push down** replaces sleep and Anytime: the task stays in its section, dimmed at the bottom, until the optional date, or until lifted when there's none. Legacy sleep reads as pushed down and is converted when the task is next saved. **Compact** folds each run of pushed-down sibling tasks into one "N pushed down" row that opens in place.
- **Containers**: a task with open subtasks isn't placed by its own timing; it shows only as a header above its subtasks, and its due date (with its Firm-from lead), can-start date, window, and push-down pass down to them for placement. Checking a container off finishes the family: its subtasks keep their own stored state but count as done and move to Completed with it. Finishing a container's last open subtask finishes the container, up the tree; a new, reopened, or moved-in subtask reopens it (ordinary edits don't), and imports store tasks as they are.
- **Subtasks** show one of two ways, chosen in the Today header for the whole view (a per-browser preference). **Spread out** places each subtask by its own (inherited) timing under headers for its containers. **Keep together** shows each family once, in the most urgent section any of its open tasks belongs to; the family's other tasks are dimmed but still checkable, and subtasks with due dates come first.
- **Finished subtasks of an open task** go with it rather than to Completed: folded into "+N completed", or dimmed in place once you click that or choose Show completed subtasks from its ⋮ menu (stored on the task as `completedSubtasks`). Finished rows show a ticked checkbox; unticking reopens the task, or, for a task done only through a finished container, reopens that container and with it the family.
- **Motion**: completing, reopening, pushing down, or lifting a task from its row slides every moved row from its old place to its new one; a row that ends up folded away (a collapsed section, "+N completed", a pushed-down run) flies into the row that holds it. The animations setting turns this off.
- Layout switches in the top bar (for comparing designs) set groups to row labels or headings, and the sections to one list or side-by-side columns. Groups are managed in Settings → Groups; a filter shows one group.
- **Pretend time** (the clock in the top bar) shifts what the lists, calendar, and task details treat as now by an offset kept in this browser; the clock keeps running from the chosen moment, and the clock stays highlighted while it's on (× returns to real time). Saved timestamps stay real; dates chosen while pretending (such as pushing down until tomorrow) count from the pretend time.
- If the stored document can't be read, the app offers to import a backup or start fresh, downloading the unreadable bytes first.
- A local development copy with no sync server starts with sample tasks (`solid/src/demo-data.ts`), and Settings → Data can add or remove a "Sample: subtasks" group anywhere.

The board (`GroupsView.tsx`) is no longer shown but remains in the tree. Repeating tasks, check-ins, and follow-up triggers are the next slice.
