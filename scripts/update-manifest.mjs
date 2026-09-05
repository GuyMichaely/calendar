import { readFileSync, writeFileSync } from "node:fs";
import path from "node:path";

const [manifestFile, unit, rawRevision, rawPath] = process.argv.slice(2);
const revision = String(rawRevision || "").toLowerCase();
const requestedPath = rawPath === undefined ? "" : String(rawPath);

if (
  !manifestFile ||
  !/^[A-Za-z0-9][A-Za-z0-9._-]*$/.test(String(unit || "")) ||
  !/^[0-9a-f]{40}$/.test(revision)
) {
  throw new Error(
    "Usage: node scripts/update-manifest.mjs <manifest> <unit> <40-char-revision> [deploy-path]",
  );
}

function relativeDeployPath(unitName, raw) {
  if (typeof raw !== "string" || !raw.startsWith("/") || !raw.endsWith("/")) {
    throw new Error(`Deployment path for ${unitName} must start and end with '/'.`);
  }
  if (raw === "/") return "";

  const segments = raw.slice(1, -1).split("/");
  if (segments.some((segment) => !segment || segment === "." || segment === "..")) {
    throw new Error(`Deployment path for ${unitName} is invalid: ${raw}`);
  }
  return segments.join(path.sep);
}

function validateManifest(manifest) {
  if (!manifest.units || typeof manifest.units !== "object" || Array.isArray(manifest.units)) {
    throw new Error("Deployment manifest is missing a units object.");
  }

  const entries = Object.entries(manifest.units);
  if (entries.length === 0) throw new Error("Deployment manifest must define at least one unit.");

  const deployPaths = new Map();
  for (const [unitName, entry] of entries) {
    if (!/^[A-Za-z0-9][A-Za-z0-9._-]*$/.test(unitName)) {
      throw new Error(`Invalid deployment unit name: ${unitName}`);
    }
    if (!entry || typeof entry !== "object" || Array.isArray(entry)) {
      throw new Error(`Deployment manifest entry for ${unitName} must be an object.`);
    }
    if (!/^[0-9a-f]{40}$/.test(String(entry.revision || "").toLowerCase())) {
      throw new Error(`Deployment manifest entry for ${unitName} must contain an exact revision SHA.`);
    }
    deployPaths.set(unitName, relativeDeployPath(unitName, entry.path));
  }

  const uniquePaths = new Set(deployPaths.values());
  if (uniquePaths.size !== deployPaths.size) throw new Error("Deployment paths must be unique.");

  const rootUnits = [...deployPaths].filter(([, deployPath]) => deployPath === "");
  if (rootUnits.length !== 1) throw new Error("Exactly one deploy unit must use path '/'.");

  for (const [unitName, candidate] of deployPaths) {
    if (!candidate) continue;
    for (const [otherUnit, otherPath] of deployPaths) {
      if (unitName === otherUnit || !otherPath) continue;
      if (otherPath.startsWith(`${candidate}${path.sep}`)) {
        throw new Error(`Deployment paths may not nest: ${unitName} and ${otherUnit}.`);
      }
    }
  }
}

const manifest = JSON.parse(readFileSync(manifestFile, "utf8"));
if (!manifest.units || typeof manifest.units !== "object" || Array.isArray(manifest.units)) {
  throw new Error("Deployment manifest is missing a units object.");
}

const current = manifest.units[unit];
if (!requestedPath && (!current || typeof current.path !== "string")) {
  throw new Error(
    `Deployment unit '${unit}' is not defined in the manifest. Supply a deployment path to create it.`,
  );
}

manifest.units[unit] = {
  ...(current || {}),
  path: requestedPath || current.path,
  revision,
};

validateManifest(manifest);
writeFileSync(manifestFile, `${JSON.stringify(manifest, null, 2)}\n`);
