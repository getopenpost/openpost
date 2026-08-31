import assert from "node:assert/strict";
import test from "node:test";

import { publicPlan, resolvePlan } from "./tasks.mjs";

test("a scoped check resolves through the canonical task interface", () => {
  const result = taskPlan("check", "frontend");
  assert.equal(result.status, 0, result.stderr);
  const plan = JSON.parse(result.stdout);
  assert.equal(plan.command, "check");
  assert.equal(plan.scope, "frontend");
  assert.ok(plan.stages.some((stage) => stage.label === "generated contracts"));
  assert.ok(plan.stages.some((stage) => stage.label === "frontend types"));
});

test("specialized policy checks share the check interface", () => {
  const result = taskPlan("check", "provider-certification");
  assert.equal(result.status, 0, result.stderr);
  const plan = JSON.parse(result.stdout);
  assert.deepEqual(
    plan.stages.map((stage) => stage.label),
    ["provider certification"],
  );
});

test("repository tests use exact Bun paths", () => {
  const result = taskPlan("test", "marketing");
  assert.equal(result.status, 0, result.stderr);
  const plan = JSON.parse(result.stdout);
  assert.match(plan.stages[0].commands[0], /bun test \.\/scripts\//u);
});

test("default tests isolate workspace browser processes from heavier test stages", () => {
  const result = taskPlan("test");
  assert.equal(result.status, 0, result.stderr);
  const plan = JSON.parse(result.stdout);
  const stages = Object.fromEntries(plan.stages.map((stage) => [stage.label, stage]));

  assert.equal(stages["backend tests"].phase, stages["repository tests"].phase);
  assert.ok(stages["workspace tests"].phase > stages["repository tests"].phase);
  assert.match(stages["workspace tests"].commands[0], /--concurrency 1/u);
});

test("verification finishes format and lint before starting tests", () => {
  const result = taskPlan("verify");
  assert.equal(result.status, 0, result.stderr);
  const plan = JSON.parse(result.stdout);
  const stages = Object.fromEntries(plan.stages.map((stage) => [stage.label, stage]));

  assert.equal(stages["format check"].phase, stages.lint.phase);
  assert.ok(stages.tests.phase > stages.lint.phase);
  assert.ok(stages["production builds"].phase > stages.tests.phase);
});

test("unknown scopes fail with the supported interface", () => {
  const result = taskPlan("test", "unknown");
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /supported test scopes/u);
});

function taskPlan(command, scope) {
  try {
    return { status: 0, stdout: JSON.stringify(publicPlan(resolvePlan(command, scope))) };
  } catch (error) {
    return { status: 1, stderr: error.message };
  }
}
