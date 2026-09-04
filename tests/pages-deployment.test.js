import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";

const root = path.resolve(import.meta.dirname, "..");

function readShell(file) {
  const source = fs.readFileSync(file, "utf8");
  const match = source.match(/^self\.CALENDAR_SHELL = (\[[\s\S]*\]);\s*$/);
  assert.ok(match, `invalid generated shell manifest: ${file}`);
  return JSON.parse(match[1]);
}

test("Pages assembly nests preview apps and generates per-source service-worker shells", () => {
  const temp = fs.mkdtempSync(path.join(os.tmpdir(), "calendar-pages-"));
  const rootSite = path.join(temp, "root");
  const vanillaSite = path.join(temp, "vanilla-source");
  const frameworkSite = path.join(temp, "framework-source");
  const output = path.join(temp, "output");

  for (const [directory, label, withServiceWorker] of [
    [rootSite, "root", true],
    [vanillaSite, "vanilla", true],
    [frameworkSite, "framework", false],
  ]) {
    fs.mkdirSync(directory, { recursive: true });
    fs.writeFileSync(path.join(directory, "index.html"), label);
    fs.writeFileSync(path.join(directory, `${label}.txt`), label);
    if (withServiceWorker) fs.writeFileSync(path.join(directory, "sw.js"), "importScripts('./sw-shell.js');");
  }

  fs.mkdirSync(path.join(vanillaSite, "views"), { recursive: true });
  fs.writeFileSync(path.join(vanillaSite, "views", "tasks-view.js"), "export {};\n");
  fs.mkdirSync(path.join(rootSite, "vanilla"), { recursive: true });
  fs.writeFileSync(path.join(rootSite, "vanilla", "stale.txt"), "stale");

  execFileSync(
    process.execPath,
    [path.join(root, "scripts", "assemble-pages.mjs"), rootSite, vanillaSite, frameworkSite, output],
    { stdio: "pipe" },
  );

  assert.equal(fs.readFileSync(path.join(output, "index.html"), "utf8"), "root");
  assert.equal(fs.readFileSync(path.join(output, "vanilla", "index.html"), "utf8"), "vanilla");
  assert.equal(fs.readFileSync(path.join(output, "framework", "index.html"), "utf8"), "framework");
  assert.equal(fs.existsSync(path.join(output, "vanilla", "stale.txt")), false);

  const rootShell = readShell(path.join(output, "sw-shell.js"));
  assert.ok(rootShell.includes("./root.txt"));
  assert.ok(rootShell.includes("./sw.js"));
  assert.ok(rootShell.includes("./sw-shell.js"));
  assert.equal(rootShell.some((asset) => asset.includes("vanilla/stale.txt")), false);

  const vanillaShell = readShell(path.join(output, "vanilla", "sw-shell.js"));
  assert.ok(vanillaShell.includes("./vanilla.txt"));
  assert.ok(vanillaShell.includes("./views/tasks-view.js"));
  assert.ok(vanillaShell.includes("./sw-shell.js"));
  assert.equal(fs.existsSync(path.join(output, "framework", "sw-shell.js")), false);

  fs.rmSync(temp, { recursive: true, force: true });
});

test("shared service worker runtime isolates root and preview scopes", () => {
  const sw = fs.readFileSync(path.join(root, "site", "sw.js"), "utf8");
  assert.match(sw, /importScripts\("\.\/sw-shell\.js"\)/);
  assert.match(sw, /new URL\(self\.registration\.scope\)\.pathname/);
  assert.match(sw, /IS_PREVIEW_SCOPE/);
  assert.match(sw, /PREVIEW_PATHS/);
  assert.match(sw, /url\.pathname\.startsWith\(path\)/);
  assert.match(sw, /key\.startsWith\(`\$\{CACHE_NAMESPACE\}:`\)/);
  assert.match(sw, /cache\.match\(event\.request\)/);
  assert.doesNotMatch(sw, /caches\.match\(event\.request\)/);
});

test("service-worker shell manifests are deployment artifacts, not branch-owned source", () => {
  assert.equal(fs.existsSync(path.join(root, "site", "sw-shell.js")), false);
  const assembler = fs.readFileSync(path.join(root, "scripts", "assemble-pages.mjs"), "utf8");
  assert.match(assembler, /writeShellManifest\(rootSite, outputDir\)/);
  assert.match(assembler, /writeShellManifest\(vanillaSite, vanillaOutput\)/);
});

test("shared CI owns both frontend branch triggers", () => {
  const ci = fs.readFileSync(path.join(root, ".github", "workflows", "pages.yml"), "utf8");
  assert.match(ci, /agent\/vanilla-refactor/);
  assert.match(ci, /agent\/framework-preact-refactor/);
  assert.match(ci, /name: Calendar CI/);
});

test("Pages deployment follows successful shared CI for preview branches", () => {
  const deploy = fs.readFileSync(path.join(root, ".github", "workflows", "deploy-pages.yml"), "utf8");
  assert.match(deploy, /workflows: \["Calendar CI"\]/);
  assert.match(deploy, /agent\/vanilla-refactor/);
  assert.match(deploy, /agent\/framework-preact-refactor/);
  assert.doesNotMatch(deploy, /Deploy Calendar to Pages/);
  assert.doesNotMatch(deploy, /site\/sw-shell\.js/);
});
