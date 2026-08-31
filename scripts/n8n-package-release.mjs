#!/usr/bin/env node

import { execFileSync, spawnSync } from "node:child_process";
import { appendFileSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { parseNpmPackResult } from "./npm-pack-result.mjs";
import { parseNpmViewResult } from "./npm-view-result.mjs";

export { parseNpmViewResult } from "./npm-view-result.mjs";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const packageDirectory = "packages/n8n-nodes-openpost";
const packageManifestPath = `${packageDirectory}/package.json`;
const stableVersionPattern = /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/u;
const versionPattern =
  /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(?:-([0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*))?$/u;

export function compareVersions(left, right) {
  const leftVersion = parseVersion(left);
  const rightVersion = parseVersion(right);
  for (let index = 0; index < leftVersion.parts.length; index += 1) {
    if (leftVersion.parts[index] > rightVersion.parts[index]) return 1;
    if (leftVersion.parts[index] < rightVersion.parts[index]) return -1;
  }
  if (leftVersion.prerelease === null && rightVersion.prerelease !== null) return 1;
  if (leftVersion.prerelease !== null && rightVersion.prerelease === null) return -1;
  if (leftVersion.prerelease !== rightVersion.prerelease) {
    return leftVersion.prerelease.localeCompare(rightVersion.prerelease);
  }
  return 0;
}

export function assessPackageVersionChange({ changedFiles, currentVersion, previousVersion }) {
  parseStableVersion(currentVersion);
  const changed = changedFiles.some((file) => file.startsWith(`${packageDirectory}/`));
  if (previousVersion === null) {
    return { changed, initial: true, version: currentVersion };
  }
  parseVersion(previousVersion);
  if (changed && currentVersion === previousVersion) {
    throw new Error(
      `Publishable n8n package files changed, so ${packageManifestPath} must increase the package version.`,
    );
  }
  if (compareVersions(currentVersion, previousVersion) < 0) {
    throw new Error(
      `n8n package version ${currentVersion} must be higher than ${previousVersion}.`,
    );
  }
  return { changed, initial: false, version: currentVersion };
}

export function assessRegistryVersion({ localIntegrity, metadata }) {
  if (!metadata) return { state: "absent" };
  if (metadata.integrity === localIntegrity) return { state: "matching" };
  return { state: "conflict", publishedIntegrity: metadata.integrity ?? null };
}

function parseStableVersion(version) {
  const match = stableVersionPattern.exec(version ?? "");
  if (!match) {
    throw new Error(
      `n8n package version ${JSON.stringify(version)} must be a stable semantic version.`,
    );
  }
  return match.slice(1).map(Number);
}

function parseVersion(version) {
  const match = versionPattern.exec(version ?? "");
  if (!match) throw new Error(`Invalid semantic version ${JSON.stringify(version)}.`);
  return { parts: match.slice(1, 4).map(Number), prerelease: match[4] ?? null };
}

function option(name) {
  const index = process.argv.indexOf(name);
  return index >= 0 ? process.argv[index + 1] : undefined;
}

function git(args, options = {}) {
  return execFileSync("git", args, { cwd: root, encoding: "utf8", ...options }).trim();
}

function currentManifest() {
  return JSON.parse(readFileSync(path.join(root, packageManifestPath), "utf8"));
}

function manifestAt(revision) {
  try {
    return JSON.parse(
      git(["show", `${revision}:${packageManifestPath}`], { stdio: ["ignore", "pipe", "ignore"] }),
    );
  } catch {
    return null;
  }
}

function checkVersion() {
  const base = option("--base");
  const head = option("--head") ?? "HEAD";
  if (!base) throw new Error("check-version requires --base REV [--head REV]");
  const changedFiles = git(["diff", "--name-only", "--no-renames", `${base}...${head}`])
    .split("\n")
    .filter(Boolean);
  const current = currentManifest();
  const previous = manifestAt(base);
  const result = assessPackageVersionChange({
    changedFiles,
    currentVersion: current.version,
    previousVersion: previous?.version ?? null,
  });
  process.stdout.write(
    `n8n package ${result.changed ? "changed" : "unchanged"} at ${current.name}@${result.version}.\n`,
  );
}

function npm(args, options = {}) {
  return spawnSync("npm", args, {
    cwd: root,
    encoding: "utf8",
    env: process.env,
    ...options,
  });
}

function registryMetadata(name, version) {
  const result = npm(["view", `${name}@${version}`, "name", "version", "dist.integrity", "--json"]);
  if (result.status === 0) {
    const value = parseNpmViewResult(result.stdout, name);
    if (typeof value !== "object") {
      throw new Error(`npm view did not return metadata for ${name}.`);
    }
    if (value.name !== name || value.version !== version) {
      throw new Error(`npm returned ${value.name}@${value.version} for ${name}@${version}.`);
    }
    return {
      name: value.name,
      version: value.version,
      integrity: value["dist.integrity"],
    };
  }
  if (/E404|404 Not Found|is not in this registry/u.test(result.stderr)) return null;
  throw new Error(`npm registry lookup failed:\n${result.stderr || result.stdout}`);
}

function requireMatchingRegistryVersion({ name, version, integrity, attempts = 1 }) {
  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    const assessment = assessRegistryVersion({
      localIntegrity: integrity,
      metadata: registryMetadata(name, version),
    });
    if (assessment.state === "matching") return true;
    if (assessment.state === "conflict") {
      throw new Error(
        `${name}@${version} already exists with integrity ${assessment.publishedIntegrity}; local integrity is ${integrity}. Increase the package version.`,
      );
    }
    if (attempt < attempts) execFileSync("sleep", ["5"]);
  }
  return false;
}

function output(name, value) {
  if (process.env.GITHUB_OUTPUT) appendFileSync(process.env.GITHUB_OUTPUT, `${name}=${value}\n`);
  else process.stdout.write(`${name}=${value}\n`);
}

function publish() {
  const manifest = currentManifest();
  parseStableVersion(manifest.version);
  const temporaryDirectory = mkdtempSync(path.join(os.tmpdir(), "openpost-n8n-package-"));
  try {
    const packed = npm(
      ["pack", "--json", "--ignore-scripts", "--pack-destination", temporaryDirectory],
      { cwd: path.join(root, packageDirectory) },
    );
    if (packed.status !== 0) throw new Error(`npm pack failed:\n${packed.stderr || packed.stdout}`);
    const pack = parseNpmPackResult(packed.stdout, manifest.name);
    if (!pack?.filename || !pack?.integrity)
      throw new Error("npm pack did not return a tarball integrity.");
    const tarball = path.join(temporaryDirectory, pack.filename);
    const existing = assessRegistryVersion({
      localIntegrity: pack.integrity,
      metadata: registryMetadata(manifest.name, manifest.version),
    });
    if (existing.state === "conflict") {
      throw new Error(
        `${manifest.name}@${manifest.version} already exists with different content. Increase the package version.`,
      );
    }
    let published = false;
    if (existing.state === "absent") {
      const result = npm(["publish", tarball, "--access", "public", "--provenance"], {
        stdio: "inherit",
      });
      if (result.status === 0) {
        published = true;
      } else if (
        !requireMatchingRegistryVersion({
          name: manifest.name,
          version: manifest.version,
          integrity: pack.integrity,
          attempts: 24,
        })
      ) {
        throw new Error(
          `npm publish failed with status ${result.status}, and ${manifest.name}@${manifest.version} did not appear after reconciliation. Do not retry without checking npm.`,
        );
      }
    }
    if (
      !requireMatchingRegistryVersion({
        name: manifest.name,
        version: manifest.version,
        integrity: pack.integrity,
        attempts: 24,
      })
    ) {
      throw new Error(`${manifest.name}@${manifest.version} did not become readable from npm.`);
    }
    output("package_name", manifest.name);
    output("package_version", manifest.version);
    output("package_spec", `${manifest.name}@${manifest.version}`);
    output("integrity", pack.integrity);
    output("published", published);
  } finally {
    rmSync(temporaryDirectory, { recursive: true, force: true });
  }
}

function main() {
  const command = process.argv[2];
  if (command === "check-version") checkVersion();
  else if (command === "publish") publish();
  else throw new Error("usage: n8n-package-release.mjs <check-version|publish>");
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  try {
    main();
  } catch (error) {
    console.error(`n8n-package-release: ${error.message}`);
    process.exitCode = 1;
  }
}
