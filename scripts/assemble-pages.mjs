import { cpSync, existsSync, mkdirSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import path from "node:path";
import process from "node:process";

const [rootSite, vanillaSite, frameworkSite, outputDir] = process.argv.slice(2).map((value) => value && path.resolve(value));

if (![rootSite, vanillaSite, frameworkSite, outputDir].every(Boolean)) {
  throw new Error("Usage: node scripts/assemble-pages.mjs <root-site> <vanilla-site> <framework-site> <output-dir>");
}

for (const [label, directory] of [
  ["root", rootSite],
  ["vanilla", vanillaSite],
  ["framework", frameworkSite],
]) {
  if (!existsSync(path.join(directory, "index.html"))) {
    throw new Error(`${label} site is missing index.html: ${directory}`);
  }
}

function collectShellAssets(sourceDir, relativeDir = "") {
  const assets = [];
  const directory = path.join(sourceDir, relativeDir);

  for (const entry of readdirSync(directory, { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name))) {
    if (entry.name.startsWith(".")) continue;
    if (!relativeDir && entry.isDirectory() && ["vanilla", "framework"].includes(entry.name)) continue;

    const relativePath = path.join(relativeDir, entry.name);
    if (entry.isDirectory()) {
      assets.push(...collectShellAssets(sourceDir, relativePath));
      continue;
    }
    if (!entry.isFile() || entry.name === "sw-shell.js") continue;
    assets.push(`./${relativePath.split(path.sep).join("/")}`);
  }

  return assets;
}

function writeShellManifest(sourceDir, deployedDir) {
  if (!existsSync(path.join(sourceDir, "sw.js"))) return;
  const assets = ["./", ...collectShellAssets(sourceDir), "./sw-shell.js"];
  writeFileSync(
    path.join(deployedDir, "sw-shell.js"),
    `self.CALENDAR_SHELL = ${JSON.stringify(assets, null, 2)};\n`,
  );
}

rmSync(outputDir, { recursive: true, force: true });
mkdirSync(outputDir, { recursive: true });
cpSync(rootSite, outputDir, { recursive: true });

for (const preview of ["vanilla", "framework"]) {
  rmSync(path.join(outputDir, preview), { recursive: true, force: true });
}

const vanillaOutput = path.join(outputDir, "vanilla");
const frameworkOutput = path.join(outputDir, "framework");
cpSync(vanillaSite, vanillaOutput, { recursive: true });
cpSync(frameworkSite, frameworkOutput, { recursive: true });

writeShellManifest(rootSite, outputDir);
writeShellManifest(vanillaSite, vanillaOutput);
writeShellManifest(frameworkSite, frameworkOutput);

console.log(`Assembled Pages artifact at ${outputDir}`);
