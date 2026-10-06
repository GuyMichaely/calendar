# Calendar

A personal calendar and task planner built around the distinction between an open task and a task that is actionable right now.

## Current implementation

`main` is the canonical application development branch. The selected frontend is SolidJS + TypeScript + Vite.

The app supports task and event editing, recurring action windows, sleep, availability and due constraints, search, tags, attachments, compact task views, calendar projection, JSON backup/import, local undo/redo, and optional authenticated remote synchronization.

Waiting is derived from real availability constraints. Sleep is a separate user-imposed suppression layer. It controls whether a task is surfaced and whether sleep delays its projected calendar opportunity.

## Local data and Automerge

The application stores one Automerge document in the `calendar-automerge` IndexedDB database. That document is the canonical local calendar/task state and the unit exchanged by remote sync.

Calendar item updates are represented as fine-grained Automerge changes where practical. Title and notes use collaborative text operations. Tags, attachment metadata, task fields, and tombstones have separate operations. Deletion uses an application-level `deletedAt` tombstone so an offline edit cannot accidentally resurrect a deleted item.

Attachment bytes are not stored in the Automerge document. Attachment metadata participates in the CRDT. New attachment bytes are uploaded to the configured backend before their metadata is persisted locally, and remote attachment bytes are fetched on demand when opened.

JSON backup/export is metadata-only for attachments. A backup containing embedded legacy attachment bytes is rejected rather than silently discarding those bytes.

Undo/redo history is stored separately in `calendar-history` IndexedDB and is session-scoped. It is never synchronized. Undo and redo are applied as new CRDT changes rather than replacing the synchronized document wholesale.

## Where it runs, and sync

The calendar is one Cloudflare Worker at <https://guymichaely.com/calendar/> ([backend/README.md](backend/README.md)); `calendar.guymichaely.com` redirects there, path and all. It serves the built app as static files and runs the sync server under `/calendar/sync`. Cloudflare Access guards that, so only your Cloudflare sign-in reaches it; the app itself is public and works without signing in, keeping everything in the browser.

