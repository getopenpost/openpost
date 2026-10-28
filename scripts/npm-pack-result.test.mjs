import assert from "node:assert/strict";
import test from "node:test";

import { parseNpmPackResult } from "./npm-pack-result.mjs";

test("npm pack metadata accepts npm 11 and npm 12 output", () => {
  const pack = { filename: "openpost.tgz", integrity: "sha512-local" };
  assert.deepEqual(
    parseNpmPackResult(JSON.stringify([pack]), "@getopenpost/n8n-nodes-openpost"),
    pack,
  );
  assert.deepEqual(
    parseNpmPackResult(
      JSON.stringify({ "@getopenpost/n8n-nodes-openpost": pack }),
      "@getopenpost/n8n-nodes-openpost",
    ),
    pack,
  );
  assert.throws(
    () => parseNpmPackResult("{}", "@getopenpost/n8n-nodes-openpost"),
    /did not return metadata/u,
  );
});
