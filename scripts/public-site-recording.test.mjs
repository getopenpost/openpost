import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, writeFileSync, rmSync, realpathSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawnSync } from "node:child_process";
import { isRecordingPush } from "./public-site-recording.mjs";

test("recording delivery considers the full push range and rejects unknown history", () => {
  const root = realpathSync(mkdtempSync(join(tmpdir(), "recording-push-")));
  const git = (...args) => {
    const result = spawnSync("git", args, { cwd: root, encoding: "utf8", timeout: 10000 });
    if (result.status !== 0)
      throw new Error(
        JSON.stringify({
          args,
          status: result.status,
          signal: result.signal,
          error: result.error?.message,
          stdout: result.stdout,
          stderr: result.stderr,
        }),
      );
    return result.stdout.trim();
  };
  const commit = (file, text) => {
    writeFileSync(join(root, file), text);
    git("add", ".");
    git(
      "-c",
      "user.name=Fixture",
      "-c",
      "user.email=fixture@example.invalid",
      "-c",
      "commit.gpgsign=false",
      "-c",
      "core.hooksPath=/dev/null",
      "commit",
      "-qm",
      "fixture",
    );
    return git("rev-parse", "HEAD");
  };
  try {
    git("init", "-q");
    const base = commit("source.js", "initial");
    const code = commit("source.js", "changed");
    const recording = commit("CHANGELOG.md", "release");
    assert.equal(isRecordingPush(root, code, recording), true);
    assert.equal(isRecordingPush(root, base, recording), false);
    assert.equal(isRecordingPush(root, "0".repeat(40), recording), false);
    assert.equal(isRecordingPush(root, "f".repeat(40), recording), false);
    assert.equal(isRecordingPush(root, recording, recording), false);
    git("checkout", "-qb", "content", base);
    commit("CHANGELOG.md", "other release");
    git(
      "-c",
      "user.name=Fixture",
      "-c",
      "user.email=fixture@example.invalid",
      "-c",
      "commit.gpgsign=false",
      "merge",
      "--no-ff",
      "--no-edit",
      code,
    );
    assert.equal(isRecordingPush(root, base, git("rev-parse", "HEAD")), false);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
