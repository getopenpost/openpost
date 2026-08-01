import assert from "node:assert/strict";
import test from "node:test";

import {
  classifyCommitMessages,
  compareVersions,
  incrementVersion,
  includePendingCommitMessage,
  parseStableVersion,
  resolveNextTag,
} from "./next-release-version.mjs";

test("parses stable semantic versions", () => {
  assert.deepEqual(parseStableVersion("v1.27.7"), [1, 27, 7]);
  assert.deepEqual(parseStableVersion("2.0.0"), [2, 0, 0]);
  assert.throws(
    () => parseStableVersion("v1.02.3"),
    /expected a stable version/,
  );
  assert.throws(() => parseStableVersion("v1.2"), /expected a stable version/);
});

test("compares versions numerically", () => {
  assert.equal(compareVersions("v1.10.0", "v1.9.9"), 1);
  assert.equal(compareVersions("v1.27.7", "v1.27.7"), 0);
  assert.equal(compareVersions("v1.27.6", "v1.27.7"), -1);
});

test("uses the highest conventional commit impact", () => {
  assert.equal(
    classifyCommitMessages(["docs: simplify README", "fix: repair upload"]),
    "patch",
  );
  assert.equal(
    classifyCommitMessages(["fix: repair upload", "feat(cli): add command"]),
    "minor",
  );
  assert.equal(
    classifyCommitMessages(["feat(api)!: replace response shape"]),
    "major",
  );
  assert.equal(
    classifyCommitMessages([
      "feat(api): replace response shape\n\nBREAKING CHANGE: clients must migrate",
    ]),
    "major",
  );
});

test("includes a pending release commit without changing existing messages", () => {
  const existing = ["fix: repair upload"];
  assert.deepEqual(
    includePendingCommitMessage(existing, "feat: add publishing mode"),
    ["fix: repair upload", "feat: add publishing mode"],
  );
  assert.deepEqual(existing, ["fix: repair upload"]);
  assert.deepEqual(includePendingCommitMessage(existing, "  "), existing);
});

test("increments and resets lower version components", () => {
  assert.equal(incrementVersion("v1.27.7", "patch"), "v1.27.8");
  assert.equal(incrementVersion("v1.27.7", "minor"), "v1.28.0");
  assert.equal(incrementVersion("v1.27.7", "major"), "v2.0.0");
});

test("supports deliberate bump and exact-version overrides", () => {
  assert.equal(
    resolveNextTag("v1.1.22", ["docs: align release notes"], {
      exactVersion: "1.27.8",
    }),
    "v1.27.8",
  );
  assert.equal(
    resolveNextTag("v1.27.7", ["docs: align release notes"], { bump: "minor" }),
    "v1.28.0",
  );
  assert.equal(
    resolveNextTag("v1.27.7", ["feat: add publishing mode"], { bump: "major" }),
    "v2.0.0",
  );
  assert.throws(
    () =>
      resolveNextTag("v1.27.7", ["fix: repair upload"], {
        exactVersion: "v1.27.7",
      }),
    /must be greater/,
  );
  assert.throws(
    () =>
      resolveNextTag("v1.27.7", ["fix: repair upload"], {
        exactVersion: "v1.28.0",
        bump: "minor",
      }),
    /cannot be used together/,
  );
  assert.throws(
    () =>
      resolveNextTag("v1.27.7", ["feat: add publishing mode"], {
        bump: "patch",
      }),
    /cannot lower the required minor bump/,
  );
  assert.throws(
    () =>
      resolveNextTag("v1.27.7", ["feat: add publishing mode"], {
        exactVersion: "v1.27.8",
      }),
    /lower than the required v1.28.0/,
  );
});
