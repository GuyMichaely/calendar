import { writeFileSync } from "node:fs";
import process from "node:process";

const [unit, rawSha, outputFile] = process.argv.slice(2);
const sha = String(rawSha || "").toLowerCase();

if (!["root", "old", "vanilla"].includes(unit) || !/^[0-9a-f]{40}$/.test(sha) || !outputFile) {
  throw new Error("Usage: node scripts/find-verification.mjs <root|old|vanilla> <40-char-sha> <output-json>");
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

function usedCanonicalCandidateWorkflow(run) {
  return (run.referenced_workflows || []).some((workflow) =>
    workflow.path === `${repository}/.github/workflows/test-and-build-candidate.yml@deployment-control`,
  );
}

function isAcceptedCandidateRun(run) {
  if (run.status !== "completed" || run.conclusion !== "success") return false;

  const manual =
    run.event === "workflow_dispatch" &&
    run.path === ".github/workflows/test-and-build-candidate.yml";

  const requested =
    run.event === "push" &&
    run.path === ".github/workflows/action-request.yml" &&
    run.head_branch === "action-trigger" &&
    usedCanonicalCandidateWorkflow(run);

  return manual || requested;
}

const artifactName = `deploy-${unit}-${sha}`;
const query = new URLSearchParams({ name: artifactName, per_page: "100" });
const { artifacts = [] } = await api(`/actions/artifacts?${query}`);
const candidates = artifacts
  .filter((artifact) => artifact.name === artifactName && !artifact.expired)
  .sort((a, b) => String(b.created_at).localeCompare(String(a.created_at)));

for (const artifact of candidates) {
  const runId = artifact.workflow_run?.id;
  if (!runId) continue;

  const run = await api(`/actions/runs/${runId}`);
  if (!isAcceptedCandidateRun(run)) continue;

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
  console.log(`Found successful candidate build run ${runId} and artifact ${artifact.id}.`);
  process.exit(0);
}

throw new Error(`No active successful Test and Build Candidate artifact found for ${unit} ${sha}.`);
