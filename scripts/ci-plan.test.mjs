import assert from "node:assert/strict";
import test from "node:test";

import { planCI } from "./ci-plan.mjs";
import { readReleaseSurfaceManifest } from "./release-surfaces.mjs";

const manifest = readReleaseSurfaceManifest();

test("documentation-only changes run only documentation and policy checks", () => {
  const plan = planCI(["docs-site/guide.md"], manifest);
  assert.equal(plan.documentation, true);
  assert.equal(plan.backend, false);
  assert.equal(plan.frontend, false);
  assert.equal(plan.marketing, false);
  assert.equal(plan.image, false);
  assert.equal(plan.android, false);
});

test("documentation catalogue changes run both public builds", () => {
  const plan = planCI(["packages/social-images/src/docs-catalog.js"], manifest);
  assert.equal(plan.documentation, true);
  assert.equal(plan.marketing, true);
});

test("shared Agent-readable generator changes run both public builds", () => {
  const plan = planCI(["scripts/generate-agent-surfaces.mjs"], manifest);
  assert.equal(plan.documentation, true);
  assert.equal(plan.marketing, true);
});

test("frontend changes run the application build, browser, image, and Android paths", () => {
  const plan = planCI(["frontend/src/routes/+page.svelte"], manifest);
  assert.equal(plan.application, true);
  assert.equal(plan.frontend, true);
  assert.equal(plan.image, true);
  assert.equal(plan.android, true);
  assert.equal(plan.backend, false);
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
