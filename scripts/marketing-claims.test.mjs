import assert from "node:assert/strict";
import test from "node:test";

import { validateMarketingClaims } from "./marketing-claims.mjs";

const now = new Date("2026-08-12T12:00:00Z");

function manifest(overrides = {}) {
  return {
    schema_version: 1,
    reviewed_on: "2026-08-12",
    next_review_on: "2026-11-12",
    owner: "openpost@example.com",
    claims: [],
    illustrative_material: [],
    ...overrides,
  };
}

test("unregistered customer proof fails closed", () => {
  assert.throws(
    () =>
      validateMarketingClaims(
        manifest(),
        new Map([
          ["marketing-site/src/routes/+page.svelte", "Used by builders at"],
        ]),
        now,
      ),
    /unregistered public proof claim/,
  );
});

test("fictional generated personas require a visible illustrative label", () => {
  const sourcePath =
    "marketing-site/src/routes/_components/CreatorStories.svelte";
  const source =
    "Illustrative workflows. These fictional examples use /assets/testimonial-portraits/a.webp";
  assert.doesNotThrow(() =>
    validateMarketingClaims(
      manifest({
        illustrative_material: [
          {
            id: "workflows",
            source: sourcePath,
            label: "Illustrative workflows",
            description: "Fictional generated people.",
          },
        ],
      }),
      new Map([[sourcePath, source]]),
      now,
    ),
  );
});
