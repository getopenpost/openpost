import assert from "node:assert/strict";
import test from "node:test";
import { mkdtempSync, writeFileSync, readFileSync, rmSync, mkdirSync, copyFileSync } from "node:fs";
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
  assert.ok(stages["repository policy"].phase > stages["frontend and marketing types"].phase);
});

test("the policy aggregate leaves production public builds to the public routes gate", () => {
  const policy = publicPlan(resolvePlan("check", "policy", new Set(["--policy-only"])));
  assert.equal(
    policy.stages.some((stage) => stage.label === "public routes"),
    false,
    "the CI policy job must not rebuild both public sites",
  );
  const publicRoutes = (taskPlan) =>
    taskPlan.stages.filter((stage) => stage.label === "public routes");
  const full = publicPlan(resolvePlan("check"));
  assert.equal(publicRoutes(full).length, 1, "the full check keeps the artifact proof");
  assert.deepEqual(publicRoutes(full)[0].commands, [
    "bunx turbo run _test:public-build",
    "bun scripts/check-marketing-route-manifest.mjs",
  ]);
  assert.equal(
    full.stages.toSorted((left, right) => left.phase - right.phase).at(-1).label,
    "public routes",
    "the artifact proof must finish after policy work",
  );
  const explicit = publicRoutes(publicPlan(resolvePlan("check", "public-routes")));
  assert.ok(
    explicit[0].commands.includes("bun test ./scripts/public-deployment-proof.test.mjs"),
    "the explicit selector keeps its focused regression tests",
  );
});

