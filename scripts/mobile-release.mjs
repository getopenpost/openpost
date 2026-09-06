#!/usr/bin/env bun

import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const stableVersionPattern = /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/u;
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

export function requireCurrentMobileIdentity(current, previous) {
  const versionComparison = Math.sign(compareVersions(current.version_name, previous.version_name));
  const codeComparison = Math.sign(current.version_code - previous.version_code);
  if (versionComparison !== codeComparison) {
    throw new Error("mobile version and Android version code must advance together");
  }
  if (versionComparison < 0) {
    throw new Error("mobile identity must not be older than released identity");
  }
}

export function nextMobileIdentity(current, previous) {
  requireCurrentMobileIdentity(current, previous);
  if (current.version_code > previous.version_code) return { ...current };

  const versionParts = current.version_name.split(".").map(Number);
  versionParts[2] += 1;
  return {
    version_name: versionParts.join("."),
    version_code: current.version_code + 1,
  };
}

export async function prepareMobileReleaseFiles({ configPath, packagePath, previousConfig }) {
  const [config, packageMetadata] = await Promise.all([
    readJSON(configPath),
    readJSON(packagePath),
  ]);
  const current = readMobileIdentity(config, packageMetadata);
  const previous = readMobileIdentity(previousConfig);
  const next = nextMobileIdentity(current, previous);

  config.expo.version = next.version_name;
  config.expo.android.versionCode = next.version_code;
  packageMetadata.version = next.version_name;
  await Promise.all([
    writeFile(path.resolve(configPath), `${JSON.stringify(config, null, 2)}\n`),
    writeFile(path.resolve(packagePath), `${JSON.stringify(packageMetadata, null, 2)}\n`),
  ]);
  return next;
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

async function main() {
  const { command, options } = parseArguments(process.argv.slice(2));
  if (!options.config) throw new Error("--config is required");
  const identity = await readConfiguredIdentity(options);

  if (command === "check" || command === "check-current") {
    if (options["previous-config"]) {
      const previous = readMobileIdentity(await readJSON(options["previous-config"]));
      if (command === "check-current") requireCurrentMobileIdentity(identity, previous);
      else requireMonotonicMobileIdentity(identity, previous);
    }
    process.stdout.write(`${identity.version_name} (${identity.version_code})\n`);
    return;
  }

  throw new Error("usage: mobile-release.mjs <check|check-current> --config FILE [options]");
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  main().catch((error) => {
    console.error(`mobile-release: ${error.message}`);
    process.exitCode = 1;
  });
}
