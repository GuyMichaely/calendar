import { readFileSync, writeFileSync } from "node:fs";

const [manifestFile, unit, rawRevision] = process.argv.slice(2);
const revision = String(rawRevision || "").toLowerCase();

if (
  !manifestFile ||
  !/^[A-Za-z0-9][A-Za-z0-9._-]*$/.test(String(unit || "")) ||
  !/^[0-9a-f]{40}$/.test(revision)
) {
  throw new Error("Usage: node scripts/update-manifest.mjs <manifest> <unit> <40-char-revision>");
}

const manifest = JSON.parse(readFileSync(manifestFile, "utf8"));
const current = manifest.units?.[unit];

if (!current || typeof current.path !== "string") {
  throw new Error(`Deployment unit '${unit}' is not defined in the manifest or has no path.`);
}

manifest.units[unit] = {
  ...current,
  revision,
};

writeFileSync(manifestFile, `${JSON.stringify(manifest, null, 2)}\n`);
