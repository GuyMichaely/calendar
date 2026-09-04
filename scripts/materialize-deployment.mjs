import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import process from "node:process";
import { buildDeployUnit } from "./build-deploy-unit.mjs";

const [manifestFile, rawOutputDir] = process.argv.slice(2);
if (!manifestFile || !rawOutputDir) {
  throw new Error("Usage: node scripts/materialize-deployment.mjs <manifest-json> <output-dir>");
}

const repository = process.env.GITHUB_REPOSITORY;
const token = process.env.GITHUB_TOKEN;
if (!repository || !token) throw new Error("GITHUB_REPOSITORY and GITHUB_TOKEN are required.");

const manifest = JSON.parse(readFileSync(manifestFile, "utf8"));
if (manifest.version !== 1 || !manifest.units) throw new Error("Unsupported deployment manifest.");

const outputDir = path.resolve(rawOutputDir);
rmSync(outputDir, { recursive: true, force: true });
mkdirSync(outputDir, { recursive: true });

const headers = {
  Accept: "application/vnd.github+json",
  Authorization: `Bearer ${token}`,
  "X-GitHub-Api-Version": "2022-11-28",
};

function run(command, args, cwd = process.cwd()) {
  const result = spawnSync(command, args, { cwd, env: process.env, stdio: "inherit" });
  if (result.error) throw result.error;
  if (result.status !== 0) {
    throw new Error(`${command} ${args.join(" ")} failed with exit code ${result.status}`);
  }
}

function recordedExpiryPassed(entry) {
  const expiresAt = Date.parse(entry.artifact?.expiresAt || "");
  if (!Number.isFinite(expiresAt)) throw new Error("Manifest artifact has an invalid expiresAt value.");
  return Date.now() >= expiresAt;
}

async function artifactMetadata(id) {
  const response = await fetch(
    `https://api.github.com/repos/${repository}/actions/artifacts/${id}`,
    { headers },
  );
  if (response.status === 404) return { state: "missing" };
  if (response.status === 410) return { state: "expired" };
  if (!response.ok) {
    throw new Error(`Artifact metadata lookup failed: ${response.status} ${await response.text()}`);
  }
  return { state: "found", artifact: await response.json() };
}

function validateMetadata(unit, entry, artifact) {
  const expected = entry.artifact;
  if (
    artifact.id !== expected.id ||
    artifact.name !== expected.name ||
    artifact.workflow_run?.id !== expected.verificationRunId
  ) {
    throw new Error(`Artifact provenance mismatch for ${unit}.`);
  }
  if (expected.digest && artifact.digest && artifact.digest !== expected.digest) {
    throw new Error(`Artifact digest metadata mismatch for ${unit}.`);
  }
}

async function downloadArtifact(unit, entry, target) {
  const response = await fetch(
    `https://api.github.com/repos/${repository}/actions/artifacts/${entry.artifact.id}/zip`,
    { headers, redirect: "follow" },
  );

  if (response.status === 410) return false;
  if (response.status === 404) {
    if (recordedExpiryPassed(entry)) return false;
    throw new Error(`Verified artifact for ${unit} disappeared before its recorded expiry.`);
  }
  if (!response.ok) {
    throw new Error(`Artifact download failed for ${unit}: ${response.status} ${await response.text()}`);
  }

  const tempDir = mkdtempSync(path.join(os.tmpdir(), `calendar-artifact-${unit}-`));
  try {
    const zipFile = path.join(tempDir, "artifact.zip");
    writeFileSync(zipFile, Buffer.from(await response.arrayBuffer()));
    rmSync(target, { recursive: true, force: true });
    mkdirSync(target, { recursive: true });
    run("unzip", ["-q", zipFile, "-d", target]);
  } finally {
    rmSync(tempDir, { recursive: true, force: true });
  }
  return true;
}

function rebuildUnit(unit, entry, target) {
  console.log(`Rebuilding expired ${unit} artifact for ${entry.sha} without retesting.`);
  const tempDir = mkdtempSync(path.join(os.tmpdir(), `calendar-rebuild-${unit}-`));
  const source = path.join(tempDir, "source");
  let worktreeAdded = false;
  try {
    run("git", ["fetch", "--no-tags", "--depth=1", "origin", entry.sha]);
    run("git", ["worktree", "add", "--detach", source, entry.sha]);
    worktreeAdded = true;
    buildDeployUnit({
      unit,
      sourceDir: source,
      outputDir: target,
      verify: false,
    });
  } finally {
    if (worktreeAdded) run("git", ["worktree", "remove", "--force", source]);
    rmSync(tempDir, { recursive: true, force: true });
  }
}

for (const unit of ["root", "old", "vanilla"]) {
  const entry = manifest.units[unit];
  if (
    !entry ||
    !/^[0-9a-f]{40}$/.test(String(entry.sha || "")) ||
    !Number.isInteger(entry.artifact?.id) ||
    !entry.artifact?.name ||
    !Number.isInteger(entry.artifact?.verificationRunId) ||
    !entry.artifact?.expiresAt
  ) {
    throw new Error(`Deployment manifest entry for ${unit} is incomplete.`);
  }

  const target = path.join(outputDir, unit);
  const metadata = await artifactMetadata(entry.artifact.id);

  if (metadata.state === "found") {
    validateMetadata(unit, entry, metadata.artifact);
    if (!metadata.artifact.expired && await downloadArtifact(unit, entry, target)) {
      console.log(`Using verified artifact ${entry.artifact.id} for ${unit} ${entry.sha}.`);
      continue;
    }
    rebuildUnit(unit, entry, target);
    continue;
  }

  if (metadata.state === "expired" || recordedExpiryPassed(entry)) {
    rebuildUnit(unit, entry, target);
    continue;
  }

  throw new Error(`Verified artifact for ${unit} is missing before its recorded expiry.`);
}
