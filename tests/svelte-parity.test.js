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

test("Svelte calendar preserves sleep projection contract without sleep-end markers", () => {
  const calendar = source("svelte/src/CalendarView.svelte");
  assert.match(calendar, /projectedTaskStart/);
  assert.match(calendar, /projectedStartBypassesSleep/);
  assert.doesNotMatch(calendar, /Sleep ends:/);
  assert.doesNotMatch(calendar, /legend-dot sleep/);
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
