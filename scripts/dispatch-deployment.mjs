const [rawSha, branch] = process.argv.slice(2);
const sha = String(rawSha || "").toLowerCase();
if (!/^[0-9a-f]{40}$/.test(sha) || !branch) {
  throw new Error("Usage: node scripts/dispatch-deployment.mjs <40-char-control-sha> <control-branch>");
}

const repository = process.env.GITHUB_REPOSITORY;
const token = process.env.GITHUB_TOKEN;
if (!repository || !token) throw new Error("GITHUB_REPOSITORY and GITHUB_TOKEN are required.");

const response = await fetch(
  `https://api.github.com/repos/${repository}/actions/workflows/deploy-pages.yml/dispatches`,
  {
    method: "POST",
    headers: {
      Accept: "application/vnd.github+json",
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
      "X-GitHub-Api-Version": "2022-11-28",
    },
    body: JSON.stringify({
      ref: branch,
      inputs: { control_sha: sha },
    }),
  },
);

if (response.status !== 204) {
  throw new Error(`Could not dispatch deployment: ${response.status} ${await response.text()}`);
}

console.log(`Dispatched deployment for control commit ${sha}.`);
