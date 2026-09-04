import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";

const root = path.resolve(import.meta.dirname, "..");

function source(relativePath) {
  return fs.readFileSync(path.join(root, relativePath), "utf8");
}

test("framework task cards retain live icon actions and roving focus behavior", () => {
  const tasks = source("framework/src/TasksView.tsx");
  const shortcuts = source("framework/src/shortcuts.tsx");

  assert.match(tasks, /TaskActionIcon action="sleepTomorrow"/);
  assert.match(tasks, /TaskActionIcon action="sleepIndefinite"/);
  assert.match(tasks, /TaskActionIcon action="customSleep"/);
  assert.match(tasks, /tabIndex=\{-1\}/);
  assert.match(tasks, /rememberCard\(event\.currentTarget\)/);
  assert.match(tasks, /moveTaskFocus\(event\.key === "ArrowUp" \? -1 : 1/);

  assert.match(shortcuts, /function SleepTomorrowIcon/);
  assert.match(shortcuts, /function SleepIndefiniteIcon/);
  assert.match(shortcuts, /function CustomSleepIcon/);
  assert.match(shortcuts, /shortcutTooltip\(props\.action, props\.shortcuts\)/);
});

test("framework calendar omits the live UI's removed sleep-end markers", () => {
  const calendar = source("framework/src/CalendarView.tsx");
  assert.doesNotMatch(calendar, /Sleep ends:/);
  assert.doesNotMatch(calendar, /legend-dot sleep/);
});

test("framework editor keeps attachment drag feedback and guarded shortcut dismissal", () => {
  const editor = source("framework/src/ItemEditor.tsx");
  const shortcuts = source("framework/src/shortcuts.tsx");

  assert.match(editor, /draggingAttachments \? "dragging"/);
  assert.match(editor, /onDragEnter=/);
  assert.match(editor, /onDragLeave=/);
  assert.match(shortcuts, /Discard your unsaved changes\?/);
  assert.match(shortcuts, /<DialogShell labelledBy="shortcut-title"/);
});
