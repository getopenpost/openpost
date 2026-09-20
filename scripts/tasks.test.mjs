import assert from "node:assert/strict";
import test from "node:test";

import { publicPlan, resolvePlan } from "./tasks.mjs";

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

test("public site builds marketing and docs before composing their outputs", () => {
  const result = taskPlan("build", "public-site");
  assert.equal(result.status, 0, result.stderr);
  const stages = Object.fromEntries(
    JSON.parse(result.stdout).stages.map((stage) => [stage.label, stage]),
  );
  assert.equal(stages["marketing build"].phase, stages["documentation build"].phase);
  assert.ok(stages["public site composition"].phase > stages["documentation build"].phase);
});

test("unknown scopes fail with the supported interface", () => {
  const result = taskPlan("test", "unknown");
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /supported test scopes/u);
});

function taskPlan(command, scope, environment = {}) {
  const previous = Object.fromEntries(
    Object.keys(environment).map((name) => [name, process.env[name]]),
  );
  try {
    Object.assign(process.env, environment);
    return { status: 0, stdout: JSON.stringify(publicPlan(resolvePlan(command, scope))) };
  } catch (error) {
    return { status: 1, stderr: error.message };
  } finally {
    for (const [name, value] of Object.entries(previous)) {
      if (value === undefined) delete process.env[name];
      else process.env[name] = value;
    }
  }
}

test("checks finish translation readers before policy builds regenerate translations", () => {
  const { stdout } = taskPlan("check");
  const stages = Object.fromEntries(JSON.parse(stdout).stages.map((stage) => [stage.label, stage]));
  assert.ok(stages["repository policy"].phase > stages["frontend types"].phase);
  assert.ok(stages["repository policy"].phase > stages["marketing types"].phase);
});

test("fallow audits changed code and reports complexity without scopes", () => {
  const result = taskPlan("fallow");
  assert.equal(result.status, 0, result.stderr);
  const stages = Object.fromEntries(
    JSON.parse(result.stdout).stages.map((stage) => [stage.label, stage]),
  );
  assert.match(stages["changed-code audit"].commands[0], /bunx fallow audit/u);
  assert.match(stages["changed-code audit"].commands[0], /--max-crap 400/u);
  assert.match(stages["complexity and hotspots"].commands[0], /--report-only/u);
  assert.match(stages["complexity and hotspots"].commands[0], /--hotspots/u);
  assert.match(stages["complexity and hotspots"].commands[0], /--targets/u);
  assert.match(stages["mobile audit and health"].commands[0], /--root apps\/mobile/u);

  const ciResult = taskPlan("fallow", undefined, { OPENPOST_FALLOW_CI: "1" });
  assert.equal(ciResult.status, 0, ciResult.stderr);
  const ciStages = Object.fromEntries(
    JSON.parse(ciResult.stdout).stages.map((stage) => [stage.label, stage]),
  );
  assert.match(ciStages["changed-code audit"].commands[0], /bunx fallow audit/u);
  assert.doesNotMatch(ciStages["complexity and hotspots"].commands[0], /--hotspots|--targets/u);
  assert.match(
    ciStages["complexity and hotspots"].commands[0],
    /--complexity .*--file-scores .*--score/u,
  );
  assert.doesNotMatch(ciStages["mobile audit and health"].commands[1], /--hotspots|--targets/u);
  assert.match(
    ciStages["mobile audit and health"].commands[1],
    /--complexity .*--file-scores .*--score/u,
  );

  const scoped = taskPlan("fallow", "frontend");
  assert.notEqual(scoped.status, 0);
});
