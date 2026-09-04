import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";

const root = path.resolve(import.meta.dirname, "..");
const source = (relativePath) => fs.readFileSync(path.join(root, relativePath), "utf8");

test("Svelte implementation uses runes for application and derived view state", () => {
  const app = source("svelte/src/App.svelte");
  const tasks = source("svelte/src/TasksView.svelte");
  const calendar = source("svelte/src/CalendarView.svelte");
  assert.match(app, /\$state/);
  assert.match(tasks, /\$derived/);
  assert.match(calendar, /\$derived/);
  assert.doesNotMatch(app + tasks + calendar, /use(State|Effect|Memo|Callback|Ref)/);
});

test("Svelte task cards retain live icon actions and roving focus behavior", () => {
  const card = source("svelte/src/TaskCard.svelte");
  const focus = source("svelte/src/task-focus.ts");
  assert.match(card, /TaskActionIcon action="sleepTomorrow"/);
  assert.match(card, /TaskActionIcon action="sleepIndefinite"/);
  assert.match(card, /TaskActionIcon action="customSleep"/);
  assert.match(card, /tabindex="-1"/);
  assert.match(card, /moveTaskFocus\(event\.key === "ArrowUp" \? -1 : 1/);
  assert.match(focus, /\[data-task-card="true"\]\[tabindex="0"\]/);
});

test("Svelte task availability presentation follows the vanilla view contract", () => {
  const card = source("svelte/src/TaskCard.svelte");
  const tasks = source("svelte/src/TasksView.svelte");
  const css = source("svelte/src/svelte.css");
  assert.match(card, /showAvailability/);
  assert.match(card, /Available \$\{friendlyWhen\(next, now\)\}/);
  assert.match(card, /!showAvailability && task\.availableFrom/);
  assert.match(tasks, /showAvailability=\{section\.id === "upcoming"\}/);
  assert.match(css, /\.availability-summary \{[\s\S]*color: var\(--accent-strong\);[\s\S]*font-size: 12px;[\s\S]*font-weight: 620;/);
  assert.match(css, /\.sleeping-task \.availability-summary \{ color: #c3b5e2; \}/);
});

test("Svelte calendar preserves vanilla projection and search-summary behavior", () => {
  const calendar = source("svelte/src/CalendarView.svelte");
  assert.match(calendar, /projectedTaskStart/);
  assert.match(calendar, /projectedStartBypassesSleep/);
  assert.match(calendar, /matching \$\{matchingPending\.length === 1 \? "task" : "tasks"\}/);
  assert.match(calendar, /Sleeping projections are shown differently/);
  assert.doesNotMatch(calendar, /Sleep ends:/);
  assert.doesNotMatch(calendar, /legend-dot sleep/);
});

test("Svelte shell follows vanilla navigation, menu geometry, and history wording", () => {
  const app = source("svelte/src/App.svelte");
  const io = source("svelte/src/app-io.ts");
  const css = source("svelte/src/svelte.css");
  assert.match(app, /Search calendar/);
  assert.match(app, /scrollIntoView\(\{ block: "start" \}\)/);
  assert.doesNotMatch(app, /Svelte preview/);
  assert.match(css, /\.svelte-menu > summary \{[\s\S]*display: grid;[\s\S]*place-items: center;/);
  assert.match(app, />Undo\{historyState\.undoLabel \? ` \$\{historyState\.undoLabel\}` : ""\}<\/button>/);
  assert.match(app, />Redo\{historyState\.redoLabel \? ` \$\{historyState\.redoLabel\}` : ""\}<\/button>/);
  assert.doesNotMatch(app, /Undo\{historyState\.undoLabel \? ` ·/);
  assert.match(io, /toast\(`Undo\$\{label \? ` \$\{label\}` : ""\}`\)/);
  assert.match(io, /toast\(`Redo\$\{label \? ` \$\{label\}` : ""\}`\)/);
  assert.doesNotMatch(io, /Undid|Redid/);
});

test("Svelte dialogs preserve dirty guards, attachment feedback, and toast exits", () => {
  const editor = source("svelte/src/ItemEditor.svelte");
  const sleep = source("svelte/src/SleepDialog.svelte");
  const shortcuts = source("svelte/src/KeyboardShortcutsDialog.svelte");
  const toast = source("svelte/src/ToastItem.svelte");
  assert.match(editor, /draggingAttachments \? "dragging"/);
  assert.match(editor, /ondragenter=/);
  assert.match(editor, /Discard your unsaved changes\?/);
  assert.match(sleep, /value !== initialValue && !window\.confirm/);
  assert.match(shortcuts, /Discard your unsaved changes\?/);
  assert.match(toast, /leaving \? " leaving"/);
  assert.match(toast, /window\.setTimeout\(\(\) => onDismiss\(toast\.id\), 140\)/);
});

test("Svelte Vite build targets the aggregate preview path", () => {
  const config = source("svelte/vite.config.ts");
  assert.match(config, /base: "\/calendar\/svelte\/"/);
  assert.match(config, /outDir: "\.\.\/site\/svelte"/);
});
