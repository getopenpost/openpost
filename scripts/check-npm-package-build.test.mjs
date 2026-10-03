import assert from "node:assert/strict";
import test from "node:test";
import { existsSync, mkdirSync, rmdirSync } from "node:fs";

import { checkPackageBuild } from "./check-npm-package-build.mjs";

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

test("unknown package directories fail closed", () => {
  assert.throws(() => checkPackageBuild("packages/n8n-nodes-openpost"), /Unknown npm package/);
});
