import { readFileSync, writeFileSync } from "node:fs";

const [manifestFile, unit, rawSha, verificationFile] = process.argv.slice(2);
const sha = String(rawSha || "").toLowerCase();
const units = new Set(["root", "old", "vanilla"]);

if (!manifestFile || !units.has(unit) || !/^[0-9a-f]{40}$/.test(sha) || !verificationFile) {
  throw new Error("Usage: node scripts/update-manifest.mjs <manifest> <unit> <40-char-sha> <verification-json>");
}

const manifest = JSON.parse(readFileSync(manifestFile, "utf8"));
const verification = JSON.parse(readFileSync(verificationFile, "utf8"));

if (manifest.version !== 1 || !manifest.units || !manifest.units[unit]) {
  throw new Error("Unsupported or incomplete deployment manifest.");
}
if (
  !Number.isInteger(verification.id) ||
  !verification.name ||
  !Number.isInteger(verification.verificationRunId) ||
  !verification.expiresAt
) {
  throw new Error("Verification metadata is incomplete.");
}

manifest.units[unit] = {
  sha,
  artifact: {
    id: verification.id,
    name: verification.name,
    verificationRunId: verification.verificationRunId,
    expiresAt: verification.expiresAt,
    digest: verification.digest || null,
  },
};

writeFileSync(manifestFile, `${JSON.stringify(manifest, null, 2)}\n`);
