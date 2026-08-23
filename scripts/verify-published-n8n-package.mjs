#!/usr/bin/env node

import { execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { createRequire } from "node:module";

function option(name) {
  const index = process.argv.indexOf(name);
  return index >= 0 ? process.argv[index + 1] : undefined;
}

function run(command, args, options = {}) {
  return execFileSync(command, args, { encoding: "utf8", stdio: "inherit", ...options });
}

const packageSpec = option("--package-spec");
const expectedIntegrity = option("--integrity");
const n8nVersion = option("--n8n-version");
if (!packageSpec || !expectedIntegrity || !n8nVersion) {
  throw new Error(
    "usage: verify-published-n8n-package.mjs --package-spec NAME@VERSION --integrity SHA512 --n8n-version VERSION",
  );
}

const temporaryDirectory = mkdtempSync(path.join(os.tmpdir(), "openpost-n8n-install-"));
try {
  writeFileSync(
    path.join(temporaryDirectory, "package.json"),
    `${JSON.stringify({ name: "openpost-n8n-registry-smoke", private: true }, null, 2)}\n`,
  );
  run(
    "npm",
    ["install", "--ignore-scripts", "--no-audit", "--no-fund", `n8n@${n8nVersion}`, packageSpec],
    { cwd: temporaryDirectory },
  );
  run("npm", ["audit", "signatures"], { cwd: temporaryDirectory });

  const packageName = packageSpec.startsWith("@")
    ? packageSpec.slice(0, packageSpec.indexOf("@", 1))
    : packageSpec.slice(0, packageSpec.lastIndexOf("@"));
  const require = createRequire(path.join(temporaryDirectory, "package.json"));
  const manifestPath = require.resolve(`${packageName}/package.json`);
  const manifest = JSON.parse(readFileSync(manifestPath, "utf8"));
  const loaded = require(path.join(path.dirname(manifestPath), manifest.main));
  const node = new loaded.OpenPost();
  if (node.description.name !== "openPost" || node.description.defaultVersion !== 1) {
    throw new Error(
      "The registry-installed OpenPost node did not expose the expected node contract.",
    );
  }
  const registryIntegrity = execFileSync("npm", ["view", packageSpec, "dist.integrity", "--json"], {
    encoding: "utf8",
  }).trim();
  if (JSON.parse(registryIntegrity) !== expectedIntegrity) {
    throw new Error("The registry integrity changed between publication and clean install.");
  }
  process.stdout.write(`Clean-installed and loaded ${packageSpec} with n8n ${n8nVersion}.\n`);
} finally {
  rmSync(temporaryDirectory, { recursive: true, force: true });
}
