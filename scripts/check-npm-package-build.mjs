#!/usr/bin/env node

// Guards the exact npm payload of the plain packages. `npm pack --dry-run`
// only inspects, so this script asserts the inputs that determine the
// tarball instead: the files allowlist, the built dist output with its
// required entries, and executable bin shims for the CLI wrapper. A missing
// dist or a stray files entry fails the gate before anything ships.

import { accessSync, constants, readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

const expectedFiles = {
  "packages/sdk": ["dist", "README.md", "LICENSE"],
  "packages/cli": ["bin", "dist", "README.md", "LICENSE"],
};

const expectedRootEntries = new Set([
  ".gitignore",
  "LICENSE",
  "README.md",
  "bin",
  "dist",
  "package.json",
  "src",
  "tsconfig.build.json",
  "tsconfig.json",
]);

export function checkPackageBuild(directory) {
  const problems = [];
  const allowed = expectedFiles[directory];
  if (!allowed) throw new Error(`Unknown npm package directory: ${directory}`);
  const packageRoot = path.join(root, directory);
  const manifest = JSON.parse(readFileSync(path.join(packageRoot, "package.json"), "utf8"));

  const files = manifest.files;
  if (JSON.stringify(files) !== JSON.stringify(allowed)) {
    problems.push(`${directory}/package.json files must be ${JSON.stringify(allowed)}.`);
  }

  for (const entry of readdirSync(packageRoot)) {
    if (entry === "node_modules") continue;
    if (!expectedRootEntries.has(entry)) {
      problems.push(
        `${directory} contains unexpected root entry ${entry}; it may leak into the tarball.`,
      );
    }
  }

  const dist = path.join(packageRoot, "dist");
  let distEntries = [];
  try {
    distEntries = readdirSync(dist);
  } catch {
    problems.push(`${directory}/dist is missing; run the package build before packing.`);
  }
  for (const required of ["index.js", "index.d.ts"]) {
    try {
      accessSync(path.join(dist, required), constants.R_OK);
    } catch {
      problems.push(
        `${directory}/dist/${required} is missing; the published entry would be broken.`,
      );
    }
  }
  if (distEntries.length === 0 && problems.length === 0) {
    problems.push(`${directory}/dist is empty; the published package would contain no code.`);
  }

  if (directory === "packages/cli") {
    for (const bin of ["bin/openpost.js", "bin/openpost-mcp.js"]) {
      const binPath = path.join(packageRoot, bin);
      try {
        const mode = statSync(binPath).mode;
        if ((mode & 0o111) === 0) problems.push(`${directory}/${bin} is not executable.`);
      } catch {
        problems.push(`${directory}/${bin} is missing.`);
      }
    }
    const bins = manifest.bin ?? {};
    if (bins.openpost !== "./bin/openpost.js" || bins["openpost-mcp"] !== "./bin/openpost-mcp.js") {
      problems.push(
        `${directory}/package.json bin entries must point at ./bin/openpost.js and ./bin/openpost-mcp.js.`,
      );
    }
  }

  return problems;
}

function main() {
  const directories = Object.keys(expectedFiles);
  const problems = directories.flatMap(checkPackageBuild);
  if (problems.length > 0) {
    for (const problem of problems) console.error(`npm payload: ${problem}`);
    process.exitCode = 1;
  } else {
    console.log("npm SDK and CLI payloads match their manifests and built output.");
  }
}

if (process.argv[1] === fileURLToPath(import.meta.url)) main();
