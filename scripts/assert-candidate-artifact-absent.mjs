import process from "node:process";
import {
  activeCandidateArtifacts,
  candidateArtifactName,
} from "./find-verification.mjs";

const [unit, rawSha] = process.argv.slice(2);
const artifactName = candidateArtifactName(unit, rawSha);
const artifacts = await activeCandidateArtifacts(unit, rawSha);

if (artifacts.length > 0) {
  const ids = artifacts.map((artifact) => artifact.id).join(", ");
  throw new Error(
    `Refusing to rebuild ${artifactName}: ${artifacts.length} active artifact(s) already exist (${ids}).`,
  );
}

console.log(`No active artifact exists for ${artifactName}.`);
