import assert from "node:assert/strict";
import test from "node:test";
import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

import {
  discoverGoTests,
  parseShard,
  runPattern,
  shardTests,
  testNamesInSource,
} from "./go-test-shards.mjs";

test("every backend test runs in exactly one shard", () => {
  const names = discoverGoTests("apps/server");
  for (const count of [1, 4, 7]) {
    const shards = Array.from({ length: count }, (_, index) =>
      shardTests(names, { index: index + 1, count }),
    );
    assert.deepEqual(shards.flat().sort(), names, `${count} shards must cover every test once`);
    for (const shard of shards) assert.ok(shard.length > 0, "no shard may run empty");
  }
});

test("shard patterns select whole top-level test names only", () => {
  const pattern = new RegExp(runPattern(["TestSaves", "TestSavesDraft"]));
  assert.ok(pattern.test("TestSaves"));
  assert.ok(pattern.test("TestSavesDraft"));
  assert.ok(!pattern.test("TestSavesDraftTwice"));
  assert.ok(!pattern.test("XTestSaves"));
});

test("test discovery uses current nonignored files and ignores harnesses and helpers", () => {
  const source = [
    "func TestMain(m *testing.M) {}",
    "func TestCreates(t *testing.T) {}",
    "func (s *suite) TestMethod() {}",
    "func helperTest(t *testing.T) {}",
    "  func TestIndented(t *testing.T) {}",
  ].join("\n");
  assert.deepEqual(testNamesInSource(source), ["TestCreates"]);
  const directory = mkdtempSync(path.join(tmpdir(), "openpost-go-discovery-"));
  try {
    const module = path.join(directory, "apps/server");
    mkdirSync(module, { recursive: true });
    writeFileSync(path.join(directory, ".gitignore"), "ignored_test.go\n");
    writeFileSync(path.join(module, "kept_test.go"), source);
    writeFileSync(path.join(module, "deleted_test.go"), "func TestDeleted(t *testing.T) {}\n");
    execFileSync("git", ["init", "--quiet", directory]);
    execFileSync("git", ["add", "."], { cwd: directory });
    rmSync(path.join(module, "deleted_test.go"));
    writeFileSync(path.join(module, "new_test.go"), "func TestNew(t *testing.T) {}\n");
    writeFileSync(path.join(module, "ignored_test.go"), "func TestIgnored(t *testing.T) {}\n");
    assert.deepEqual(discoverGoTests("apps/server", directory), ["TestCreates", "TestNew"]);
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});

test("shard selectors reject malformed or out-of-range values", () => {
  assert.deepEqual(parseShard("2/4"), { index: 2, count: 4 });
  for (const value of ["0/4", "5/4", "2", "a/b", undefined]) {
    assert.throws(() => parseShard(value));
  }
});
