import { readFileSync, writeFileSync } from "node:fs";

const [manifestFile, unit, rawRevision] = process.argv.slice(2);
const revision = String(rawRevision || "").toLowerCase();
const units = new Set(["root", "old", "vanilla"]);

if (!manifestFile || !units.has(unit) || !/^[0-9a-f]{40}$/.test(revision)) {
  throw new Error("Usage: node scripts/update-manifest.mjs <manifest> <unit> <40-char-revision>");
}

const manifest = JSON.parse(readFileSync(manifestFile, "utf8"));
const current = manifest.units?.[unit];

if (!current || typeof current.path !== "string") {
  throw new Error("Deployment manifest is missing the requested unit or its path.");
}

manifest.units[unit] = {
  path: current.path,
  revision,
};

writeFileSync(manifestFile, `${JSON.stringify(manifest, null, 2)}\n`);
