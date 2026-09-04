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

test("Pages assembly publishes only root, vanilla, and Solid", () => {
  const temp = fs.mkdtempSync(path.join(os.tmpdir(), "calendar-pages-"));
  const rootSite = path.join(temp, "root");
  const vanillaSite = path.join(temp, "vanilla-source");
  const solidSite = path.join(temp, "solid-source");
  const output = path.join(temp, "output");

  for (const [directory, label, withServiceWorker] of [
    [rootSite, "root", true],
    [vanillaSite, "vanilla", true],
    [solidSite, "solid", false],
  ]) {
    fs.mkdirSync(directory, { recursive: true });
    fs.writeFileSync(path.join(directory, "index.html"), label);
    fs.writeFileSync(path.join(directory, `${label}.txt`), label);
    if (withServiceWorker) fs.writeFileSync(path.join(directory, "sw.js"), "importScripts('./sw-shell.js');");
  }

  fs.mkdirSync(path.join(vanillaSite, "views"), { recursive: true });
  fs.writeFileSync(path.join(vanillaSite, "views", "tasks-view.js"), "export {};\n");

  for (const retiredOrReplaced of ["vanilla", "solid", "framework", "preact", "svelte"]) {
    fs.mkdirSync(path.join(rootSite, retiredOrReplaced), { recursive: true });
    fs.writeFileSync(path.join(rootSite, retiredOrReplaced, "stale.txt"), "stale");
  }

  execFileSync(
    process.execPath,
    [path.join(root, "scripts", "assemble-pages.mjs"), rootSite, vanillaSite, solidSite, output],
    { stdio: "pipe" },
  );

  assert.equal(fs.readFileSync(path.join(output, "index.html"), "utf8"), "root");
  assert.equal(fs.readFileSync(path.join(output, "vanilla", "index.html"), "utf8"), "vanilla");
  assert.equal(fs.readFileSync(path.join(output, "solid", "index.html"), "utf8"), "solid");
  assert.equal(fs.existsSync(path.join(output, "framework")), false);
  assert.equal(fs.existsSync(path.join(output, "preact")), false);
  assert.equal(fs.existsSync(path.join(output, "svelte")), false);
  assert.equal(fs.existsSync(path.join(output, "vanilla", "stale.txt")), false);
  assert.equal(fs.existsSync(path.join(output, "solid", "stale.txt")), false);

  const rootShell = readShell(path.join(output, "sw-shell.js"));
  assert.ok(rootShell.includes("./root.txt"));
  assert.ok(rootShell.includes("./sw.js"));
  assert.ok(rootShell.includes("./sw-shell.js"));
  for (const preview of ["vanilla", "solid", "framework", "preact", "svelte"]) {
    assert.equal(rootShell.some((asset) => asset.includes(`${preview}/`)), false);
  }

  const vanillaShell = readShell(path.join(output, "vanilla", "sw-shell.js"));
  assert.ok(vanillaShell.includes("./vanilla.txt"));
  assert.ok(vanillaShell.includes("./views/tasks-view.js"));
  assert.ok(vanillaShell.includes("./sw-shell.js"));
  assert.equal(fs.existsSync(path.join(output, "solid", "sw-shell.js")), false);

  fs.rmSync(temp, { recursive: true, force: true });
});

test("shared service worker isolates only active preview scopes", () => {
  const sw = fs.readFileSync(path.join(root, "site", "sw.js"), "utf8");
  assert.match(sw, /importScripts\("\.\/sw-shell\.js"\)/);
  assert.match(sw, /const CACHE_VERSION = "v15"/);
  assert.match(sw, /new URL\(self\.registration\.scope\)\.pathname/);
  assert.match(sw, /\(\?:vanilla\|solid\)/);
  assert.match(sw, /\["vanilla\/", "solid\/"\]/);
  assert.doesNotMatch(sw, /framework/);
  assert.doesNotMatch(sw, /svelte/);
  assert.match(sw, /url\.pathname\.startsWith\(path\)/);
  assert.match(sw, /key\.startsWith\(`\$\{CACHE_NAMESPACE\}:`\)/);
  assert.match(sw, /cache\.match\(event\.request\)/);
  assert.doesNotMatch(sw, /caches\.match\(event\.request\)/);
});

test("service worker fails closed when neither network nor exact cache has a response", () => {
  const sw = fs.readFileSync(path.join(root, "site", "sw.js"), "utf8");
  assert.match(sw, /if \(response\.ok\) cache\.put\(event\.request, response\.clone\(\)\)/);
  assert.match(sw, /const cached = await cache\.match\(event\.request\)/);
  assert.match(sw, /if \(cached\) return cached/);
  assert.match(sw, /status: 503/);
  assert.match(sw, /Service Unavailable/);
  assert.doesNotMatch(sw, /cache\.match\("\.\/index\.html"\)/);
});

test("service-worker shell manifests are deployment artifacts, not branch-owned source", () => {
  assert.equal(fs.existsSync(path.join(root, "site", "sw-shell.js")), false);
  const assembler = fs.readFileSync(path.join(root, "scripts", "assemble-pages.mjs"), "utf8");
  assert.match(assembler, /writeShellManifest\(rootSite, outputDir\)/);
  assert.match(assembler, /writeShellManifest\(vanillaSite, vanillaOutput\)/);
  assert.match(assembler, /writeShellManifest\(solidSite, solidOutput\)/);
  assert.doesNotMatch(assembler, /writeShellManifest\(frameworkSite/);
  assert.doesNotMatch(assembler, /writeShellManifest\(svelteSite/);
});

test("shared CI is push-driven for main, vanilla, and Solid", () => {
  const ci = fs.readFileSync(path.join(root, ".github", "workflows", "pages.yml"), "utf8");
  assert.match(ci, /agent\/vanilla-refactor/);
  assert.match(ci, /agent\/solid-refactor/);
  assert.match(ci, /npm run test:solid/);
  assert.match(ci, /npm run typecheck:solid/);
  assert.match(ci, /npm run build:solid/);
  assert.doesNotMatch(ci, /agent\/framework-preact-refactor/);
  assert.doesNotMatch(ci, /agent\/svelte-refactor/);
  assert.doesNotMatch(ci, /pull_request:/);
  assert.match(ci, /name: Calendar CI/);
});

test("Pages deployment follows successful pushes and publishes only active frontends", () => {
  const deploy = fs.readFileSync(path.join(root, ".github", "workflows", "deploy-pages.yml"), "utf8");
  assert.match(deploy, /workflows: \["Calendar CI"\]/);
  assert.match(deploy, /agent\/vanilla-refactor/);
  assert.match(deploy, /agent\/solid-refactor/);
  assert.match(deploy, /npm run test:solid/);
  assert.match(deploy, /npm run typecheck:solid/);
  assert.match(deploy, /npm run build:solid/);
  assert.match(deploy, /\.sources\/solid\/site\/solid/);
  assert.doesNotMatch(deploy, /agent\/framework-preact-refactor/);
  assert.doesNotMatch(deploy, /agent\/svelte-refactor/);
  assert.doesNotMatch(deploy, /pull_request:/);
  assert.match(deploy, /github\.event\.workflow_run\.conclusion == 'success'/);
  assert.match(deploy, /github\.event\.workflow_run\.event == 'push'/);
  assert.match(deploy, /group: pages-deploy/);
  assert.match(deploy, /cancel-in-progress: true/);
});
