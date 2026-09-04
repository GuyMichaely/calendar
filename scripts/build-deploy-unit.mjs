import { cpSync, existsSync, rmSync } from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";
import process from "node:process";

const UNITS = new Set(["root", "old", "vanilla"]);

function run(command, args, cwd) {
  const result = spawnSync(command, args, {
    cwd,
    env: process.env,
    stdio: "inherit",
  });
  if (result.error) throw result.error;
  if (result.status !== 0) {
    throw new Error(`${command} ${args.join(" ")} failed with exit code ${result.status}`);
  }
}

export function buildDeployUnit({ unit, sourceDir, outputDir, verify = false }) {
  if (!UNITS.has(unit)) throw new Error(`Unknown deploy unit: ${unit}`);

  const source = path.resolve(sourceDir);
  const output = path.resolve(outputDir);
  rmSync(output, { recursive: true, force: true });

  if (unit === "root") {
    run("npm", ["install", "--no-audit", "--no-fund"], source);
    if (verify) {
      run("npm", ["test"], source);
      run("npm", ["run", "test:solid"], source);
      run("npm", ["run", "typecheck:solid"], source);
    }
    run("npm", ["run", "build:solid"], source);
  } else if (verify) {
    run("npm", ["test"], source);
  }

  const siteDir = unit === "root" ? path.join(source, "site", "solid") : path.join(source, "site");
  if (!existsSync(path.join(siteDir, "index.html"))) {
    throw new Error(`${unit} build output is missing index.html: ${siteDir}`);
  }
  cpSync(siteDir, output, { recursive: true });
}

function parseArgs(argv) {
  const args = { verify: false };
  for (let i = 0; i < argv.length; i += 1) {
    const value = argv[i];
    if (value === "--verify") {
      args.verify = true;
      continue;
    }
    if (!["--unit", "--source", "--output"].includes(value)) {
      throw new Error(`Unknown argument: ${value}`);
    }
    args[value.slice(2)] = argv[++i];
  }
  if (!args.unit || !args.source || !args.output) {
    throw new Error("Usage: node scripts/build-deploy-unit.mjs --unit <root|old|vanilla> --source <dir> --output <dir> [--verify]");
  }
  return {
    unit: args.unit,
    sourceDir: args.source,
    outputDir: args.output,
    verify: args.verify,
  };
}

if (import.meta.url === `file://${process.argv[1]}`) {
  buildDeployUnit(parseArgs(process.argv.slice(2)));
}
