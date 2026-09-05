import { cpSync, existsSync, mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import path from "node:path";
import process from "node:process";

const [manifestFile, rawSourcesDir, rawOutputDir] = process.argv.slice(2);
if (!manifestFile || !rawSourcesDir || !rawOutputDir) {
  throw new Error("Usage: node scripts/assemble-pages.mjs <manifest-json> <sources-dir> <output-dir>");
}

const manifest = JSON.parse(readFileSync(manifestFile, "utf8"));
const sourcesDir = path.resolve(rawSourcesDir);
const outputDir = path.resolve(rawOutputDir);
const units = ["root", "old", "vanilla"];

function relativeDeployPath(unit) {
  const raw = manifest.units?.[unit]?.path;
  if (typeof raw !== "string" || !raw.startsWith("/") || !raw.endsWith("/")) {
    throw new Error(`Deployment path for ${unit} must start and end with '/'.`);
  }
  if (raw === "/") return "";

  const segments = raw.slice(1, -1).split("/");
  if (segments.some((segment) => !segment || segment === "." || segment === "..")) {
    throw new Error(`Deployment path for ${unit} is invalid: ${raw}`);
  }
  return segments.join(path.sep);
}

const deployPaths = new Map(units.map((unit) => [unit, relativeDeployPath(unit)]));
const uniquePaths = new Set(deployPaths.values());
if (uniquePaths.size !== units.length) throw new Error("Deployment paths must be unique.");

const rootUnits = units.filter((unit) => deployPaths.get(unit) === "");
if (rootUnits.length !== 1) throw new Error("Exactly one deploy unit must use path '/'.");

for (const unit of units) {
  const candidate = deployPaths.get(unit);
  if (!candidate) continue;
  for (const other of units) {
    if (unit === other) continue;
    const otherPath = deployPaths.get(other);
    if (otherPath && otherPath.startsWith(`${candidate}${path.sep}`)) {
      throw new Error(`Deployment paths may not nest: ${unit} and ${other}.`);
    }
  }
}

const nestedDeployDirectories = new Set([
  ...[...deployPaths.values()]
    .filter(Boolean)
    .map((deployPath) => deployPath.split(path.sep)[0]),
  "solid",
  "framework",
  "preact",
  "svelte",
]);

function collectShellAssets(sourceDir, relativeDir = "") {
  const assets = [];
  const directory = path.join(sourceDir, relativeDir);

  for (const entry of readdirSync(directory, { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name))) {
    if (entry.name.startsWith(".")) continue;
    if (!relativeDir && entry.isDirectory() && nestedDeployDirectories.has(entry.name)) continue;

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

const rootUnit = rootUnits[0];
const rootSource = path.join(sourcesDir, rootUnit);
cpSync(rootSource, outputDir, { recursive: true });
for (const nested of nestedDeployDirectories) {
  rmSync(path.join(outputDir, nested), { recursive: true, force: true });
}
if (rootUnit === "root") normalizeRootIndex(outputDir);
writeShellManifest(rootSource, outputDir);

for (const unit of units) {
  if (unit === rootUnit) continue;
  const source = path.join(sourcesDir, unit);
  const destination = path.join(outputDir, deployPaths.get(unit));
  mkdirSync(path.dirname(destination), { recursive: true });
  cpSync(source, destination, { recursive: true });
  writeShellManifest(source, destination);
}

console.log(`Assembled Pages artifact at ${outputDir}`);
