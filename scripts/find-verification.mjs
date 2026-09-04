import { writeFileSync } from "node:fs";
import process from "node:process";

const UNITS = new Set(["root", "vanilla", "solid"]);
const [unit, rawSha, outputFile] = process.argv.slice(2);
const sha = String(rawSha || "").toLowerCase();

if (!UNITS.has(unit) || !/^[0-9a-f]{40}$/.test(sha) || !outputFile) {
  throw new Error("Usage: node scripts/find-verification.mjs <root|vanilla|solid> <40-char-sha> <output-json>");
}

const repository = process.env.GITHUB_REPOSITORY;
const token = process.env.GITHUB_TOKEN;
if (!repository || !token) throw new Error("GITHUB_REPOSITORY and GITHUB_TOKEN are required.");

const headers = {
  Accept: "application/vnd.github+json",
  Authorization: `Bearer ${token}`,
  "X-GitHub-Api-Version": "2022-11-28",
};

async function api(path) {
  const response = await fetch(`https://api.github.com/repos/${repository}${path}`, { headers });
  if (!response.ok) {
    throw new Error(`GitHub API ${response.status} for ${path}: ${await response.text()}`);
  }
  return response.json();
}

const artifactName = `verified-${unit}-${sha}`;
const query = new URLSearchParams({ name: artifactName, per_page: "100" });
const { artifacts = [] } = await api(`/actions/artifacts?${query}`);
const candidates = artifacts
  .filter((artifact) => artifact.name === artifactName && !artifact.expired)
  .sort((a, b) => String(b.created_at).localeCompare(String(a.created_at)));

for (const artifact of candidates) {
  const runId = artifact.workflow_run?.id;
  if (!runId) continue;

  const run = await api(`/actions/runs/${runId}`);
  if (
    run.status !== "completed" ||
    run.conclusion !== "success" ||
    run.event !== "workflow_dispatch" ||
    run.path !== ".github/workflows/verify-candidate.yml"
  ) {
    continue;
  }

  writeFileSync(
    outputFile,
    `${JSON.stringify({
      id: artifact.id,
      name: artifact.name,
      verificationRunId: runId,
      expiresAt: artifact.expires_at,
      digest: artifact.digest || null,
    }, null, 2)}\n`,
  );
  console.log(`Found successful verification run ${runId} and artifact ${artifact.id}.`);
  process.exit(0);
}

throw new Error(`No active successful Verify Candidate artifact found for ${unit} ${sha}.`);
