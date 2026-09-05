import { writeFileSync } from "node:fs";
import process from "node:process";
import { pathToFileURL } from "node:url";

const UNITS = new Set(["root", "old", "vanilla"]);

function normalizeCandidate(unit, rawSha) {
  const sha = String(rawSha || "").toLowerCase();
  if (!UNITS.has(unit) || !/^[0-9a-f]{40}$/.test(sha)) {
    throw new Error("Candidate must be a known unit and exact 40-character SHA.");
  }
  return sha;
}

function githubContext() {
  const repository = process.env.GITHUB_REPOSITORY;
  const token = process.env.GITHUB_TOKEN;
  if (!repository || !token) throw new Error("GITHUB_REPOSITORY and GITHUB_TOKEN are required.");
  return { repository, token };
}

async function api(path) {
  const { repository, token } = githubContext();
  const response = await fetch(`https://api.github.com/repos/${repository}${path}`, {
    headers: {
      Accept: "application/vnd.github+json",
      Authorization: `Bearer ${token}`,
      "X-GitHub-Api-Version": "2022-11-28",
    },
  });
  if (!response.ok) {
    throw new Error(`GitHub API ${response.status} for ${path}: ${await response.text()}`);
  }
  return response.json();
}

function usedCanonicalCandidateWorkflow(run, repository) {
  const prefix = `${repository}/.github/workflows/test-and-build-candidate.yml@`;
  return (run.referenced_workflows || []).some(
    (workflow) =>
      String(workflow.path || "").startsWith(prefix) &&
      workflow.ref === "refs/heads/deployment-control",
  );
}

function isAcceptedCandidateRun(run, repository) {
  if (run.status !== "completed" || run.conclusion !== "success") return false;

  const manual =
    run.event === "workflow_dispatch" &&
    run.path === ".github/workflows/test-and-build-candidate.yml";

  const requested =
    run.event === "push" &&
    run.path === ".github/workflows/action-request.yml" &&
    run.head_branch === "action-trigger" &&
    usedCanonicalCandidateWorkflow(run, repository);

  return manual || requested;
}

export async function findVerification(unit, rawSha) {
  const sha = normalizeCandidate(unit, rawSha);
  const { repository } = githubContext();
  const artifactName = `deploy-${unit}-${sha}`;
  const query = new URLSearchParams({ name: artifactName, per_page: "100" });
  const { artifacts = [] } = await api(`/actions/artifacts?${query}`);

  for (const artifact of artifacts) {
    if (artifact.name !== artifactName || artifact.expired) continue;
    const runId = artifact.workflow_run?.id;
    if (!runId) continue;

    const run = await api(`/actions/runs/${runId}`);
    if (!isAcceptedCandidateRun(run, repository)) continue;

    return { id: artifact.id, name: artifact.name, runId };
  }

  return null;
}

async function main() {
  const [unit, rawSha, outputFile] = process.argv.slice(2);
  const sha = normalizeCandidate(unit, rawSha);
  const verification = await findVerification(unit, sha);
  if (!verification) {
    throw new Error(`No active successful Test and Build Candidate artifact found for ${unit} ${sha}.`);
  }

  if (outputFile) {
    writeFileSync(outputFile, `${JSON.stringify(verification, null, 2)}\n`);
  }
  console.log(`Found successful candidate build run ${verification.runId} and artifact ${verification.id}.`);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  await main();
}
