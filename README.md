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
- one-click sleep until the next calendar day;
- conversion between a finite sleep date and an available-from wait date;
- task sections for Can do now, Upcoming, Waiting, Sleeping, All open, and Completed;
- rolling 1/7/30-day upcoming horizons or calendar-boundary day/week/month horizons;
- month calendar rendering task timing markers, events, and sleep wake times;
- a calendar-only toggle that either respects sleep when projecting task opportunities or ignores it while marking sleep-bypassed projections;
- text/tag/attachment-name search;
- local file attachments stored in IndexedDB;
- JSON backup/export and import, including attachment contents;
- a dark interface with responsive desktop and Android-sized layouts;
- service-worker shell caching for basic offline use.

Waiting is derived from real availability constraints. Sleep does not change a task's underlying actionability. It only controls whether the task is surfaced to the user and, when enabled in the calendar, whether sleep is treated as an additional delay while projecting the next work opportunity.

There is deliberately no cloud backend yet. Data is local to each browser/device. The storage boundary is isolated so a cloud-backed implementation can replace or supplement IndexedDB later.

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
