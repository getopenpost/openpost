import assert from "node:assert/strict";
import { mkdtemp, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import {
  candidateVersionFromChangelog,
  createReleaseManifest,
  readReleaseManifest,
  resolveCandidateVersion,
  serializeReleaseManifest,
  validateReleaseManifest,
} from "./release-manifest.mjs";

const revision = "0123456789abcdef0123456789abcdef01234567";
const providerClaims = {
  schema_version: 1,
  manifest_sha256: `sha256:${"a".repeat(64)}`,
  claim_count: 0,
};

test("derives the prepared candidate version from the canonical changelog", () => {
  assert.equal(
    candidateVersionFromChangelog(`# Changelog

## [Unreleased]

## [4.2.0] - 2026-08-09

### Added

- A release boundary.
`),
    "v4.2.0",
  );
});

test("rejects changelogs without an adjacent stable release", () => {
  assert.throws(
    () => candidateVersionFromChangelog("## [Unreleased]\n"),
    /stable SemVer release/,
  );
  assert.throws(
    () =>
      candidateVersionFromChangelog(
        "## [Current]\n\n## [1.2.3] - 2026-08-09\n",
      ),
    /must begin with \[Unreleased\]/,
  );
});

test("derives ordinary candidates and preserves an explicit prepared version", () => {
  assert.equal(
    resolveCandidateVersion({
      changelogVersion: "v4.1.0",
      latestTag: "v4.1.0",
      commitMessages: ["fix: repair release checks"],
    }),
    "v4.1.1",
  );
  assert.equal(
    resolveCandidateVersion({
      changelogVersion: "v5.0.0",
      latestTag: "v4.1.0",
      commitMessages: ["fix: repair release checks"],
    }),
    "v5.0.0",
  );
  assert.throws(
    () =>
      resolveCandidateVersion({
        changelogVersion: "v4.0.0",
        latestTag: "v4.1.0",
        commitMessages: ["fix: repair release checks"],
      }),
    /older than latest tag/,
  );
  assert.throws(
    () =>
      resolveCandidateVersion({
        changelogVersion: "v4.1.1",
        latestTag: "v4.1.0",
        commitMessages: ["feat: add release manifests"],
      }),
    /lower than required v4.2.0/,
  );
});

test("serializes one strict versioned release manifest", () => {
  const manifest = createReleaseManifest({ version: "v4.2.0", revision, providerClaims });
  assert.deepEqual(manifest, {
    schema_version: 2,
    version: "v4.2.0",
    revision,
    provider_claims: providerClaims,
  });
  assert.equal(
    serializeReleaseManifest(manifest),
    `{
  "schema_version": 2,
  "version": "v4.2.0",
  "revision": "${revision}",
  "provider_claims": {
    "schema_version": 1,
    "manifest_sha256": "sha256:${"a".repeat(64)}",
    "claim_count": 0
  }
}\n`,
  );
});

test("fails closed on unstable versions, abbreviated revisions, and extra fields", () => {
  assert.throws(
    () => createReleaseManifest({ version: "candidate-012345", revision, providerClaims }),
    /stable SemVer/,
  );
  assert.throws(
    () => createReleaseManifest({ version: "v4.2.0", revision: "012345", providerClaims }),
    /full lowercase Git SHA/,
  );
  assert.throws(
    () =>
      validateReleaseManifest({
        schema_version: 2,
        version: "v4.2.0",
        revision,
        provider_claims: providerClaims,
        channel: "stable",
      }),
    /contain exactly/,
  );
});

test("verifies the intended version and exact candidate revision", async () => {
  const directory = await mkdtemp(
    path.join(os.tmpdir(), "openpost-release-manifest-"),
  );
  const manifestPath = path.join(directory, "release-manifest.json");
  await writeFile(
    manifestPath,
    serializeReleaseManifest(
      createReleaseManifest({ version: "v4.2.0", revision, providerClaims }),
    ),
  );

  await readReleaseManifest(manifestPath, {
    expectedVersion: "v4.2.0",
    expectedRevision: revision,
    expectedProviderClaims: providerClaims,
  });
  await assert.rejects(
    readReleaseManifest(manifestPath, { expectedVersion: "v4.2.1" }),
    /does not match v4.2.1/,
  );
  await assert.rejects(
    readReleaseManifest(manifestPath, {
      expectedRevision: "fedcba9876543210fedcba9876543210fedcba98",
    }),
    /does not match/,
  );
});
