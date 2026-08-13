#!/usr/bin/env bun

import { execFileSync } from "node:child_process";
import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { pathToFileURL } from "node:url";

import { parseChangelog } from "../packages/changelog/src/index.js";
import { compareVersions, resolveNextTag } from "./next-release-version.mjs";
import {
  publicClaimManifestPath,
  readPublicClaimManifestBinding,
} from "./provider-certification-manifest.mjs";

export const releaseManifestSchemaVersion = 2;

const stableVersionPattern = /^v(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/;
const gitRevisionPattern = /^[0-9a-f]{40}$/;
const manifestKeys = [
  "provider_claims",
  "revision",
  "schema_version",
  "version",
];

export function candidateVersionFromChangelog(markdown) {
  const sections = parseChangelog(markdown);
  if (sections[0]?.label !== "Unreleased") {
    throw new Error("CHANGELOG.md must begin with [Unreleased]");
  }
  const release = sections[1];
  const version = release ? `v${release.label.replace(/^v/u, "")}` : "";
  if (!stableVersionPattern.test(version)) {
    throw new Error(
      "CHANGELOG.md must place a stable SemVer release directly after [Unreleased]",
    );
  }
  return version;
}

export function resolveCandidateVersion({
  changelogVersion,
  latestTag,
  commitMessages,
}) {
  const comparison = compareVersions(changelogVersion, latestTag);
  if (comparison < 0) {
    throw new Error(
      `CHANGELOG.md release ${changelogVersion} is older than latest tag ${latestTag}`,
    );
  }
  const requiredVersion = resolveNextTag(latestTag, commitMessages);
  if (comparison === 0) return requiredVersion;
  if (compareVersions(changelogVersion, requiredVersion) < 0) {
    throw new Error(
      `prepared release ${changelogVersion} is lower than required ${requiredVersion}`,
    );
  }
  return changelogVersion;
}

export function createReleaseManifest({ version, revision, providerClaims }) {
  const manifest = {
    schema_version: releaseManifestSchemaVersion,
    version: String(version ?? "").trim(),
    revision: String(revision ?? "").trim(),
    provider_claims: providerClaims,
  };
  validateReleaseManifest(manifest);
  return manifest;
}

export function validateReleaseManifest(
  manifest,
  { expectedVersion, expectedRevision, expectedProviderClaims } = {},
) {
  if (!manifest || typeof manifest !== "object" || Array.isArray(manifest)) {
    throw new Error("release manifest must be a JSON object");
  }
  const keys = Object.keys(manifest).sort();
  if (
    keys.length !== manifestKeys.length ||
    keys.some((key, index) => key !== manifestKeys[index])
  ) {
    throw new Error(
      `release manifest must contain exactly ${manifestKeys.join(", ")}`,
    );
  }
  if (manifest.schema_version !== releaseManifestSchemaVersion) {
    throw new Error(
      `unsupported release manifest schema ${JSON.stringify(manifest.schema_version)}`,
    );
  }
  if (!stableVersionPattern.test(manifest.version)) {
    throw new Error(
      `release manifest version must be stable SemVer, received ${JSON.stringify(manifest.version)}`,
    );
  }
  if (!gitRevisionPattern.test(manifest.revision)) {
    throw new Error(
      `release manifest revision must be a full lowercase Git SHA, received ${JSON.stringify(manifest.revision)}`,
    );
  }
  validateProviderClaimBinding(manifest.provider_claims);
  if (expectedVersion && manifest.version !== expectedVersion) {
    throw new Error(
      `release manifest version ${manifest.version} does not match ${expectedVersion}`,
    );
  }
  if (expectedRevision && manifest.revision !== expectedRevision) {
    throw new Error(
      `release manifest revision ${manifest.revision} does not match ${expectedRevision}`,
    );
  }
  if (
    expectedProviderClaims &&
    JSON.stringify(manifest.provider_claims) !==
      JSON.stringify(expectedProviderClaims)
  ) {
    throw new Error(
      "release manifest provider claim binding does not match the checked-in certification manifest",
    );
  }
  return manifest;
}

function validateProviderClaimBinding(binding) {
  if (!binding || typeof binding !== "object" || Array.isArray(binding)) {
    throw new Error("release manifest provider_claims must be an object");
  }
  const keys = Object.keys(binding).sort();
  const expected = ["claim_count", "manifest_sha256", "schema_version"];
  if (
    keys.length !== expected.length ||
    keys.some((key, index) => key !== expected[index])
  ) {
    throw new Error(
      `release manifest provider_claims must contain exactly ${expected.join(", ")}`,
    );
  }
  if (binding.schema_version !== 1) {
    throw new Error("release manifest provider claim schema must be 1");
  }
  if (!/^sha256:[0-9a-f]{64}$/u.test(binding.manifest_sha256)) {
    throw new Error("release manifest provider claim digest must be sha256");
  }
  if (!Number.isSafeInteger(binding.claim_count) || binding.claim_count < 0) {
    throw new Error("release manifest provider claim count must be a non-negative integer");
  }
}

export function serializeReleaseManifest(manifest) {
  validateReleaseManifest(manifest);
  return `${JSON.stringify(manifest, null, 2)}\n`;
}

export async function readReleaseManifest(
  manifestPath,
  expectations = undefined,
) {
  let manifest;
  try {
    manifest = JSON.parse(await readFile(manifestPath, "utf8"));
  } catch (error) {
    throw new Error(
      `could not read release manifest ${manifestPath}: ${error.message}`,
    );
  }
  return validateReleaseManifest(manifest, expectations);
}

function parseArguments(argv) {
  const [command, ...rest] = argv;
  const options = {};
  for (let index = 0; index < rest.length; index += 1) {
    const key = rest[index];
    if (!key?.startsWith("--")) {
      throw new Error(`unexpected argument ${JSON.stringify(key)}`);
    }
    const value = rest[index + 1];
    if (!value || value.startsWith("--")) {
      throw new Error(`${key} requires a value`);
    }
    const name = key.slice(2);
    if (Object.hasOwn(options, name)) {
      throw new Error(`${key} may only be supplied once`);
    }
    options[name] = value;
    index += 1;
  }
  return { command, options };
}

async function main() {
  const { command, options } = parseArguments(process.argv.slice(2));
  if (command === "create") {
    requireOnlyOptions(options, [
      "changelog",
      "latest-tag",
      "output",
      "range",
      "revision",
      "version",
      "provider-claims",
    ]);
    if (options.version && (options.changelog || options["latest-tag"])) {
      throw new Error("--version cannot be combined with changelog derivation");
    }
    if (options.range && !options["latest-tag"]) {
      throw new Error("--range requires --latest-tag");
    }
    const revision = options.revision;
    let version = options.version;
    if (!version) {
      const changelogVersion = candidateVersionFromChangelog(
        await readFile(options.changelog ?? "CHANGELOG.md", "utf8"),
      );
      if (options["latest-tag"]) {
        const range = options.range ?? `${options["latest-tag"]}..${revision}`;
        const output = execFileSync("git", ["log", "--format=%B%x1e", range], {
          encoding: "utf8",
          stdio: ["ignore", "pipe", "inherit"],
        });
        const commitMessages = output
          .split("\x1e")
          .map((message) => message.trim())
          .filter(Boolean);
        version = resolveCandidateVersion({
          changelogVersion,
          latestTag: options["latest-tag"],
          commitMessages,
        });
      } else {
        version = changelogVersion;
      }
    }
    const providerClaims = await readPublicClaimManifestBinding(
      path.resolve(options["provider-claims"] ?? publicClaimManifestPath),
      { currentRevision: revision },
    );
    const manifest = createReleaseManifest({ version, revision, providerClaims });
    const output = path.resolve(options.output ?? "release-manifest.json");
    await writeFile(output, serializeReleaseManifest(manifest));
    process.stdout.write(`${output}\n`);
    return;
  }
  if (command === "verify") {
    requireOnlyOptions(options, ["manifest", "provider-claims", "revision", "version"]);
    const manifestPath = path.resolve(
      options.manifest ?? "release-manifest.json",
    );
    const expectedProviderClaims = await readPublicClaimManifestBinding(
      path.resolve(options["provider-claims"] ?? publicClaimManifestPath),
      { currentRevision: options.revision },
    );
    const manifest = await readReleaseManifest(manifestPath, {
      expectedVersion: options.version,
      expectedRevision: options.revision,
      expectedProviderClaims,
    });
    process.stdout.write(`${manifest.version} ${manifest.revision}\n`);
    return;
  }
  throw new Error(
    "usage: release-manifest.mjs create [--changelog FILE [--latest-tag vX.Y.Z] | --version vX.Y.Z] --revision SHA [--provider-claims FILE] [--output FILE]\n" +
      "   or: release-manifest.mjs verify --manifest FILE [--provider-claims FILE] [--version vX.Y.Z] [--revision SHA]",
  );
}

function requireOnlyOptions(options, allowed) {
  const allowedNames = new Set(allowed);
  const unexpected = Object.keys(options).find(
    (name) => !allowedNames.has(name),
  );
  if (unexpected) throw new Error(`unknown option --${unexpected}`);
}

if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(process.argv[1]).href
) {
  try {
    await main();
  } catch (error) {
    console.error(`release-manifest: ${error.message}`);
    process.exitCode = 1;
  }
}
