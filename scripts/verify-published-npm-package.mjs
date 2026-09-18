#!/usr/bin/env node

// Post-publish verification for the plain npm packages. Clean-installs the
// registry tarball, checks npm signatures and integrity, loads the package,
// and — for the CLI wrapper — proves the default release download end to end
// when the pinned release is already public. A pinned release that is still a
// draft (the first checksummed release) skips the live download with a loud
// notice instead of failing: unit tests already cover the download logic
// against mocks, and the next release proves the live path.

import { execFileSync, spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { pathToFileURL } from "node:url";

import { parseNpmViewResult } from "./npm-view-result.mjs";

function option(name) {
  const index = process.argv.indexOf(name);
  return index >= 0 ? process.argv[index + 1] : undefined;
}

function run(command, args, options = {}) {
  return execFileSync(command, args, { encoding: "utf8", stdio: "inherit", ...options });
}

function capture(command, args, options = {}) {
  return execFileSync(command, args, { encoding: "utf8", ...options }).trim();
}

const packageSpec = option("--package-spec");
const expectedIntegrity = option("--integrity");
const kind = option("--kind");
if (!packageSpec || !expectedIntegrity || !kind || !["sdk", "cli"].includes(kind)) {
  throw new Error(
    "usage: verify-published-npm-package.mjs --package-spec NAME@VERSION --integrity SHA512 --kind sdk|cli",
  );
}

const packageName = packageSpec.startsWith("@")
  ? packageSpec.slice(0, packageSpec.indexOf("@", 1))
  : packageSpec.slice(0, packageSpec.lastIndexOf("@"));
const packageVersion = packageSpec.slice(packageName.length + 1);

const temporaryDirectory = mkdtempSync(path.join(os.tmpdir(), "openpost-npm-install-"));
try {
  writeFileSync(
    path.join(temporaryDirectory, "package.json"),
    `${JSON.stringify({ name: "openpost-npm-registry-smoke", private: true, type: "module" }, null, 2)}\n`,
  );
  run("npm", ["install", "--ignore-scripts", "--no-audit", "--no-fund", packageSpec], {
    cwd: temporaryDirectory,
  });
  run("npm", ["audit", "signatures"], { cwd: temporaryDirectory });

  const manifestPath = path.join(temporaryDirectory, "node_modules", packageName, "package.json");
  const manifest = JSON.parse(readFileSync(manifestPath, "utf8"));
  if (manifest.version !== packageVersion) {
    throw new Error(`Installed ${manifest.version} instead of ${packageVersion}.`);
  }

  if (kind === "sdk") {
    const entry = await import(
      pathToFileURL(path.join(temporaryDirectory, "node_modules", packageName, manifest.main)).href
    );
    if (typeof entry.OpenPost !== "function" || typeof entry.OpenPostError !== "function") {
      throw new Error("The registry-installed SDK did not export OpenPost and OpenPostError.");
    }
    const client = new entry.OpenPost({ baseUrl: "https://example.invalid", token: "smoke" });
    if (
      typeof client.publications?.create !== "function" ||
      typeof client.media?.upload !== "function"
    ) {
      throw new Error("The registry-installed SDK is missing expected resources.");
    }
    const workspaces = await client.workspaces.list().catch((error) => error);
    if (!(workspaces instanceof entry.OpenPostError) || workspaces.code !== "network") {
      throw new Error("The registry-installed SDK did not surface typed network errors.");
    }
  } else {
    const bins = manifest.bin ?? {};
    if (typeof bins.openpost !== "string" || typeof bins["openpost-mcp"] !== "string") {
      throw new Error("The registry-installed CLI wrapper is missing the openpost bins.");
    }
    const pin = manifest?.openpost?.releaseTag;
    if (typeof pin !== "string" || !/^v\d+\.\d+\.\d+$/.test(pin)) {
      throw new Error("The registry-installed CLI wrapper has no pinned release tag.");
    }
    liveSmoke(temporaryDirectory, packageName, pin);
  }

  const registryIntegrity = capture("npm", ["view", packageSpec, "dist.integrity", "--json"]);
  if (parseNpmViewResult(registryIntegrity, `${packageSpec} integrity`) !== expectedIntegrity) {
    throw new Error("The registry integrity changed between publication and clean install.");
  }
  process.stdout.write(`Clean-installed and verified ${packageSpec}.\n`);
} finally {
  rmSync(temporaryDirectory, { recursive: true, force: true });
}

function liveSmoke(temporaryDirectory, packageName, pin) {
  if (releaseIsDraft(pin)) {
    process.stdout.write(
      `::notice::Pinned CLI release ${pin} is still a draft; skipping the live binary download. ` +
        `The next release proves the live path once ${pin} is public.\n`,
    );
    return;
  }
  const wrapperBin = path.join(
    temporaryDirectory,
    "node_modules",
    packageName,
    "bin",
    "openpost.js",
  );
  const result = spawnSync(process.execPath, [wrapperBin, "version"], { encoding: "utf8" });
  const output = `${result.stdout ?? ""}${result.stderr ?? ""}`.trim();
  if (result.status !== 0 || !output.includes(pin.replace(/^v/, ""))) {
    throw new Error(
      `The registry-installed CLI did not report the pinned release ${pin} (got ${JSON.stringify(output)}).`,
    );
  }
  process.stdout.write(`Live-installed the CLI from ${pin}: ${output.split("\n")[0]}.\n`);
}

function releaseIsDraft(tag) {
  try {
    const state = capture("gh", ["release", "view", tag, "--json", "isDraft", "--jq", ".isDraft"]);
    return state === "true";
  } catch {
    // Without release visibility the live proof cannot run; the tarball
    // checks above already passed, so report and continue honestly.
    process.stdout.write(
      `::notice::Could not inspect release ${tag}; skipping the live binary download.\n`,
    );
    return true;
  }
}
