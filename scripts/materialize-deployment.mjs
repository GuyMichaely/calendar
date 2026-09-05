import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import process from "node:process";
import { buildDeployUnit } from "./build-deploy-unit.mjs";
import { findVerification } from "./find-verification.mjs";

const [manifestFile, rawOutputDir] = process.argv.slice(2);
if (!manifestFile || !rawOutputDir) {
  throw new Error("Usage: node scripts/materialize-deployment.mjs <manifest-json> <output-dir>");
}

const repository = process.env.GITHUB_REPOSITORY;
const token = process.env.GITHUB_TOKEN;
if (!repository || !token) throw new Error("GITHUB_REPOSITORY and GITHUB_TOKEN are required.");

const manifest = JSON.parse(readFileSync(manifestFile, "utf8"));
if (!manifest.units) throw new Error("Deployment manifest is missing units.");

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

async function downloadArtifact(id, target) {
  const response = await fetch(
    `https://api.github.com/repos/${repository}/actions/artifacts/${id}/zip`,
    { headers, redirect: "follow" },
  );

  if (response.status === 404 || response.status === 410) return false;
  if (!response.ok) {
    throw new Error(`Artifact download failed: ${response.status} ${await response.text()}`);
  }

  const tempDir = mkdtempSync(path.join(os.tmpdir(), "calendar-artifact-"));
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

function rebuildUnit(unit, revision, target) {
  console.log(`Rebuilding ${unit} from ${revision} because no verified artifact is available.`);
  const tempDir = mkdtempSync(path.join(os.tmpdir(), `calendar-rebuild-${unit}-`));
  const source = path.join(tempDir, "source");
  let worktreeAdded = false;
  try {
    run("git", ["fetch", "--no-tags", "--depth=1", "origin", revision]);
    run("git", ["worktree", "add", "--detach", source, revision]);
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
  const revision = String(entry?.revision || "").toLowerCase();
  if (
    !entry ||
    typeof entry.path !== "string" ||
    !/^[0-9a-f]{40}$/.test(revision)
  ) {
    throw new Error(`Deployment manifest entry for ${unit} is incomplete.`);
  }

  const target = path.join(outputDir, unit);
  const verification = await findVerification(unit, revision);

  if (verification && await downloadArtifact(verification.id, target)) {
    console.log(`Using verified artifact ${verification.id} for ${unit} ${revision}.`);
    continue;
  }

  rebuildUnit(unit, revision, target);
}
