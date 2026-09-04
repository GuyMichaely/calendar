import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";

const root = path.resolve(import.meta.dirname, "..");
const source = (relativePath) => fs.readFileSync(path.join(root, relativePath), "utf8");

test("Solid frontend uses fine-grained reactive primitives rather than React-style hooks", () => {
  const app = source("solid/src/App.tsx");
  const tasks = source("solid/src/TasksView.tsx");
  assert.match(app, /createSignal/);
  assert.match(tasks, /createMemo/);
  assert.doesNotMatch(app, /useState|useEffect|useMemo|useCallback/);
  assert.doesNotMatch(tasks, /useState|useEffect|useMemo|useCallback/);
});

test("Solid task cards retain icon actions, semantic hotkeys, and roving focus", () => {
  const tasks = source("solid/src/TasksView.tsx");
  const shortcuts = source("solid/src/shortcuts.tsx");
  assert.match(tasks, /TaskActionIcon action="sleepTomorrow"/);
  assert.match(tasks, /TaskActionIcon action="sleepIndefinite"/);
  assert.match(tasks, /TaskActionIcon action="customSleep"/);
  assert.match(tasks, /moveTaskFocus\(event\.key === "ArrowUp" \? -1 : 1/);
  assert.match(tasks, /actionForKey\(normalizeEventKey\(event\), props\.shortcuts\)/);
  assert.match(shortcuts, /function SleepTomorrowIcon/);
  assert.match(shortcuts, /function SleepIndefiniteIcon/);
  assert.match(shortcuts, /function CustomSleepIcon/);
});

test("Solid dialogs protect dirty edits and preserve attachment drag feedback", () => {
  const editor = source("solid/src/ItemEditor.tsx");
  const shortcuts = source("solid/src/shortcuts.tsx");
  assert.match(editor, /draggingAttachments\(\) \? "dragging"/);
  assert.match(editor, /Discard your unsaved changes\?/);
  assert.match(shortcuts, /Discard your unsaved changes\?/);
});

test("Solid calendar omits sleep-end markers and Vite targets the Solid preview path", () => {
  const calendar = source("solid/src/CalendarView.tsx");
  const vite = source("solid/vite.config.ts");
  assert.doesNotMatch(calendar, /Sleep ends:/);
  assert.doesNotMatch(calendar, /legend-dot sleep/);
  assert.match(vite, /base: "\/calendar\/solid\/"/);
  assert.match(vite, /outDir: "\.\.\/site\/solid"/);
});

test("Solid queued toasts animate out before removal", () => {
  const toasts = source("solid/src/ToastStack.tsx");
  assert.match(toasts, /leaving\(\) \? " leaving"/);
  assert.match(toasts, /window\.setTimeout\(\(\) => props\.onDismiss\(props\.toast\.id\), 140\)/);
});
