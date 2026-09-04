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
- keyboard task navigation: click or arrow-focus task cards, use Up/Down between visible tasks, and Tab through a focused card's controls;
- configurable task hotkeys for completion, sleep until tomorrow, indefinite sleep, and custom sleep;
- icon sleep actions with accessible labels/tooltips;
- month calendar rendering one projected start marker per task, plus distinct latest-start, due, and sleep-wake markers;
- a calendar-only toggle that moves each projected task start according to whether sleep is respected or ignored;
- text/tag/attachment-name search;
- local file attachments stored in IndexedDB;
- JSON backup/export and import, including attachment contents;
- session undo/redo for item mutations, available from the menu and via Ctrl/Cmd+Z, Ctrl/Cmd+Shift+Z, or Ctrl+Y;
- a top-left hamburger menu anchored to its trigger;
- a dark interface with responsive desktop and Android-sized layouts;
- service-worker shell caching for basic offline use.

Waiting is derived from real availability constraints. Sleep does not change a task's underlying actionability. It only controls whether the task is surfaced to the user and, when enabled in the calendar, whether sleep is treated as an additional delay while projecting the next work opportunity.

There is deliberately no cloud backend yet. Data is local to each browser/device. The storage boundary is isolated so a cloud-backed implementation can replace or supplement IndexedDB later.

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

GitHub Actions deploys the `site/` directory to GitHub Pages. All browser assets use relative URLs, so the app works when GitHub serves the project under `/calendar/` and does not depend on that pathname being hard-coded in the application.
