import { cpSync, existsSync, mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import path from "node:path";
import process from "node:process";

const [rootSite, oldSite, vanillaSite, outputDir] = process.argv
  .slice(2)
  .map((value) => value && path.resolve(value));

if (![rootSite, oldSite, vanillaSite, outputDir].every(Boolean)) {
  throw new Error("Usage: node scripts/assemble-pages.mjs <root-site> <old-site> <vanilla-site> <output-dir>");
}

const nestedDeployDirectories = ["old", "vanilla", "solid", "framework", "preact", "svelte"];

function collectShellAssets(sourceDir, relativeDir = "") {
  const assets = [];
  const directory = path.join(sourceDir, relativeDir);

  for (const entry of readdirSync(directory, { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name))) {
    if (entry.name.startsWith(".")) continue;
    if (!relativeDir && entry.isDirectory() && nestedDeployDirectories.includes(entry.name)) continue;

    const relativePath = path.join(relativeDir, entry.name);
    if (entry.isDirectory()) {
      assets.push(...collectShellAssets(sourceDir, relativePath));
      continue;
    }
    if (!entry.isFile() || entry.name === "sw-shell.js") continue;
    assets.push(`./${relativePath.split(path.sep).join("/")}`);
  }

  return assets;
}

function writeShellManifest(sourceDir, deployedDir) {
  if (!existsSync(path.join(sourceDir, "sw.js"))) return;
  const assets = ["./", ...collectShellAssets(sourceDir), "./sw-shell.js"];
  writeFileSync(
    path.join(deployedDir, "sw-shell.js"),
    `self.CALENDAR_SHELL = ${JSON.stringify(assets, null, 2)};\n`,
  );
}

function normalizeRootIndex(deployedDir) {
  const indexFile = path.join(deployedDir, "index.html");
  if (!existsSync(indexFile)) return;
  const current = readFileSync(indexFile, "utf8");
  const normalized = current
    .replaceAll("/calendar/solid/", "/calendar/")
    .replace("<title>Calendar · Solid preview</title>", "<title>Calendar</title>");
  if (normalized !== current) writeFileSync(indexFile, normalized);
}

rmSync(outputDir, { recursive: true, force: true });
mkdirSync(outputDir, { recursive: true });
cpSync(rootSite, outputDir, { recursive: true });

for (const nested of nestedDeployDirectories) {
  rmSync(path.join(outputDir, nested), { recursive: true, force: true });
}
normalizeRootIndex(outputDir);

const oldOutput = path.join(outputDir, "old");
const vanillaOutput = path.join(outputDir, "vanilla");
cpSync(oldSite, oldOutput, { recursive: true });
cpSync(vanillaSite, vanillaOutput, { recursive: true });

writeShellManifest(rootSite, outputDir);
writeShellManifest(oldSite, oldOutput);
writeShellManifest(vanillaSite, vanillaOutput);

console.log(`Assembled Pages artifact at ${outputDir}`);
