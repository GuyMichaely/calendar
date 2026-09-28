# Timing-based Tasks iteration

Worktree: `calendar-prototype`, branch `prototype`. The original checkout is on `prototype2` and is not changed by this work.

Run `./scripts/bun run dev:solid --host 127.0.0.1 --port 5181 --strictPort` and open `/calendar/`.

## Browser storage

All localStorage/sessionStorage keys and both IndexedDB database names have the `calendar-todo-prototype:` prefix. The preview does not read or migrate another build's data or inherit its configured sync URL. A user can import a backup into this separate dataset. Explicitly configuring a remote server still enables real sync; the namespace isolates browser storage, not server accounts.

## Implemented rules

The default Tasks view projects each active task into exactly one section:

1. Needs Attention: hard deadline today or overdue, even if not currently actionable. Availability/sleep explanations stay visible.
2. Open Now: an open availability window. Earlier closing times sort first, then manual priority.
3. Today: an actionable task whose start date is today.
4. Upcoming: future starts, closed windows, and respected sleep. A start/window later today is labelled Later today.
5. Anytime: other actionable tasks, including ongoing research and unrestricted work.

Future-start and closed-window tasks later today are relevant today but remain in Upcoming until actionable. An unrestricted task that started yesterday becomes Anytime unless its deadline makes it urgent. Dormant dependents do not enter the timing view until started. Hide sleeping takes precedence over display categories; Respect sleep changes actionability, not the visibility of a hard deadline.

The projection changes no stored fields when time passes. Reordering within a section changes the existing manual priority and preserves group/parent membership. Open Now permits manual reordering only among equal closing times; dragging into another timing bucket cannot change timing rules. Dropping on the middle of a task still nests it. Groups remains available as the spatial organization view, with the existing editor, completion, undo, and hierarchy actions.

## Next iteration

Recurrence and outcomes are not yet implemented. Add fixed daily/weekly schedules, independent dated outstanding occurrences versus latest-only rollover, and explicit outcome effects (complete occurrence, finish series, activate a dependent after a date). Those changes need a deliberate synced schema and undo design rather than hiding occurrence state in browser preferences. Interval-after-completion recurrence is out of scope for now. The editor's Timing disclosure should be revisited with those controls.

## Verification

182 tests, TypeScript, and production build pass. Isolated desktop/mobile browser checks verify classification, unique membership, closing-time order, priority dragging across organizational groups, reload persistence, completion/undo, and Tasks/Groups navigation at 390 and 320 pixels. The browser also contains sentinel unprefixed preferences and a separate IndexedDB database, verifying that the preview uses its own storage and ignores the other build's sync configuration. No production data is used by the checks.

## Demo data

Use **Load demo tasks** in the Tasks toolbar or Settings → Data. The examples are dated relative to loading time and cover every timing section, manual priority, groups, subtasks, a dormant dependent, completed work, and notes. They use actual task records and normal persistence. Loading preserves existing records, uses one undo step, and is disabled once examples exist or while a remote sync server is configured. Undo the load to remove the entire example set.

Demo verification: 183 tests plus typecheck/build pass. Browser checks confirm each section is populated, existing tasks are retained, one undo removes the examples, loading cannot be duplicated, examples survive reload, and the mobile layout fits.

## Preview clock

Expand **Preview clock** above the board to choose a local date/time or step by one hour/day. **Use real time** resets it. The simulated time is fixed until changed and survives reload in this tab's namespaced sessionStorage. A day step preserves local clock time across DST changes. The control changes Tasks/Groups placement only; it never rewrites task records or changes the calendar view, and editing/completion timestamps still use real time. Loading demos uses the current preview date.

Clock verification: 185 tests plus typecheck/build pass. Desktop/mobile browser checks cover the picker, steps, window closures, overdue/start/sleep projections, reload, reset, and unchanged persisted records.
