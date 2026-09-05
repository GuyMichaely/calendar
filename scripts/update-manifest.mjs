import { readFileSync, writeFileSync } from "node:fs";

const [manifestFile, unit, rawSha, verificationFile] = process.argv.slice(2);
const sha = String(rawSha || "").toLowerCase();
const units = new Set(["root", "old", "vanilla"]);

if (!manifestFile || !units.has(unit) || !/^[0-9a-f]{40}$/.test(sha) || !verificationFile) {
  throw new Error("Usage: node scripts/update-manifest.mjs <manifest> <unit> <40-char-sha> <verification-json>");
}

const manifest = JSON.parse(readFileSync(manifestFile, "utf8"));
const verification = JSON.parse(readFileSync(verificationFile, "utf8"));
const current = manifest.units?.[unit];

if (!current || typeof current.path !== "string") {
  throw new Error("Deployment manifest is missing the requested unit or its path.");
}
if (!Number.isInteger(verification.id)) {
  throw new Error("Verification metadata is missing the artifact id.");
}

manifest.units[unit] = {
  path: current.path,
  sha,
  artifact: verification.id,
};

writeFileSync(manifestFile, `${JSON.stringify(manifest, null, 2)}\n`);
