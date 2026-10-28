import assert from "node:assert/strict";
import test from "node:test";

import { assessPackageVersionChange, assessRegistryVersion } from "./n8n-package-release.mjs";

const packageFile = "packages/n8n-nodes-openpost/package.json";

test("the first package version can be added", () => {
  assert.deepEqual(
    assessPackageVersionChange({
      changedFiles: [packageFile],
      currentVersion: "0.1.0",
      previousVersion: null,
    }),
    { changed: true, initial: true, version: "0.1.0" },
  );
});

test("publishable package changes require a higher stable version", () => {
  assert.throws(
    () =>
      assessPackageVersionChange({
        changedFiles: ["packages/n8n-nodes-openpost/README.md"],
        currentVersion: "0.1.0",
        previousVersion: "0.1.0",
      }),
    /must increase the package version/u,
  );
  assert.throws(
    () =>
      assessPackageVersionChange({
        changedFiles: [packageFile],
        currentVersion: "0.1.0-alpha.1",
        previousVersion: "0.1.0-alpha.0",
      }),
    /stable semantic version/u,
  );
  assert.throws(
    () =>
      assessPackageVersionChange({
        changedFiles: [packageFile],
        currentVersion: "0.1.0",
        previousVersion: "0.2.0",
      }),
    /must be higher/u,
  );
});

test("a higher package version permits publishable changes", () => {
  assert.deepEqual(
    assessPackageVersionChange({
      changedFiles: ["packages/n8n-nodes-openpost/nodes/OpenPost/OpenPost.node.ts"],
      currentVersion: "0.2.0",
      previousVersion: "0.1.9",
    }),
    { changed: true, initial: false, version: "0.2.0" },
  );
});

test("compiler-excluded test files do not require a package version increase", () => {
  for (const testFile of [
    "packages/n8n-nodes-openpost/test/OpenPost.node.test.ts",
    "packages/n8n-nodes-openpost/test/unit/helper.ts",
    "packages/n8n-nodes-openpost/test/package-contract.test.ts",
  ]) {
    assert.deepEqual(
      assessPackageVersionChange({
        changedFiles: [testFile],
        currentVersion: "0.1.0",
        previousVersion: "0.1.0",
      }),
      { changed: false, initial: false, version: "0.1.0" },
      testFile,
    );
  }
});

test("production, build configuration, README, and non-excluded test-looking files stay publishable", () => {
  for (const changedFile of [
    "packages/n8n-nodes-openpost/nodes/OpenPost/OpenPost.node.ts",
    "packages/n8n-nodes-openpost/credentials/OpenPostApi.credentials.ts",
    "packages/n8n-nodes-openpost/tsconfig.json",
    "packages/n8n-nodes-openpost/README.md",
    "packages/n8n-nodes-openpost/tests/helper.ts",
    "packages/n8n-nodes-openpost/test-helper.ts",
  ]) {
    assert.throws(
      () =>
        assessPackageVersionChange({
          changedFiles: [changedFile],
          currentVersion: "0.1.0",
          previousVersion: "0.1.0",
        }),
      /must increase the package version/u,
      changedFile,
    );
  }
});

test("mixed test-only and publishable changes still require a higher version", () => {
  for (const changedFiles of [
    [
      "packages/n8n-nodes-openpost/test/unit/helper.ts",
      "packages/n8n-nodes-openpost/tsconfig.json",
    ],
    ["packages/n8n-nodes-openpost/test/unit/helper.ts", "packages/n8n-nodes-openpost/README.md"],
    // `--no-renames` reports both sides of a rename; the production side remains publishable.
    [
      "packages/n8n-nodes-openpost/test/legacy.test.ts",
      "packages/n8n-nodes-openpost/nodes/OpenPost/OpenPost.node.ts",
    ],
  ]) {
    assert.throws(
      () =>
        assessPackageVersionChange({
          changedFiles,
          currentVersion: "0.1.0",
          previousVersion: "0.1.0",
        }),
      /must increase the package version/u,
      changedFiles.join(", "),
    );
  }
});

test("unrelated changes do not require a package version increase", () => {
  assert.deepEqual(
    assessPackageVersionChange({
      changedFiles: ["apps/server/internal/jobs/worker.go"],
      currentVersion: "0.1.0",
      previousVersion: "0.1.0",
    }),
    { changed: false, initial: false, version: "0.1.0" },
  );
});

test("registry reconciliation distinguishes absent, matching, and conflicting versions", () => {
  const integrity = "sha512-local";
  assert.deepEqual(assessRegistryVersion({ localIntegrity: integrity, metadata: null }), {
    state: "absent",
  });
  assert.deepEqual(
    assessRegistryVersion({
      localIntegrity: integrity,
      metadata: { name: "@getopenpost/n8n-nodes-openpost", version: "0.1.0", integrity },
    }),
    { state: "matching" },
  );
  assert.deepEqual(
    assessRegistryVersion({
      localIntegrity: integrity,
      metadata: {
        name: "@getopenpost/n8n-nodes-openpost",
        version: "0.1.0",
        integrity: "sha512-other",
      },
    }),
    { state: "conflict", publishedIntegrity: "sha512-other" },
  );
});
