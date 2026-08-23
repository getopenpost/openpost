import assert from "node:assert/strict";
import test from "node:test";

import {
  assessPackageVersionChange,
  assessRegistryVersion,
  compareVersions,
} from "./n8n-package-release.mjs";

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

test("unrelated changes do not require a package version increase", () => {
  assert.deepEqual(
    assessPackageVersionChange({
      changedFiles: ["backend/internal/jobs/worker.go"],
      currentVersion: "0.1.0",
      previousVersion: "0.1.0",
    }),
    { changed: false, initial: false, version: "0.1.0" },
  );
});

test("stable semantic versions compare numerically", () => {
  assert.equal(compareVersions("0.10.0", "0.9.9"), 1);
  assert.equal(compareVersions("1.0.0", "1.0.0"), 0);
  assert.equal(compareVersions("1.2.2", "1.2.10"), -1);
  assert.equal(compareVersions("0.1.0", "0.1.0-alpha.0"), 1);
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