test("combined frontend and marketing checks compile translations once before both readers", () => {
  const plannedCheck = (scope) =>
    spawnSync("bun", ["scripts/tasks.mjs", "check", scope, "--plan"], {
      cwd: fileURLToPath(new URL("..", import.meta.url)),
      encoding: "utf8",
    });
  const combined = plannedCheck("frontend-marketing");
  assert.equal(combined.status, 0, combined.stderr);
  const stages = JSON.parse(combined.stdout).stages;
  assert.equal(stages.filter((stage) => stage.label === "frontend translations").length, 1);
  const translations = stages.find((stage) => stage.label === "frontend translations");
  const readers = stages.filter((stage) =>
    stage.commands.some((command) => command.includes("turbo run check")),
  );
  assert.equal(readers.length, 1, "shared UI outputs must have one Turbo dependency graph");
  assert.ok(translations.phase < readers[0].phase);
  assert.equal(readers[0].commands.length, 1);
  assert.match(readers[0].commands[0], /--filter @openpost\/web --filter @openpost\/site/u);

  for (const scope of ["frontend", "marketing"]) {
    const standalone = plannedCheck(scope);
    assert.equal(standalone.status, 0, standalone.stderr);
    assert.equal(
      JSON.parse(standalone.stdout).stages.filter(
        (stage) => stage.label === "frontend translations",
      ).length,
      1,
    );
  }
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
    const unchanged = spawnSync("bun", [adapter, "audit", "--base", "HEAD"], {
      cwd: fixture,
      encoding: "utf8",
      env: { ...process.env, PATH: `${path.dirname(fallow)}:${process.env.PATH}` },
    });
    assert.equal(unchanged.status, 0, unchanged.stdout + unchanged.stderr);
    const unchangedAudit = JSON.parse(
      readFileSync(path.join(fixture, "test-results/fallow/root.json"), "utf8"),
    );
    assert.equal(unchangedAudit.changed_files_count, 0);
    assert.equal(unchangedAudit.summary.dead_code_issues, 0);
    assert.equal(unchangedAudit.dead_code, undefined);
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

test("local preflight shares verification stages without a production build phase", () => {
  const result = spawnSync("bun", ["scripts/tasks.mjs", "preflight", "--plan"], {
    cwd: fileURLToPath(new URL("..", import.meta.url)),
    encoding: "utf8",
  });
  assert.equal(result.status, 0, result.stderr);
  const stages = Object.fromEntries(
    JSON.parse(result.stdout).stages.map((stage) => [stage.label, stage]),
  );
  assert.ok(stages["format check"].phase < stages["static checks"].phase);
  assert.ok(stages.tests.phase > stages.lint.phase);
  assert.ok(stages.tests.phase > stages["static checks"].phase);
  assert.equal(stages["production builds"], undefined);
  for (const label of ["npm packages", "n8n package", "mobile source checks"]) {
    assert.equal(stages[label].phase, stages.lint.phase, label);
    assert.ok(stages[label].phase > stages["static checks"].phase, label);
    assert.ok(stages.tests.phase > stages[label].phase, label);
  }
  assert.ok(stages["npm packages"].commands.includes("bun run check"));
  assert.ok(stages["n8n package"].commands.includes("bun run check"));
  assert.deepEqual(stages["mobile source checks"].commands, ["bun run check:source"]);
});

test("preflight stops on formatting before generation and overlaps independent package and lint checks", () => {
  const fixture = mkdtempSync(path.join(os.tmpdir(), "openpost-preflight-"));
  try {
    mkdirSync(path.join(fixture, "scripts"));
    mkdirSync(path.join(fixture, "bin"));
    for (const directory of [
      "apps/server",
      "apps/cli",
      "apps/mobile",
      "apps/docs",
      "apps/marketing",
      "packages/sdk",
      "packages/cli",
      "packages/n8n-nodes-openpost",
    ])
      mkdirSync(path.join(fixture, directory), { recursive: true });
    for (const script of [
      "tasks.mjs",
      "task-process.mjs",
      "turbo-cache.mjs",
      "go-test-shards.mjs",
    ]) {
      copyFileSync(new URL(`./${script}`, import.meta.url), path.join(fixture, "scripts", script));
    }
    // Only task orchestration is real in this fixture. Leaf tools record their
    // execution instead of requiring the complete application/toolchain.
    const shim = `#!${process.execPath}
import { appendFileSync, readFileSync } from "node:fs";
import { basename } from "node:path";
const tool = basename(process.argv[1]);
const args = process.argv.slice(2);
if (tool === "bun" && args[0] === "scripts/tasks.mjs") {
  const child = Bun.spawn([${JSON.stringify(process.execPath)}, ...args], { env: process.env, stdout: "inherit", stderr: "inherit" });
  process.exit(await child.exited);
}
if (tool === "bunx" && args.slice(0, 3).join(" ") === "turbo run _policy") {
  const child = Bun.spawn([${JSON.stringify(process.execPath)}, "scripts/tasks.mjs", "check", "policy", "--policy-only"], { env: process.env, stdout: "inherit", stderr: "inherit" });
  process.exit(await child.exited);
}
const record = (event) => appendFileSync(process.env.EVENTS, JSON.stringify({ tool, args, event, cwd: process.cwd(), locked: process.env.OPENPOST_ROOT_TASK_LOCKED }) + "\\n");
record("start");
if (process.env.FAIL_FORMAT === "1" && args.includes("oxfmt")) process.exit(17);
const sdkCheck = (entry) => entry.tool === "bun" && entry.args.join(" ") === "run check" && entry.cwd.endsWith("/packages/sdk");
if (sdkCheck({ tool, args, cwd: process.cwd() }) || args.includes("lint:oxlint")) {
  const partner = args.includes("lint:oxlint") ? sdkCheck : (entry) => entry.args.includes("lint:oxlint");
  const deadline = Date.now() + 5_000;
  while (!readFileSync(process.env.EVENTS, "utf8").split("\\n").filter(Boolean).map(JSON.parse).some((entry) => entry.event === "start" && partner(entry))) {
    if (Date.now() > deadline) throw new Error("independent package and lint checks never overlapped");
    await Bun.sleep(10);
  }
}
record("end");
`;
    for (const tool of ["bun", "bunx", "go", "git", "golangci-lint", "bash"]) {
      writeFileSync(path.join(fixture, "bin", tool), shim, { mode: 0o755 });
    }
    writeFileSync(path.join(fixture, "scripts/check-go-deadcode.sh"), "#!/bin/sh\nexit 0\n", {
      mode: 0o755,
    });
    const eventsPath = path.join(fixture, "events.jsonl");
    const failedEvents = path.join(fixture, "failed-events.jsonl");
    const failed = spawnSync(process.execPath, ["scripts/tasks.mjs", "preflight"], {
      cwd: fixture,
      encoding: "utf8",
      timeout: 10_000,
      env: {
        ...process.env,
        PATH: `${fixture}/bin:${process.env.PATH}`,
        EVENTS: failedEvents,
        FAIL_FORMAT: "1",
        OPENPOST_ROOT_TASK_LOCKED: "",
        OPENPOST_TURBO_CACHE_DIR: path.join(fixture, "cache"),
      },
    });
    assert.notEqual(failed.status, 0);
    assert.match(failed.stderr, /format check/u);
    const failedCalls = readFileSync(failedEvents, "utf8").trim().split("\n").map(JSON.parse);
    assert.ok(failedCalls.some(({ args }) => args.includes("oxfmt")));
    assert.ok(
      failedCalls.every(({ args }) => args.includes("oxfmt") || args.includes("ls-files")),
      "format failure must stop before contract generation, builds, lint and tests",
    );
    const result = spawnSync(process.execPath, ["scripts/tasks.mjs", "preflight"], {
      cwd: fixture,
      encoding: "utf8",
      timeout: 10_000,
      env: {
        ...process.env,
        PATH: `${fixture}/bin:${process.env.PATH}`,
        EVENTS: eventsPath,
        OPENPOST_ROOT_TASK_LOCKED: "",
        OPENPOST_TURBO_CACHE_DIR: path.join(fixture, "cache"),
      },
    });
    assert.equal(result.status, 0, result.stdout + result.stderr);
    const events = readFileSync(eventsPath, "utf8")
      .trim()
      .split("\n")
      .map((line) => JSON.parse(line));
    assert.ok(events.length > 0);
    assert.ok(events.every(({ locked }) => locked === "1"));
    const formatEnd = events.findIndex(
      ({ args, event }) => args.includes("oxfmt") && event === "end",
    );
    const lint = events.findIndex(
      ({ args, event }) => args.includes("lint:oxlint") && event === "start",
    );
    const lintEnd = events.findIndex(
      ({ args, event }) => args.includes("lint:oxlint") && event === "end",
    );
    const sdk = (entry) =>
      entry.tool === "bun" &&
      entry.args.join(" ") === "run check" &&
      entry.cwd.endsWith("/packages/sdk");
    const sdkStart = events.findIndex((entry) => sdk(entry) && entry.event === "start");
    const sdkEnd = events.findIndex((entry) => sdk(entry) && entry.event === "end");
    assert.ok(formatEnd >= 0 && formatEnd < sdkStart && formatEnd < lint);
    assert.ok(sdkStart < lintEnd && lint < sdkEnd, "package and lint checks must overlap");
    const tests = events.findIndex(
      ({ tool, args, event }) =>
        tool === "bun" && args.join(" ") === "test ./scripts" && event === "start",
    );
    assert.ok(tests > Math.max(formatEnd, lintEnd));
    for (const artifactCheck of [
      "scripts/check-npm-package-build.mjs",
      "scripts/check-n8n-package-build.mjs",
    ]) {
      const finished = events.findIndex(
        ({ args, event }) => args.includes(artifactCheck) && event === "end",
      );
      assert.ok(finished >= 0 && tests > finished, artifactCheck);
    }
    const n8nBuild = events.findIndex(
      ({ tool, args, event, cwd }) =>
        tool === "bun" &&
        event === "end" &&
        args.join(" ") === "run build" &&
        cwd.endsWith("/packages/n8n-nodes-openpost"),
    );
    const n8nPayloadTest = (target) =>
      events.findIndex(
        ({ tool, args, event }) =>
          tool === "bun" &&
          event === target &&
          args.join(" ") === "test ./tests/build/n8n-package-build.test.mjs",
      );
    const n8nPayloadTestStart = n8nPayloadTest("start");
    const n8nPayloadTestEnd = n8nPayloadTest("end");
    const n8nPayloadCheck = events.findIndex(
      ({ tool, args, event }) =>
        tool === "bun" && event === "start" && args.includes("scripts/check-n8n-package-build.mjs"),
    );
    assert.ok(
      n8nBuild >= 0 &&
        n8nBuild < n8nPayloadTestStart &&
        n8nPayloadTestStart < n8nPayloadTestEnd &&
        n8nPayloadTestEnd < n8nPayloadCheck,
      "the n8n payload regression runs after its build and before the artifact check",
    );
    assert.ok(events.some(({ args }) => args.join(" ") === "test ./scripts"));
    const repositoryTests = events.filter(
      ({ tool, args, event }) =>
        tool === "bun" &&
        event === "start" &&
        args[0] === "test" &&
        args.some((arg) => arg === "./scripts" || arg.startsWith("./scripts/")),
    );
    assert.deepEqual(
      repositoryTests.map(({ args }) => args),
      [["test", "./scripts"]],
      "repository regressions run once in the aggregate, after static and package checks",
    );
    assert.ok(
      events.some(({ args }) => args.slice(0, 5).join(" ") === "turbo run test --concurrency 1"),
    );
  } finally {
    rmSync(fixture, { recursive: true, force: true });
  }
});

test(
  "the public-build gate hashes its corpus and canonical build dependencies",
  { timeout: 60_000 },
  async () => {
    const { cpSync, existsSync, constants } = await import("node:fs");
    const root = fileURLToPath(new URL("..", import.meta.url));
    const fixture = mkdtempSync(path.join(os.tmpdir(), "openpost-public-build-hash-"));
    try {
      // Exercise the real workspace graph without mutating a concurrently edited checkout.
      const listing = spawnSync(
        "git",
        ["ls-files", "-z", "--cached", "--others", "--exclude-standard"],
        {
          cwd: root,
          encoding: "utf8",
          maxBuffer: 20 * 1024 * 1024,
        },
      );
      assert.equal(listing.status, 0, listing.stderr);
      for (const file of new Set(listing.stdout.split("\0").filter(Boolean))) {
        const source = path.join(root, file);
        if (!existsSync(source)) continue;
        const target = path.join(fixture, file);
        mkdirSync(path.dirname(target), { recursive: true });
        cpSync(source, target, { mode: constants.COPYFILE_FICLONE });
      }
      const init = spawnSync("git", ["init", "--quiet"], { cwd: fixture, encoding: "utf8" });
      assert.equal(init.status, 0, init.stderr);
      // Reuse existing Git objects so indexing the copied assets does not recompress them.
      const objects = spawnSync(
        "git",
        ["rev-parse", "--path-format=absolute", "--git-path", "objects"],
        {
          cwd: root,
          encoding: "utf8",
        },
      );
      assert.equal(objects.status, 0, objects.stderr);
      writeFileSync(path.join(fixture, ".git/objects/info/alternates"), objects.stdout);
      // Turbo handles indexed external inputs differently from untracked files.
      const index = spawnSync("git", ["add", "--all"], { cwd: fixture, encoding: "utf8" });
      assert.equal(index.status, 0, index.stderr);
      const plan = (environment = {}) => {
        const result = spawnSync(
          path.join(root, "node_modules/.bin/turbo"),
          ["run", "_test:public-build", "--dry=json"],
          {
            cwd: fixture,
            encoding: "utf8",
            maxBuffer: 20 * 1024 * 1024,
            env: { ...process.env, ...environment },
          },
        );
        assert.equal(result.status, 0, result.stderr);
        const parsed = JSON.parse(result.stdout);
        return new Map(
          parsed.tasks.map((task) => [
            task.taskId,
            {
              ...task,
              repositoryInputs: new Set([
                ...Object.keys(parsed.globalCacheInputs.files),
                ...Object.keys(task.inputs).map((input) =>
                  path.normalize(path.join(task.directory, input)),
                ),
              ]),
            },
          ]),
        );
      };
      const baseline = plan();
      const gate = baseline.get("//#_test:public-build");
      assert.equal(gate.resolvedTaskDefinition.cache, true);
      for (const dependency of ["@openpost/docs#build", "@openpost/site#build"]) {
        assert.ok(gate.dependencies.includes(dependency));
        for (const name of baseline.get(dependency).resolvedTaskDefinition.env) {
          assert.ok(gate.resolvedTaskDefinition.env.includes(name), name);
        }
      }
      const change = (files, verify) => {
        const originals = new Map(
          files.map((file) => [path.join(fixture, file), readFileSync(path.join(fixture, file))]),
        );
        try {
          for (const [target, original] of originals) {
            writeFileSync(target, Buffer.concat([original, Buffer.from("\n ")]));
          }
          verify(plan());
        } finally {
          for (const [target, original] of originals) writeFileSync(target, original);
        }
      };
      change(
        [
          "scripts/immutable-frontend-assets.test.mjs",
          "scripts/release-assets.mjs",
          "apps/server/cmd/openpost-media-limits/main_test.go",
          "apps/cli/internal/commands/account_test.go",
          "apps/web/src/lib/crypto-random-uuid.test.ts",
          "apps/web/src/lib/components/themes/theme-manifest.test-fixtures.ts",
          "apps/web/src/lib/test-fixtures/user-profile.ts",
          "apps/web/src/lib/video-editor/media/canvas-parity.test-utils.ts",
        ],
        (changed) => {
          for (const owner of ["@openpost/site#build", "@openpost/docs#build", gate.taskId]) {
            assert.equal(
              changed.get(owner).hash,
              baseline.get(owner).hash,
              `${owner} must reuse proof after unrelated edits`,
            );
          }
        },
      );
      for (const file of [
        "tests/build/generate-agent-surfaces.test.mjs",
        "scripts/tasks.mjs",
        "scripts/turbo-cache.mjs",
        "scripts/go-test-shards.mjs",
        "scripts/sync-docs-openapi.mjs",
        "scripts/social-images/catalog.mjs",
        "docs/reference/nix-module.md",
        "apps/server/cmd/openpost-media-limits/main.go",
        "apps/cli/cmd/openpost-docs/main.go",
        ".oxfmtrc.json",
        "apps/web/.oxfmtrc.json",
      ]) {
        assert.ok(gate.repositoryInputs.has(file), `${file} must invalidate production proof`);
      }
      for (const [file, owners] of [
        ["scripts/generate-agent-surfaces.mjs", ["@openpost/site#build", "@openpost/docs#build"]],
        ["scripts/cli-option.mjs", ["@openpost/site#build", "@openpost/docs#build"]],
        ["scripts/report-problems.mjs", ["@openpost/site#build", "@openpost/docs#build"]],
        ["scripts/public-agent-discovery.mjs", ["@openpost/site#build", "@openpost/docs#build"]],
        ["scripts/immutable-frontend-assets.mjs", ["@openpost/site#build"]],
        ["scripts/static-ui.mjs", ["@openpost/site#build"]],
        ["apps/web/svelte.config.js", ["@openpost/site#build"]],
        ["apps/web/tsconfig.json", ["@openpost/site#build"]],
        ["apps/web/package.json", ["@openpost/site#build"]],
        ["apps/marketing/package.json", ["@openpost/site#build"]],
        ["apps/docs/package.json", ["@openpost/docs#build"]],
        ["apps/web/src/lib/crypto-random-uuid.ts", ["@openpost/site#build"]],
        ["apps/docs/content/docs/index.mdx", ["@openpost/docs#build"]],
        ["config/public-brand.json", ["@openpost/site#build", "@openpost/docs#build"]],
        [
          "apps/server/internal/api/handlers/mcp_server_card_base.json",
          ["@openpost/site#build", "@openpost/docs#build"],
        ],
        ["assets/brand/fonts/Geist-Regular.ttf", ["@openpost/site#build", "@openpost/docs#build"]],
        ["package.json", ["@openpost/site#build", "@openpost/docs#build"]],
      ]) {
        for (const owner of owners) {
          assert.ok(
            baseline.get(owner).repositoryInputs.has(file),
            `${file} must invalidate ${owner}`,
          );
        }
      }
      change(["scripts/cli-option.mjs"], (changed) => {
        for (const owner of ["@openpost/site#build", "@openpost/docs#build", gate.taskId]) {
          assert.notEqual(
            changed.get(owner).hash,
            baseline.get(owner).hash,
            `${owner} must hash transitive helper edits`,
          );
        }
      });
      const environment = plan({ GITHUB_REF_NAME: "public-build-hash-regression" });
      for (const owner of ["@openpost/docs#build", gate.taskId]) {
        assert.notEqual(
          environment.get(owner).hash,
          baseline.get(owner).hash,
          `${owner} must hash version fallback`,
        );
      }
    } finally {
      rmSync(fixture, { recursive: true, force: true });
    }
  },
);

test("Go formatting checks current tracked and untracked files after an unstaged deletion", () => {
  const directory = mkdtempSync(path.join(os.tmpdir(), "openpost-go-format-"));
  try {
    mkdirSync(path.join(directory, "scripts"));
    mkdirSync(path.join(directory, "apps/server"), { recursive: true });
    for (const name of ["tasks.mjs", "task-process.mjs", "turbo-cache.mjs", "go-test-shards.mjs"])
      copyFileSync(path.join("scripts", name), path.join(directory, "scripts", name));
    const git = (...args) => {
      const result = spawnSync("git", args, { cwd: directory, encoding: "utf8" });
      assert.equal(result.status, 0, result.stderr);
    };
    git("init", "--quiet");
    writeFileSync(path.join(directory, ".gitignore"), "*.ignored.go\n");
    for (const file of ["live.go", "deleted.go"])
      writeFileSync(path.join(directory, "apps/server", file), "package example\n");
    git("add", ".");
    rmSync(path.join(directory, "apps/server/deleted.go"));
    writeFileSync(path.join(directory, "apps/server/new.go"), "package example\nvar Value=1\n");
    const ignored = path.join(directory, "apps/server/invalid.ignored.go");
    writeFileSync(ignored, "not Go source\n");
    const run = (command) =>
      spawnSync("bun", ["scripts/tasks.mjs", command, "backend"], {
        cwd: directory,
        encoding: "utf8",
        timeout: 15000,
        env: { ...process.env, OPENPOST_TURBO_CACHE_DIR: path.join(directory, "cache") },
      });
    const dirty = run("format:check");
    assert.equal(dirty.status, 1, dirty.stdout + dirty.stderr);
    assert.match(dirty.stderr, /apps\/server\/new\.go/u);
    const formatted = run("format");
    assert.equal(formatted.status, 0, formatted.stdout + formatted.stderr);
    assert.equal(
      readFileSync(path.join(directory, "apps/server/new.go"), "utf8"),
      "package example\n\nvar Value = 1\n",
    );
    const clean = run("format:check");
    assert.equal(clean.status, 0, clean.stdout + clean.stderr);
    assert.equal(readFileSync(ignored, "utf8"), "not Go source\n");
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});
