import assert from "node:assert/strict";
import test from "node:test";

import { checkPackageBuild } from "./check-npm-package-build.mjs";

test("the SDK and CLI payloads match their manifests and built output", () => {
  assert.deepEqual(checkPackageBuild("packages/sdk"), []);
  assert.deepEqual(checkPackageBuild("packages/cli"), []);
});

test("unknown package directories fail closed", () => {
  assert.throws(() => checkPackageBuild("packages/n8n-nodes-openpost"), /Unknown npm package/);
});
