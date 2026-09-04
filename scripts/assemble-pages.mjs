import { cpSync, existsSync, mkdirSync, rmSync } from "node:fs";
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

rmSync(outputDir, { recursive: true, force: true });
mkdirSync(outputDir, { recursive: true });
cpSync(rootSite, outputDir, { recursive: true });

for (const preview of ["vanilla", "framework"]) {
  rmSync(path.join(outputDir, preview), { recursive: true, force: true });
}

cpSync(vanillaSite, path.join(outputDir, "vanilla"), { recursive: true });
cpSync(frameworkSite, path.join(outputDir, "framework"), { recursive: true });

console.log(`Assembled Pages artifact at ${outputDir}`);
