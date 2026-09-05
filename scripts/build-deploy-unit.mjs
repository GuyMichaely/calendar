import { cpSync, existsSync, readFileSync, rmSync } from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";
import process from "node:process";

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

function packageScripts(source) {
  const packageFile = path.join(source, "package.json");
  if (!existsSync(packageFile)) return {};
  const manifest = JSON.parse(readFileSync(packageFile, "utf8"));
  return manifest.scripts || {};
}

export function buildDeployUnit({ unit, sourceDir, outputDir, verify = false }) {
  if (!/^[A-Za-z0-9][A-Za-z0-9._-]*$/.test(String(unit || ""))) {
    throw new Error(`Invalid deploy unit name: ${unit}`);
  }

  const source = path.resolve(sourceDir);
  const output = path.resolve(outputDir);
  const scripts = packageScripts(source);
  const hasPackage = existsSync(path.join(source, "package.json"));
  const hasSolidBuild = typeof scripts["build:solid"] === "string";

  rmSync(output, { recursive: true, force: true });

  if (hasPackage) {
    run("npm", ["install", "--no-audit", "--no-fund"], source);
  }

  if (verify && typeof scripts.test === "string") {
    run("npm", ["test"], source);
  }

  if (hasSolidBuild) {
    if (verify && typeof scripts["test:solid"] === "string") {
      run("npm", ["run", "test:solid"], source);
    }
    if (verify && typeof scripts["typecheck:solid"] === "string") {
      run("npm", ["run", "typecheck:solid"], source);
    }
    run("npm", ["run", "build:solid"], source);
  }

  const siteDir = hasSolidBuild ? path.join(source, "site", "solid") : path.join(source, "site");
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
    throw new Error("Usage: node scripts/build-deploy-unit.mjs --unit <name> --source <dir> --output <dir> [--verify]");
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
