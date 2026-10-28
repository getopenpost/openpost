import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";

import {
  assessPackageVersionChange,
  assessRegistryVersion,
  compareVersions,
  publishablePackages,
} from "./npm-package-release.mjs";

const sdkFile = "packages/sdk/package.json";
const cliFile = "packages/cli/package.json";

test("stable versions compare numerically and reject invalid input", () => {
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

test("compiler-excluded test files do not force a version increase", () => {
  for (const [packageDirectory, testFile] of [
    ["packages/sdk", "packages/sdk/src/client.test.ts"],
    ["packages/sdk", "packages/sdk/src/resources/accounts.test.ts"],
    ["packages/cli", "packages/cli/src/run.test.ts"],
    ["packages/cli", "packages/cli/src/commands/schedule.test.ts"],
  ]) {
    assert.deepEqual(
      assessPackageVersionChange({
        packageDirectory,
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
    "packages/sdk/src/client.ts",
    "packages/sdk/src/testing/mock.ts",
    "packages/sdk/tsconfig.build.json",
    "packages/sdk/README.md",
    "packages/sdk/test/client.test.ts",
    "packages/cli/src/run.ts",
    "packages/cli/package.json",
    "packages/cli/README.md",
  ]) {
    const packageDirectory = changedFile.startsWith("packages/sdk/")
      ? "packages/sdk"
      : "packages/cli";
    assert.throws(
      () =>
        assessPackageVersionChange({
          packageDirectory,
          changedFiles: [changedFile],
          currentVersion: "0.1.0",
          previousVersion: "0.1.0",
        }),
      /must increase the package version/u,
      changedFile,
    );
  }
});

test("mixed test-only and publishable changes still force a version increase", () => {
  for (const changedFiles of [
    ["packages/sdk/src/client.test.ts", "packages/sdk/src/client.ts"],
    ["packages/sdk/src/client.test.ts", "packages/sdk/tsconfig.build.json"],
    ["packages/sdk/src/client.test.ts", "packages/sdk/README.md"],
    ["packages/cli/src/run.test.ts", "packages/cli/package.json"],
    // `--no-renames` reports both sides of a rename; the production side remains publishable.
    ["packages/sdk/src/removed.ts", "packages/sdk/src/removed.test.ts"],
  ]) {
    assert.throws(
      () =>
        assessPackageVersionChange({
          packageDirectory: changedFiles[0].startsWith("packages/sdk/")
            ? "packages/sdk"
            : "packages/cli",
          changedFiles,
          currentVersion: "0.1.0",
          previousVersion: "0.1.0",
        }),
      /must increase the package version/u,
      changedFiles.join(", "),
    );
  }
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

test("the shared script publishes only the SDK and CLI wrapper (n8n keeps its own script)", () => {
  assert.deepEqual(publishablePackages, {
    "packages/sdk": "@getopenpost/sdk",
    "packages/cli": "@getopenpost/cli",
  });
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

for (const publishStatus of [0, 1]) {
  test(`publication reconciles a registry version readable after three minutes (publish exit ${publishStatus})`, () => {
    const temporaryDirectory = mkdtempSync(path.join(os.tmpdir(), "openpost-registry-delay-"));
    const manifest = JSON.parse(
      readFileSync(new URL("../packages/sdk/package.json", import.meta.url), "utf8"),
    );
    const metadata = JSON.stringify({
      name: manifest.name,
      version: manifest.version,
      "dist.integrity": "sha512-matching-package",
    });
    try {
      writeFileSync(path.join(temporaryDirectory, "elapsed"), "0");
      writeFileSync(
        path.join(temporaryDirectory, "npm"),
        `#!/bin/sh
case "$1" in
  pack) echo '[{"filename":"sdk.tgz","integrity":"sha512-matching-package"}]' ;;
  publish) echo publish >> "$REGISTRY_FIXTURE/publishes"; exit ${publishStatus} ;;
  view)
    elapsed=$(cat "$REGISTRY_FIXTURE/elapsed")
    if [ "$elapsed" -ge 180 ]; then
      echo '${metadata}'
    else
      echo 'E404 Not Found' >&2
      exit 1
    fi ;;
  *) exit 99 ;;
esac
`,
        { mode: 0o700 },
      );
      writeFileSync(
        path.join(temporaryDirectory, "sleep"),
        `#!/bin/sh
elapsed=$(cat "$REGISTRY_FIXTURE/elapsed")
echo "$((elapsed + $1))" > "$REGISTRY_FIXTURE/elapsed"
`,
        { mode: 0o700 },
      );
      const result = spawnSync(
        "node",
        [
          fileURLToPath(new URL("./npm-package-release.mjs", import.meta.url)),
          "publish",
          "--package",
          "packages/sdk",
        ],
        {
          encoding: "utf8",
          env: {
            ...process.env,
            PATH: `${temporaryDirectory}${path.delimiter}${process.env.PATH}`,
            REGISTRY_FIXTURE: temporaryDirectory,
            GITHUB_OUTPUT: path.join(temporaryDirectory, "output"),
          },
        },
      );
      assert.equal(result.status, 0, result.stderr);
      assert.match(
        readFileSync(path.join(temporaryDirectory, "output"), "utf8"),
        /integrity=sha512-matching-package/u,
      );
      assert.equal(readFileSync(path.join(temporaryDirectory, "publishes"), "utf8"), "publish\n");
    } finally {
      rmSync(temporaryDirectory, { recursive: true, force: true });
    }
  });
}
