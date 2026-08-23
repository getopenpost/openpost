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

test("frontend changes run the application build, browser, and image paths", () => {
  const plan = planCI(["frontend/src/routes/+page.svelte"], manifest);
  assert.equal(plan.application, true);
  assert.equal(plan.frontend, true);
  assert.equal(plan.image, true);
  assert.equal(plan.android, false);
  assert.equal(plan.backend, false);
});

test("standalone mobile changes run the native Android path", () => {
  const plan = planCI(["mobile/src/app/(tabs)/drafts.tsx"], manifest);
  assert.equal(plan.android, true);
  assert.equal(plan.frontend, false);
  assert.equal(plan.image, false);
});

test("mobile API contract changes run the native Android path", () => {
  const plan = planCI(["frontend/openapi.json"], manifest);
  assert.equal(plan.android, true);
});

test("n8n package changes run the dedicated package gate", () => {
  const plan = planCI(["packages/n8n-nodes-openpost/README.md"], manifest);
  assert.equal(plan.n8n, true);
});

test("selected automation generator changes run the dedicated package gate", () => {
  const plan = planCI(["scripts/generate-selected-automation-contract.mjs"], manifest);
  assert.equal(plan.n8n, true);
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
