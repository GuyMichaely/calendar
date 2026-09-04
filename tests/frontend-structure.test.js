import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";

const root = path.resolve(import.meta.dirname, "..");
const site = path.join(root, "site");

function walkJs(dir) {
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const file = path.join(dir, entry.name);
    if (entry.isDirectory()) return walkJs(file);
    return entry.isFile() && entry.name.endsWith(".js") ? [file] : [];
  });
}

test("all browser JavaScript parses", () => {
  for (const file of walkJs(site)) {
    execFileSync(process.execPath, ["--check", file], { stdio: "pipe" });
  }
});

test("index has one application module entry point", () => {
  const html = fs.readFileSync(path.join(site, "index.html"), "utf8");
  const moduleScripts = [...html.matchAll(/<script\s+type="module"\s+src="([^"]+)"/g)].map((match) => match[1]);
  assert.deepEqual(moduleScripts, ["./app.js"]);
  assert.match(html, /href="\.\/keyboard\.css"/);
});

test("service-worker shell only references files that exist", () => {
  const shell = fs.readFileSync(path.join(site, "sw-shell.js"), "utf8");
  const shellMatch = shell.match(/self\.CALENDAR_SHELL = \[([\s\S]*?)\];/);
  assert.ok(shellMatch, "service-worker shell manifest should define CALENDAR_SHELL");
  const entries = [...shellMatch[1].matchAll(/"(\.\/[^\"]*)"/g)].map((match) => match[1]);
  for (const entry of entries) {
    if (entry === "./") continue;
    assert.ok(fs.existsSync(path.join(site, entry.slice(2))), `missing shell asset: ${entry}`);
  }
});

test("service-worker runtime is shared and cache ownership is scope-isolated", () => {
  const sw = fs.readFileSync(path.join(site, "sw.js"), "utf8");
  assert.match(sw, /importScripts\("\.\/sw-shell\.js"\)/);
  assert.match(sw, /new URL\(self\.registration\.scope\)\.pathname/);
  assert.match(sw, /key\.startsWith\(`\$\{CACHE_NAMESPACE\}:`\)/);
  assert.match(sw, /caches\.open\(CACHE\)/);
  assert.match(sw, /cache\.match\(event\.request\)/);
  assert.doesNotMatch(sw, /keys\.filter\(\(key\) => key !== CACHE\)/);
  assert.doesNotMatch(sw, /caches\.match\(event\.request\)/);
});

test("removed DOM patch modules stay out of the runtime", () => {
  const removed = [
    "editor-behavior.js",
    "calendar-projection.js",
    "calendar-ui.js",
    "modal-events.js",
    "task-enhancements.js",
    "toast-history.js",
  ];
  for (const name of removed) assert.equal(fs.existsSync(path.join(site, name)), false, `${name} should remain removed`);

  const app = fs.readFileSync(path.join(site, "app.js"), "utf8");
  assert.match(app, /createTasksView/);
  assert.match(app, /createCalendarView/);
  assert.match(app, /createEditor/);
  assert.match(app, /createKeyboardController/);
});

test("active frontend controllers do not depend on DOM mutation observers", () => {
  const controllerFiles = [
    "app.js",
    "editor.js",
    "keyboard.js",
    "views/tasks-view.js",
    "views/calendar-view.js",
  ];
  for (const name of controllerFiles) {
    const source = fs.readFileSync(path.join(site, name), "utf8");
    assert.doesNotMatch(source, /\bMutationObserver\b/, `${name} should use explicit render/init hooks`);
  }
});

test("task view owns task action markup while keyboard routes semantic actions", () => {
  const app = fs.readFileSync(path.join(site, "app.js"), "utf8");
  const keyboard = fs.readFileSync(path.join(site, "keyboard.js"), "utf8");
  const tasks = fs.readFileSync(path.join(site, "views", "tasks-view.js"), "utf8");

  assert.match(tasks, /class="task-action-icon"/);
  assert.match(tasks, /data-action="sleep-indefinite"/);
  assert.match(tasks, /ACTION_ICONS\.sleepTomorrow/);
  assert.match(tasks, /ACTION_ICONS\.sleepIndefinite/);
  assert.match(tasks, /ACTION_ICONS\.customSleep/);

  assert.match(keyboard, /onTaskAction\?\.\(\{ action, id \}\)/);
  assert.doesNotMatch(keyboard, /task-action-icon/);
  assert.doesNotMatch(keyboard, /querySelector\([^\n]*data-action/);
  assert.doesNotMatch(keyboard, /\.click\(\)/);

  assert.match(app, /action === "sleep-indefinite"/);
  assert.match(app, /shortcutHints: keyboard\.getShortcutHints\(\)/);
  assert.match(app, /onRendered: keyboard\.syncTaskFocus/);
  assert.doesNotMatch(app, /keyboard\.enhance/);
});

test("task title links expose their edit action", () => {
  const source = fs.readFileSync(path.join(site, "views/tasks-view.js"), "utf8");
  assert.match(source, /const editLabel = `Edit \$\{title\}`/);
  assert.match(source, /aria-label="\$\{escapeHtml\(editLabel\)\}"/);
  assert.match(source, /title="\$\{escapeHtml\(editLabel\)\}"/);
});
