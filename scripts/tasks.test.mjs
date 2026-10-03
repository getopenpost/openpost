import assert from "node:assert/strict";
import test from "node:test";
import { mkdtempSync, writeFileSync, readFileSync, rmSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

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
  assert.match(
    stages["changed-code audit"].commands[0],
    /bun scripts\/fallow-dead-code-gate.mjs audit/u,
  );
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
  assert.match(
    ciStages["changed-code audit"].commands[0],
    /bun scripts\/fallow-dead-code-gate.mjs audit/u,
  );
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

test("structural gate rejects unused exports while complexity stays advisory", () => {
  const fixture = mkdtempSync(path.join(os.tmpdir(), "openpost-fallow-gate-"));
  const fallow = fileURLToPath(new URL("../node_modules/.bin/fallow", import.meta.url));
  const adapter = fileURLToPath(new URL("./fallow-dead-code-gate.mjs", import.meta.url));
  try {
    writeFileSync(
      path.join(fixture, "package.json"),
      JSON.stringify({ private: true, type: "module", dependencies: { "is-number": "7.0.0" } }),
    );
    writeFileSync(
      path.join(fixture, ".fallowrc.json"),
      JSON.stringify({ entry: ["main.ts"], rules: { "unused-exports": "warn" } }),
    );
    writeFileSync(path.join(fixture, "main.ts"), "console.log('ready');");
    for (const args of [
      ["init", "--quiet"],
      ["add", "."],
      [
        "-c",
        "user.name=Test",
        "-c",
        "user.email=test@example.com",
        "commit",
        "--quiet",
        "-m",
        "Initial fixture",
      ],
    ]) {
      const result = spawnSync("git", args, { cwd: fixture, encoding: "utf8" });
      assert.equal(result.status, 0, result.stderr);
    }
    const decisions = Array.from(
      { length: 40 },
      (_, index) => `if (value === ${index}) return ${index};`,
    ).join("\n");
    writeFileSync(
      path.join(fixture, "main.ts"),
      `import { choose } from './helper'; console.log(choose(2));`,
    );
    const helper = `export function choose(value: number) { ${decisions} return -1; }`;
    writeFileSync(
      path.join(fixture, "helper.ts"),
      `${helper}\nexport function unused() { return 1; }`,
    );
    const previousBase = process.env.OPENPOST_FALLOW_BASE;
    let stages;
    try {
      process.env.OPENPOST_FALLOW_BASE = "HEAD";
      stages = resolvePlan("fallow").phases.flat();
    } finally {
      if (previousBase === undefined) delete process.env.OPENPOST_FALLOW_BASE;
      else process.env.OPENPOST_FALLOW_BASE = previousBase;
    }
    const execute = (label) => {
      const step = stages.find((stage) => stage.label === label).steps[0];
      return step.argv[0] === "bun"
        ? spawnSync("bun", [adapter, ...step.argv.slice(2)], {
            cwd: fixture,
            encoding: "utf8",
            env: { ...process.env, PATH: `${path.dirname(fallow)}:${process.env.PATH}` },
          })
        : spawnSync(fallow, step.argv.slice(2), { cwd: fixture, encoding: "utf8" });
    };
    const unused = execute("changed-code audit");
    assert.equal(unused.status, 1, unused.stdout + unused.stderr);
    assert.match(
      readFileSync(path.join(fixture, "test-results/fallow/root.json"), "utf8"),
      /unused/u,
    );
    writeFileSync(path.join(fixture, "helper.ts"), helper);
    const clean = execute("changed-code audit");
    assert.equal(clean.status, 0, clean.stdout + clean.stderr);
    assert.match(clean.stdout, /"dead_code_inherited": 1/u);
    const invalidConfig = spawnSync("bun", [adapter, "audit", "--config", "missing.json"], {
      cwd: fixture,
      encoding: "utf8",
      env: { ...process.env, PATH: `${path.dirname(fallow)}:${process.env.PATH}` },
    });
    assert.equal(invalidConfig.status, 2, invalidConfig.stdout + invalidConfig.stderr);
    const complexity = execute("complexity and hotspots");
    assert.equal(complexity.status, 0, complexity.stdout + complexity.stderr);
    assert.match(complexity.stdout, /choose/u);
  } finally {
    rmSync(fixture, { recursive: true, force: true });
  }
});
