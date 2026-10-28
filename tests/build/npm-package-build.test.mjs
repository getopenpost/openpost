import assert from "node:assert/strict";
import test from "node:test";
import { existsSync, mkdirSync, readFileSync, rmdirSync, rmSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { checkPackageBuild } from "../../scripts/check-npm-package-build.mjs";

test("the SDK and CLI payloads match their manifests and built output", () => {
  const cache = "packages/sdk/.turbo";
  const existed = existsSync(cache);
  mkdirSync(cache, { recursive: true });
  try {
    assert.deepEqual(checkPackageBuild("packages/sdk"), []);
  } finally {
    if (!existed) rmdirSync(cache);
  }
  assert.deepEqual(checkPackageBuild("packages/cli"), []);
});

test("compiled tests that leaked into dist fail the SDK and CLI payloads", () => {
  for (const directory of ["packages/sdk", "packages/cli"]) {
    const packageRoot = fileURLToPath(new URL(`../../${directory}/`, import.meta.url));
    const leakedFile = path.join(packageRoot, "dist", "nested", "client.test.js");
    const leakedDirectory = path.dirname(leakedFile);
    const fileExisted = existsSync(leakedFile);
    const directoryExisted = existsSync(leakedDirectory);
    const previous = fileExisted ? readFileSync(leakedFile) : null;
    try {
      mkdirSync(leakedDirectory, { recursive: true });
      writeFileSync(leakedFile, "// leaked compiled test fixture\n");
      const problems = checkPackageBuild(directory);
      assert.ok(
        problems.some(
          (problem) =>
            problem.includes(`dist/nested/client.test.js`) && /compiled test/u.test(problem),
        ),
        problems.join("\n"),
      );
    } finally {
      if (fileExisted) writeFileSync(leakedFile, previous);
      else rmSync(leakedFile, { force: true });
      if (!directoryExisted) rmSync(leakedDirectory, { recursive: true, force: true });
    }
  }
});

test("unknown package directories fail closed", () => {
  assert.throws(() => checkPackageBuild("packages/n8n-nodes-openpost"), /Unknown npm package/);
});
