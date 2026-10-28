import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("../../", import.meta.url));
const packageRoot = path.join(root, "packages/n8n-nodes-openpost");
const checkScript = path.join(root, "scripts/check-n8n-package-build.mjs");
const leakedDirectory = path.join(packageRoot, "dist/test");
const leakedFile = path.join(leakedDirectory, "package-build-guard.test.js");
const leakedPayloadPath = "dist/test/package-build-guard.test.js";

function runPayloadCheck() {
  return spawnSync("node", [checkScript], { encoding: "utf8" });
}

test("the n8n npm payload rejects compiled tests that leaked into dist", () => {
  const clean = runPayloadCheck();
  assert.equal(clean.status, 0, clean.stderr || clean.stdout);
  assert.match(clean.stdout, /validated \d+ npm payload files/u);

  const fileExisted = existsSync(leakedFile);
  const directoryExisted = existsSync(leakedDirectory);
  const previous = fileExisted ? readFileSync(leakedFile) : null;
  try {
    mkdirSync(leakedDirectory, { recursive: true });
    writeFileSync(leakedFile, "// leaked compiled test fixture\n");

    const failed = runPayloadCheck();
    assert.notEqual(failed.status, 0, "the n8n payload check accepted a compiled test in dist");
    const expectedFailure = `Compiled test file in npm payload: ${leakedPayloadPath}`;
    assert.ok(
      (failed.stderr || "").split("\n").some((line) => line.includes(expectedFailure)),
      `expected "${expectedFailure}" in:\n${failed.stderr}`,
    );
  } finally {
    if (fileExisted) writeFileSync(leakedFile, previous);
    else rmSync(leakedFile, { force: true });
    if (!directoryExisted) rmSync(leakedDirectory, { recursive: true, force: true });
  }
});
