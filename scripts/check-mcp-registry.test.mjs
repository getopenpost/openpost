import assert from "node:assert/strict";
import test from "node:test";

import { validateMCPRegistryOwnership } from "./check-mcp-registry.mjs";

const manifest = {
  name: "io.github.rodrgds/openpost",
  version: "1.32.1",
  remotes: [
    { type: "streamable-http", url: "https://app.openpost.social/mcp" },
  ],
};
const listings =
  "Published as `io.github.rodrgds/openpost` version `1.32.1`; registry API reports active and latest.";
const docs = "## Registry listing version and compatibility\n";

test("accepts one documented immutable registry publication", () => {
  assert.equal(
    validateMCPRegistryOwnership({ manifest, listings, docs }),
    "1.32.1",
  );
});

test("rejects unexplained app/registry version drift", () => {
  assert.throws(
    () =>
      validateMCPRegistryOwnership({
        manifest: { ...manifest, version: "3.6.0" },
        listings,
        docs,
      }),
    /does not match the published listing/,
  );
});

test("rejects range, prerelease, and changed remote metadata", () => {
  for (const version of ["1.x", "1.32.2-next.1", "v1.32.2"]) {
    assert.throws(
      () =>
        validateMCPRegistryOwnership({
          manifest: { ...manifest, version },
          listings,
          docs,
        }),
      /stable semantic version/,
    );
  }
  assert.throws(
    () =>
      validateMCPRegistryOwnership({
        manifest: {
          ...manifest,
          remotes: [
            { type: "streamable-http", url: "https://example.com/mcp" },
          ],
        },
        listings,
        docs,
      }),
    /canonical managed MCP endpoint/,
  );
});
