import assert from "node:assert/strict";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { test } from "node:test";

import { spawnTaskProcess } from "./task-process.mjs";

function isRunning(pid) {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

async function waitForExit(pid) {
  const deadline = Date.now() + 3_000;
  while (Date.now() < deadline && isRunning(pid)) await Bun.sleep(20);
  return !isRunning(pid);
}

test("a step returns its exit status", async () => {
  assert.equal(await spawnTaskProcess(["sh", "-c", "exit 3"]), 3);
});

test("a timed-out step stops its whole process tree", async () => {
  const directory = await mkdtemp(path.join(tmpdir(), "openpost-task-process-"));
  try {
    const script = path.join(directory, "run.sh");
    await writeFile(
      script,
      [
        'echo $$ > "$TASK_TEST_DIRECTORY/self"',
        "sleep 30 &",
        'echo $! > "$TASK_TEST_DIRECTORY/child"',
        "wait",
      ].join("\n"),
    );
    const status = await spawnTaskProcess(["sh", script], {
      env: { ...process.env, TASK_TEST_DIRECTORY: directory },
      timeoutMs: 200,
    });
    assert.equal(status, 124);
    const self = Number((await readFile(path.join(directory, "self"), "utf8")).trim());
    const child = Number((await readFile(path.join(directory, "child"), "utf8")).trim());
    assert.ok(await waitForExit(self), "the step process should stop");
    assert.ok(await waitForExit(child), "the descendant process should stop");
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});
