# Calendar

A personal calendar and task planner built around the distinction between an open task and a task that is actionable right now.

## Current implementation

The first slice is a static web app that runs entirely in the browser:

- task and event creation/editing;
- IndexedDB persistence;
- task states: open, waiting, completed, canceled;
- available-from, due, latest-start, and wake/review times;
- recurring action windows for persistent tasks (for example, office hours);
- task filters including Can do now, Waiting, Due soon, Ongoing, All open, and Completed;
- text/tag/attachment-name search;
- local file attachments stored in IndexedDB;
- month calendar rendering task timing markers and events;
- JSON backup/export and import, including attachment contents;
- responsive layout for desktop and Android-sized screens;
- service-worker shell caching for basic offline use.

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
