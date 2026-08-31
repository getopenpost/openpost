import assert from "node:assert/strict";
import test from "node:test";

import {
  backendProviderCatalog,
  providerCountCopyProblems,
  validateProviderCatalogFacts,
} from "./provider-catalog-facts.mjs";

test("extracts literal and constant-backed providers from the Go catalogue", () => {
  const source = `
const mastodonProvider = "mastodon"

var providerCatalog = []ProviderInfo{
  {Platform: "x"},
  {Platform: mastodonProvider},
}

func next() {}
`;
  assert.deepEqual(backendProviderCatalog(source), ["x", "mastodon"]);
});

test("rejects public total copy that drifts from the catalogue", () => {
  assert.deepEqual(
    providerCountCopyProblems(
      "Preview nine platforms. Ten social networks are available.",
      10,
      "copy.md",
    ),
    ['copy.md says "Preview nine platforms"; canonical provider count is 10'],
  );
});

test("current public provider identities and totals match", { timeout: 15_000 }, async () => {
  assert.deepEqual(await validateProviderCatalogFacts(), []);
});
