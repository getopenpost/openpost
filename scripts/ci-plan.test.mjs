import assert from "node:assert/strict";
import test from "node:test";

import { planCI } from "./ci-plan.mjs";
import { readReleaseSurfaceManifest } from "./release-surfaces.mjs";

const manifest = readReleaseSurfaceManifest();

test("changed files route to their CI paths", () => {
  const cases = [
    {
      name: "social artwork stays outside application builds",
      files: ["assets/social/openpost/banners/x-paper.png"],
      on: ["marketing"],
      off: ["application", "frontend", "backend", "documentation", "image", "android"],
    },
    {
      name: "shared product assets rebuild their consumers",
      files: ["assets/brand/icon.svg"],
      on: ["application", "frontend", "marketing", "documentation", "image"],
      off: ["backend", "android"],
    },
    {
      name: "documentation-only changes",
      files: ["apps/docs/guide.md"],
      on: ["documentation"],
      off: ["backend", "frontend", "marketing", "image", "android"],
    },
    {
      name: "documentation catalogue changes",
      files: ["packages/social-images/src/docs-catalog.js"],
      on: ["documentation", "marketing"],
      off: [],
    },
    {
      name: "shared Agent-readable generator changes",
      files: ["scripts/generate-agent-surfaces.mjs"],
      on: ["documentation", "marketing"],
      off: [],
    },
    {
      name: "frontend changes",
      files: ["apps/web/src/routes/+page.svelte"],
      on: ["application", "frontend", "image"],
      off: ["android", "backend"],
    },
    {
      name: "standalone mobile changes",
      files: ["apps/mobile/src/app/(tabs)/drafts.tsx"],
      on: ["android"],
      off: ["frontend", "image"],
    },
    {
      name: "mobile API contract changes",
      files: ["apps/web/openapi.json"],
      on: ["android"],
      off: [],
    },
    {
      name: "shared Query packages",
      files: ["packages/api-contract/src/schema.d.ts", "packages/query-catalog/src/options.ts"],
      on: ["frontend", "android"],
      off: [],
    },
    {
      name: "n8n package changes",
      files: ["packages/n8n-nodes-openpost/README.md"],
      on: ["n8n"],
      off: [],
    },
    {
      name: "selected automation generator changes",
      files: ["scripts/generate-selected-automation-contract.mjs"],
      on: ["n8n"],
      off: [],
    },
  ];
  for (const { name, files, on, off } of cases) {
    const plan = planCI(files, manifest);
    for (const job of on) assert.equal(plan[job], true, `${name}: ${job}`);
    for (const job of off) assert.equal(plan[job], false, `${name}: ${job}`);
  }
});

test("delivery changes fail closed to the complete matrix", () => {
  const plan = planCI([".github/workflows/ci.yml"], manifest);
  assert.ok(
    Object.entries(plan)
      .filter(([name]) => name !== "cache_contract")
      .every(([, enabled]) => enabled),
  );
});

test("main candidates always run the complete matrix", () => {
  const plan = planCI([], manifest, { full: true });
  assert.ok(
    Object.entries(plan)
      .filter(([name]) => name !== "cache_contract")
      .every(([, enabled]) => enabled),
  );
  assert.equal(plan.cache_contract, false);
});
