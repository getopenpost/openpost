#!/usr/bin/env node

import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { createRequire } from "node:module";
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const packageRoot = path.join(root, "packages/n8n-nodes-openpost");
const manifest = JSON.parse(readFileSync(path.join(packageRoot, "package.json"), "utf8"));

assert.equal(manifest.name, "@getopenpost/n8n-nodes-openpost");
assert.match(manifest.version, /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/u);
assert.equal(manifest.repository.url, "git+https://github.com/getopenpost/openpost.git");
assert.equal(manifest.dependencies, undefined);
assert.deepEqual(Object.keys(manifest.peerDependencies), ["n8n-workflow"]);
assert.ok(manifest.files.includes("examples"));

const require = createRequire(path.join(packageRoot, "package.json"));
const loaded = require(path.join(packageRoot, manifest.main));
assert.equal(typeof loaded.OpenPost, "function");
const node = new loaded.OpenPost();
assert.equal(node.description.name, "openPost");
assert.equal(node.description.displayName, "OpenPost");
assert.equal(node.description.defaultVersion, 1);

for (const filename of ["list-workspaces.json", "create-draft.json"]) {
  const workflow = JSON.parse(readFileSync(path.join(packageRoot, "examples", filename), "utf8"));
  assert.equal(workflow.active, false);
  assert.ok(workflow.nodes.some((entry) => entry.type === "n8n-nodes-base.manualTrigger"));
  assert.ok(
    workflow.nodes.some((entry) => entry.type === "@getopenpost/n8n-nodes-openpost.openPost"),
  );
}

const [pack] = JSON.parse(
  execFileSync("npm", ["pack", "--dry-run", "--ignore-scripts", "--json"], {
    cwd: packageRoot,
    encoding: "utf8",
  }),
);
const allowedFiles = ["LICENSE", "README.md", "package.json"];
const allowedPrefixes = ["dist/", "docs/", "examples/", "icons/"];
for (const file of pack.files) {
  assert.ok(
    allowedFiles.includes(file.path) ||
      allowedPrefixes.some((prefix) => file.path.startsWith(prefix)),
    `Unexpected npm payload file: ${file.path}`,
  );
}
for (const required of [
  "LICENSE",
  "README.md",
  "package.json",
  manifest.main,
  "examples/list-workspaces.json",
  "examples/create-draft.json",
]) {
  assert.ok(
    pack.files.some((file) => file.path === required),
    `Missing npm payload file: ${required}`,
  );
}

process.stdout.write(
  `Loaded ${manifest.name}@${manifest.version} and validated ${pack.entryCount} npm payload files.\n`,
);
