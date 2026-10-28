import assert from "node:assert/strict";
import test from "node:test";

import { parseNpmViewResult } from "./npm-view-result.mjs";

test("npm view metadata accepts npm 11 and npm 12 output", () => {
  const metadata = {
    name: "@getopenpost/n8n-nodes-openpost",
    version: "0.1.0",
    "dist.integrity": "sha512-local",
  };
  assert.deepEqual(parseNpmViewResult(JSON.stringify(metadata), metadata.name), metadata);
  assert.deepEqual(parseNpmViewResult(JSON.stringify([metadata]), metadata.name), metadata);
  assert.throws(() => parseNpmViewResult("[]", metadata.name), /did not return metadata/u);
});

test("npm view scalar fields accept npm 11 and npm 12 output", () => {
  assert.equal(
    parseNpmViewResult(JSON.stringify("sha512-local"), "package integrity"),
    "sha512-local",
  );
  assert.equal(
    parseNpmViewResult(JSON.stringify(["sha512-local"]), "package integrity"),
    "sha512-local",
  );
});
