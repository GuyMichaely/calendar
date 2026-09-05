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

test("Solid task availability formatting follows vanilla section behavior", () => {
  const tasks = source("solid/src/TasksView.tsx");
  const display = source("solid/src/task-display.ts");
  assert.match(tasks, /taskCard\(row, section\.id === "upcoming"\)/);
  assert.match(tasks, /taskCard\(row, true\)/);
  assert.match(display, /if \(!showAvailability && task\.availableFrom\) values\.push\(`Starts /);
  assert.match(display, /if \(!showAvailability && sleep\.sleeping\)/);
  assert.match(display, /return next \? `Available \$\{friendlyWhen\(next, now\)\}` : ""/);
});

test("Solid dialogs protect dirty edits and preserve attachment and sleep feedback", () => {
  const app = source("solid/src/App.tsx");
  const editor = source("solid/src/ItemEditor.tsx");
  const shortcuts = source("solid/src/shortcuts.tsx");
  assert.match(editor, /draggingAttachments\(\) \? "dragging"/);
  assert.match(editor, /Discard your unsaved changes\?/);
  assert.match(editor, /Files are stored locally and sync when remote sync is configured\./);
  assert.match(app, /Choose a future sleep time/);
  assert.match(shortcuts, /Discard your unsaved changes\?/);
});

test("Solid shell keeps vanilla calendar search, today navigation, and menu wording", () => {
  const app = source("solid/src/App.tsx");
  assert.match(app, /placeholder=\{view\(\) === "calendar" \? "Search calendar" : "Search tasks"\}/);
  assert.match(app, /querySelector\('\[data-section="now"\]'\)\?\.scrollIntoView\(\{ block: "start" \}\)/);
  assert.match(app, /Undo\{historyState\(\)\.undoLabel \? ` \$\{historyState\(\)\.undoLabel\}` : ""\}/);
  assert.doesNotMatch(app, /solid-badge/);
});

test("Solid writes include the item snapshot they were based on", () => {
  const app = source("solid/src/App.tsx");
  assert.match(app, /await putItem\(next, task\);/);
  assert.match(app, /await putItem\(item, request\.item\);/);
});

test("Solid remote integration uses the serialized storage boundary and queues local writes", () => {
  const app = source("solid/src/App.tsx");
  const remote = source("solid/src/remote-sync.ts");
  assert.match(app, /storage: \{ readSnapshot: readSyncSnapshot, mergeSnapshot: mergeSyncSnapshot \}/);
  assert.match(app, /createRemoteSyncQueue/);
  assert.match(app, /Sign in with Google/);
  assert.match(app, /Sync now/);
  assert.match(app, /void requestRemoteSync\(\);/);
  assert.match(remote, /attachments\/\$\{encodeURIComponent\(attachment\.id\)\}/);
  assert.match(remote, /method: "HEAD"/);
  assert.match(remote, /method: "PUT"/);
});

test("Solid calendar omits sleep-end markers and Vite targets the root calendar path", () => {
  const calendar = source("solid/src/CalendarView.tsx");
  const vite = source("solid/vite.config.ts");
  assert.doesNotMatch(calendar, /Sleep ends:/);
  assert.doesNotMatch(calendar, /legend-dot sleep/);
  assert.match(calendar, /\$\{count\} matching \$\{noun\}/);
  assert.match(calendar, /Untitled event/);
  assert.match(calendar, /Sleeping projections are shown differently\./);
  assert.match(vite, /base: "\/calendar\/"/);
  assert.match(vite, /outDir: "\.\.\/site\/solid"/);
});

test("Solid queued toasts animate out before removal", () => {
  const toasts = source("solid/src/ToastStack.tsx");
  assert.match(toasts, /leaving\(\) \? " leaving"/);
  assert.match(toasts, /window\.setTimeout\(\(\) => props\.onDismiss\(props\.toast\.id\), 140\)/);
});