- `backend/worker.js`: the Worker and its Durable Object, which holds the one calendar (SQLite) and announces changes over a live WebSocket; attachment bytes are in R2.
- `backend/sync/http.js`: `POST /sync`, one round of Automerge's sync protocol, over an atomic document-store contract.
- `backend/sync/attachments-http.js`: attachment bytes at `/calendar/sync/attachments/:id`.
- `sync/client.js`: the device side of the sync protocol.
- `solid/src/cloud-sync.ts`: when to sync, through [@guymichaely/app-sync](https://github.com/GuyMichaely/app-sync): after edits, on opening and coming back, as the live connection hears other devices' changes, and on Sync now; sign-in; and attachment transfer.

## Local development

Use the repository wrapper on Linux or macOS. It downloads the exact Bun version from `.bun-version`, verifies its checked-in SHA-256 checksum, and installs it under `.local/bin`. Dependencies, caches, and temporary files stay in this checkout. It does not install Node, npm, Vite, TypeScript, or Bun globally or edit shell profiles.

```bash
./scripts/bun install --frozen-lockfile
./scripts/bun run dev:solid
```

Open <http://localhost:5173/calendar/>. A copy that isn't syncing starts with sample tasks. To try sync, build once and run the Worker locally (no Access in front, so Sign in goes straight through); the Vite server forwards `/calendar/sync` to it:

```bash
./scripts/bun run build:solid
./scripts/bun run dev:worker
```

Run all checks:

```bash
./scripts/bun run check
./scripts/bun scripts/smoke-worker.js
```

`check` runs the backend/domain/storage tests, Solid tests, typechecking, and the production build; the smoke test runs the built Worker locally and syncs two devices through it. To deliberately update dependencies, edit `package.json`, run `./scripts/bun install`, and commit `bun.lock`. A Bun upgrade must update `.bun-version`, `package.json`, and the official release hashes in `scripts/bun-checksums.txt` together. Local development and CI read the same `.bun-version`.

## Deployment

`.github/workflows/check.yml` runs the checks and the Worker smoke test on every push and pull request. Cloudflare Workers Builds deploys the Worker, with the app, from the `prototype2` branch (see [backend/README.md](backend/README.md)). The Durable Object and R2 bucket keep the calendar across deployments.

## Saving, syncing, and backups

Valid item edits autosave locally after 800 ms of inactivity. Closing the editor flushes pending edits; incomplete fields or storage/upload errors remain visible instead of silently dropping changes. The open editor retains its Automerge editing branch so subsequent autosaves preserve concurrent remote changes. Remote changes appear in the task/calendar views after sync; reopen an editor to see changes made elsewhere.

Each device chooses when it syncs (Settings → Data): **Automatically** (after edits, on opening and coming back, and as soon as another device changes something, through the live connection, with a five-minute backstop), **When I edit**, or **Manually**. The top bar's status distinguishes local saves, sync activity, an expired sign-in, being offline, and errors.

Settings → Data has sign-in and sync, and backups. The app keeps an offline copy of itself (`solid/sw.js`, a service worker the build fills with its file list): it opens from that copy, online or not, checks for a newer version in the background, and downloads only the files a deploy changed, used from the next launch. Import previews new/matching item counts, updates matching IDs, retains items absent from the file, and supports undo. A JSON backup contains item values and attachment references; it excludes attachment files and CRDT history. Full server backups must include both the calendar document storage and attachment blobs (Durable Object storage and R2 in production).

Server code lives under backend/. The sync/ directory holds the shared Automerge model and browser protocol client. Obsolete one-time migrations have been removed; previous versions remain in Git.

# User added to do list; ignore if you are an agent
- have a view for the calendar and on the to do list to filter out what doesn't have a due date today/this week/this month
- have some concept (i need to specify a way to input this as a user) to show task duration. e.g. if i want to show that an event is taking place over a period of a few days i'll want it to span those days on the calendar probably. not sure if i want ongoing tasks with no due date to participate in this
- copy microsoft's "plan" feature where tasks can belond to a plan and the plan can have buckets composed of tasks. want to also make sure that the user can just add tasks without an associated plan.  basically a glorified lists functionality, maybe just stick to simple lists
- make it so using the arrow keys to navigate through item focus loops around when pressing up on top item or down on bottom item
- what's the "saved on this device" status for? 
- decide what to do about displaying sleeping/waiting tasks as descendents of open tasks
- search matches differently in the two views: calendar search (`textMatches` in `site/domain.js`) matches title, notes, tags, and attachment names, but task board search (its own `textMatches` in `solid/src/GroupsView.tsx`) skips attachment names. Decide whether the board should also match attachment names, then have both views use one function
- decide how to deal with dependent tasks in task view; have an expand/collapse arrow?
- sleeping and waiting dates don't display year. don't display year if it's the current year, otherwise display year 

* drag and drop is still a little buggy? looks like you didn't implement the thing where columns don't need to be chased, please do that
* i see there's the ability to select all groups of a column but i can't seem to drag them together
* when dragging a group to where it doesn't make sense to show a drop highlight (i.e. dragging to the immediate left; if we were to show a drop highlight there we'd be dropping the group to its immediate left, which is to say nowwhere. we have to drag it past the left 6th of the column to its left before a meaningful reorder can be made), can we make the droppable column immediately active on hover rather than requiring moving past the 6th?
    * there's an exception to the above logic about not making sense to show drop highlight; if i'm dragging a subgroup, i'm dragging it out of its parent. it is tenable that i would want to drag a subgroup to the immediate left of its current column, meaning that the subgroup would retain the same column but the parent, all other groups in the column, and all columns to the right would move a column to the right. so in that case we shouldn't do that immediate active on hover so that we can still drop in to a new column
* looks like you didn't implement dragging tasks by the row like i asked
* the inline description line cutoff still isn't fixed
* hitting the red X/Esc when red X is present doesn't show the error dialogue anymore, i want it to show once and once it's visible another Esc or X click reverts and discards
* "Keep editing" should instead say revert and revert task state back to the last valid state (should probably do so in consideration of debouncing, e.g. if i start with title "title" and backspace until gone with each backspace less than .8 seconds from the last, the last valid state would be the initial state)
* get rid of the dialogue that confirms whether you want to delete a group/task
* make the drag handle on sub and dependent tasks in the task editor more obvious
* what does the color left of the dependent and subtasks in the editor indicate?