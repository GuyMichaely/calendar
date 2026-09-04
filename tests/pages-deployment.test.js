import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";

const root = path.resolve(import.meta.dirname, "..");

test("Pages assembly nests preview apps without replacing the root app", () => {
  const temp = fs.mkdtempSync(path.join(os.tmpdir(), "calendar-pages-"));
  const rootSite = path.join(temp, "root");
  const vanillaSite = path.join(temp, "vanilla-source");
  const frameworkSite = path.join(temp, "framework-source");
  const output = path.join(temp, "output");

  for (const [directory, label] of [
    [rootSite, "root"],
    [vanillaSite, "vanilla"],
    [frameworkSite, "framework"],
  ]) {
    fs.mkdirSync(directory, { recursive: true });
    fs.writeFileSync(path.join(directory, "index.html"), label);
    fs.writeFileSync(path.join(directory, `${label}.txt`), label);
  }

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

  fs.rmSync(temp, { recursive: true, force: true });
});

test("root service worker leaves nested previews alone and owns only its cache namespace", () => {
  const sw = fs.readFileSync(path.join(root, "site", "sw.js"), "utf8");
  assert.match(sw, /new URL\(self\.registration\.scope\)\.pathname/);
  assert.match(sw, /PREVIEW_PATHS/);
  assert.match(sw, /url\.pathname\.startsWith\(path\)/);
  assert.match(sw, /key\.startsWith\(`\$\{CACHE_NAMESPACE\}:`\)/);
  assert.match(sw, /cache\.match\(event\.request\)/);
  assert.doesNotMatch(sw, /caches\.match\(event\.request\)/);
});
