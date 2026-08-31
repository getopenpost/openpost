#!/usr/bin/env bun

import { createHash } from "node:crypto";
import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const stableVersionPattern = /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/u;
const revisionPattern = /^[0-9a-f]{40}$/u;
const digestPattern = /^sha256:[0-9a-f]{64}$/u;
const manifestKeys = ["apk_sha256", "revision", "schema_version", "version_code", "version_name"];

export function readMobileIdentity(config, packageMetadata = undefined) {
  const versionName = String(config?.expo?.version ?? "").trim();
  const versionCode = config?.expo?.android?.versionCode;
  if (!stableVersionPattern.test(versionName)) {
    throw new Error(
      `mobile version name must be stable SemVer, received ${JSON.stringify(versionName)}`,
    );
  }
  if (!Number.isSafeInteger(versionCode) || versionCode <= 0) {
    throw new Error("Android version code must be a positive integer");
  }
  if (packageMetadata && packageMetadata.version !== versionName) {
    throw new Error(
      `mobile package version ${JSON.stringify(packageMetadata.version)} does not match Expo version ${versionName}`,
    );
  }
  return { version_name: versionName, version_code: versionCode };
}

export function requireMonotonicMobileIdentity(current, previous) {
  if (current.version_code <= previous.version_code) {
    throw new Error(
      `Android version code ${current.version_code} must be greater than released code ${previous.version_code}`,
    );
  }
  if (compareVersions(current.version_name, previous.version_name) <= 0) {
    throw new Error(
      `mobile version ${current.version_name} must be greater than released version ${previous.version_name}`,
    );
  }
}

export function createMobileReleaseManifest({ identity, revision, apkSHA256 }) {
  const manifest = {
    schema_version: 1,
    version_name: identity.version_name,
    version_code: identity.version_code,
    revision: String(revision ?? "").trim(),
    apk_sha256: String(apkSHA256 ?? "").trim(),
  };
  return validateMobileReleaseManifest(manifest);
}

export function validateMobileReleaseManifest(
  manifest,
  { expectedIdentity, expectedRevision, expectedAPKDigest } = {},
) {
  if (!manifest || typeof manifest !== "object" || Array.isArray(manifest)) {
    throw new Error("mobile release manifest must be a JSON object");
  }
  const keys = Object.keys(manifest).sort();
  if (
    keys.length !== manifestKeys.length ||
    keys.some((key, index) => key !== manifestKeys[index])
  ) {
    throw new Error(`mobile release manifest must contain exactly ${manifestKeys.join(", ")}`);
  }
  if (manifest.schema_version !== 1) throw new Error("mobile release manifest schema must be 1");
  readMobileIdentity({
    expo: { version: manifest.version_name, android: { versionCode: manifest.version_code } },
  });
  if (!revisionPattern.test(manifest.revision)) {
    throw new Error("mobile release revision must be a full lowercase Git SHA");
  }
  if (!digestPattern.test(manifest.apk_sha256)) {
    throw new Error("mobile release APK digest must be sha256");
  }
  if (
    expectedIdentity &&
    (manifest.version_name !== expectedIdentity.version_name ||
      manifest.version_code !== expectedIdentity.version_code)
  ) {
    throw new Error("mobile release identity does not match the checked-in app config");
  }
  if (expectedRevision && manifest.revision !== expectedRevision) {
    throw new Error(
      `mobile release revision ${manifest.revision} does not match ${expectedRevision}`,
    );
  }
  if (expectedAPKDigest && manifest.apk_sha256 !== expectedAPKDigest) {
    throw new Error("mobile release APK digest does not match the candidate");
  }
  return manifest;
}

export function serializeMobileReleaseManifest(manifest) {
  validateMobileReleaseManifest(manifest);
  return `${JSON.stringify(manifest, null, 2)}\n`;
}

function compareVersions(left, right) {
  const leftParts = left.split(".").map(Number);
  const rightParts = right.split(".").map(Number);
  for (let index = 0; index < 3; index += 1) {
    if (leftParts[index] !== rightParts[index]) return leftParts[index] - rightParts[index];
  }
  return 0;
}

function parseArguments(argv) {
  const [command, ...rest] = argv;
  const options = {};
  for (let index = 0; index < rest.length; index += 2) {
    const key = rest[index];
    const value = rest[index + 1];
    if (!key?.startsWith("--") || !value || value.startsWith("--")) {
      throw new Error(`invalid argument ${JSON.stringify(key)}`);
    }
    options[key.slice(2)] = value;
  }
  return { command, options };
}

async function readJSON(file) {
  return JSON.parse(await readFile(path.resolve(file), "utf8"));
}

async function readConfiguredIdentity(options) {
  const [config, packageMetadata] = await Promise.all([
    readJSON(options.config),
    options.package ? readJSON(options.package) : undefined,
  ]);
  return readMobileIdentity(config, packageMetadata);
}

async function digestFile(file) {
  return `sha256:${createHash("sha256")
    .update(await readFile(path.resolve(file)))
    .digest("hex")}`;
}

async function main() {
  const { command, options } = parseArguments(process.argv.slice(2));
  if (!options.config) throw new Error("--config is required");
  const identity = await readConfiguredIdentity(options);

  if (command === "check") {
    if (options["previous-config"]) {
      const previous = readMobileIdentity(await readJSON(options["previous-config"]));
      requireMonotonicMobileIdentity(identity, previous);
    }
    process.stdout.write(`${identity.version_name} (${identity.version_code})\n`);
    return;
  }

  if (!options.revision || !options.apk) {
    throw new Error("--revision and --apk are required");
  }
  const apkSHA256 = await digestFile(options.apk);
  if (command === "create") {
    if (!options.output) throw new Error("--output is required");
    const manifest = createMobileReleaseManifest({
      identity,
      revision: options.revision,
      apkSHA256,
    });
    await writeFile(path.resolve(options.output), serializeMobileReleaseManifest(manifest));
    process.stdout.write(`${path.resolve(options.output)}\n`);
    return;
  }
  if (command === "verify") {
    if (!options.manifest) throw new Error("--manifest is required");
    validateMobileReleaseManifest(await readJSON(options.manifest), {
      expectedIdentity: identity,
      expectedRevision: options.revision,
      expectedAPKDigest: apkSHA256,
    });
    process.stdout.write(`${identity.version_name} (${identity.version_code}) ${apkSHA256}\n`);
    return;
  }
  throw new Error("usage: mobile-release.mjs <check|create|verify> --config FILE [options]");
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  main().catch((error) => {
    console.error(`mobile-release: ${error.message}`);
    process.exitCode = 1;
  });
}
