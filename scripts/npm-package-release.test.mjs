import assert from "node:assert/strict";
import test from "node:test";

import {
  assessPackageVersionChange,
  assessRegistryVersion,
  compareVersions,
} from "./npm-package-release.mjs";

const sdkFile = "packages/sdk/package.json";
const cliFile = "packages/cli/package.json";

test("stable versions compare numerically with prerelease awareness", () => {
  assert.equal(compareVersions("0.1.0", "0.1.0"), 0);
  assert.equal(compareVersions("0.2.0", "0.1.9"), 1);
  assert.equal(compareVersions("0.1.0", "0.1.1"), -1);
  assert.throws(() => compareVersions("v1", "0.1.0"), /Invalid semantic version/u);
});

test("the first SDK version can be added", () => {
  assert.deepEqual(
    assessPackageVersionChange({
      packageDirectory: "packages/sdk",
      changedFiles: [sdkFile],
      currentVersion: "0.1.0",
      previousVersion: null,
    }),
    { changed: true, initial: true, version: "0.1.0" },
  );
});

test("publishable CLI changes require a version increase", () => {
  assert.throws(
    () =>
      assessPackageVersionChange({
        packageDirectory: "packages/cli",
        changedFiles: [cliFile],
        currentVersion: "0.1.0",
        previousVersion: "0.1.0",
      }),
    /must increase the package version/u,
  );
  assert.deepEqual(
    assessPackageVersionChange({
      packageDirectory: "packages/cli",
      changedFiles: [cliFile],
      currentVersion: "0.1.1",
      previousVersion: "0.1.0",
    }),
    { changed: true, initial: false, version: "0.1.1" },
  );
});

test("unrelated changes do not force a version increase", () => {
  assert.deepEqual(
    assessPackageVersionChange({
      packageDirectory: "packages/sdk",
      changedFiles: ["apps/server/go.mod"],
      currentVersion: "0.1.0",
      previousVersion: "0.1.0",
    }),
    { changed: false, initial: false, version: "0.1.0" },
  );
});

test("versions never move backwards and stay stable", () => {
  assert.throws(
    () =>
      assessPackageVersionChange({
        packageDirectory: "packages/sdk",
        changedFiles: [sdkFile],
        currentVersion: "0.1.0",
        previousVersion: "0.2.0",
      }),
    /must be higher/u,
  );
  assert.throws(
    () =>
      assessPackageVersionChange({
        packageDirectory: "packages/sdk",
        changedFiles: [sdkFile],
        currentVersion: "0.1.0-beta.1",
        previousVersion: null,
      }),
    /must be a stable semantic version/u,
  );
});

test("registry reconciliation distinguishes absent, matching, and conflict", () => {
  assert.deepEqual(assessRegistryVersion({ localIntegrity: "sha512-a", metadata: null }), {
    state: "absent",
  });
  assert.deepEqual(
    assessRegistryVersion({ localIntegrity: "sha512-a", metadata: { integrity: "sha512-a" } }),
    { state: "matching" },
  );
  assert.deepEqual(
    assessRegistryVersion({ localIntegrity: "sha512-a", metadata: { integrity: "sha512-b" } }),
    { state: "conflict", publishedIntegrity: "sha512-b" },
  );
});
