import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import test from "node:test";

const canonicalScripts = [
  "format",
  "format:check",
  "lint",
  "check",
  "test",
  "build",
  "verify",
  "release",
];
const tasksSource = readFileSync("scripts/tasks.mjs", "utf8");

test("the root manifest exposes one canonical verification interface", () => {
  const manifest = JSON.parse(readFileSync("package.json", "utf8"));
  for (const script of canonicalScripts) assert.ok(manifest.scripts[script], script);
  assert.deepEqual(Object.keys(manifest.scripts).sort(), [
    "_policy",
    "browser:install",
    "build",
    "capture:product-screenshots",
    "check",
    "check:changed",
    "check:frontend:i18n",
    "check:frontend:types",
    "check:n8n",
    "dev",
    "doctor",
    "format",
    "format:check",
    "generate:social-assets",
    "lint",
    "release",
    "test",
    "test:backend:pkg",
    "test:file",
    "verify",
  ]);
});

test("nested Turbo tasks inherit the root cache lease", () => {
  const turbo = manifest("turbo.json");
  const tasksSource = readFileSync("scripts/tasks.mjs", "utf8");
  assert.ok(turbo.globalPassThroughEnv.includes("OPENPOST_ROOT_TASK_LOCKED"));
  assert.match(tasksSource, /env: \{ \.\.\.step\.env, OPENPOST_ROOT_TASK_LOCKED: "1" \}/u);
});

test("development startup removes only its legacy cache without shared cache maintenance", () => {
  assert.match(tasksSource, /removeLegacyTurboCache\(path\.join\(root, "\.turbo", "cache"\)\)/u);
  const devBranch = tasksSource.match(
    /if \(plan\.command === "dev"\) \{([\s\S]*?)\n\s+\} else \{/u,
  )?.[1];
  assert.ok(devBranch);
  assert.doesNotMatch(devBranch, /tryTurboCacheMaintenance/u);
});

test("workspace manifests keep implementation tasks without old public aliases", () => {
  const frontend = manifest("frontend/package.json");
  assert.deepEqual(Object.keys(frontend.scripts).sort(), [
    "assets:sync",
    "build",
    "check",
    "check:i18n",
    "check:types",
    "check:watch",
    "dev",
    "generate:i18n",
    "generate:i18n:build",
    "generate:types",
    "lint:oxlint",
    "lint:svelte",
    "package",
    "preview",
    "sync",
    "test",
    "test:server",
    "test:watch",
  ]);
  assert.equal(frontend.scripts.test, "vitest run");
  assert.equal(frontend.scripts["test:watch"], "vitest");
  assert.equal(frontend.scripts["test:server"], "vitest run --project server");
  assert.match(frontend.scripts.build, /immutable-frontend-assets\.mjs web/u);

  const docs = manifest("docs-site/package.json");
  assert.deepEqual(Object.keys(docs.scripts).sort(), ["build", "dev", "preview"]);
  assert.equal(docs.scripts.preview, "vitepress preview");

  const marketing = manifest("marketing-site/package.json");
  assert.deepEqual(Object.keys(marketing.scripts).sort(), ["build", "check", "dev", "preview"]);

  for (const file of ["packages/telemetry/package.json"]) {
    const workspace = manifest(file);
    assert.equal(workspace.scripts.build, undefined, `${file} build`);
    assert.equal(workspace.scripts.check, "tsc --noEmit", `${file} check`);
  }
});

test("Devenv provides tools and utilities without a second verification interface", () => {
  const rootDevenv = readFileSync("devenv.nix", "utf8");
  const utilities = [...rootDevenv.matchAll(/^    ([a-z0-9-]+)\.exec =/gmu)].map(
    (match) => match[1],
  );
  assert.deepEqual(utilities, [
    "clean",
    "install",
    "cache-status",
    "cache-prune",
    "docker-cache-status",
    "docker-cache-prune",
    "setup",
    "docker-build",
    "docker-run",
    "doctor",
  ]);

  assert.doesNotMatch(readFileSync("backend/devenv.nix", "utf8"), /scripts\s*=\s*\{/u);
  assert.doesNotMatch(readFileSync("frontend/devenv.nix", "utf8"), /scripts\s*=\s*\{/u);
});

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

test("unknown scopes fail with the supported interface", () => {
  const result = taskPlan("test", "unknown");
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /supported test scopes/u);
});

test("the bounded release test plan caches the complete server project", () => {
  const result = spawnSync("bun", ["scripts/tasks.mjs", "test", "--non-browser", "--plan"], {
    cwd: process.cwd(),
    encoding: "utf8",
  });
  assert.equal(result.status, 0, result.stderr);
  const plan = JSON.parse(result.stdout);
  const frontend = plan.stages.find((stage) => stage.label === "frontend server tests");
  assert.deepEqual(frontend.commands, ["bunx turbo run test:server --filter @openpost/web"]);
});

test("the frontend test scope covers every browser-side workspace", () => {
  const result = taskPlan("test", "frontend");
  assert.equal(result.status, 0, result.stderr);
  const plan = JSON.parse(result.stdout);
  assert.deepEqual(plan.stages[0].commands, [
    "bunx turbo run test --filter @openpost/web --filter @openpost/telemetry --filter @openpost/social-preview",
  ]);
});

test("repository tests stay inside the owned scripts directory", () => {
  const result = taskPlan("test");
  assert.equal(result.status, 0, result.stderr);
  const plan = JSON.parse(result.stdout);
  const repository = plan.stages.find((stage) => stage.label === "repository tests");
  assert.deepEqual(repository.commands, ["bun test ./scripts"]);
});

function taskPlan(command, scope) {
  const args = ["scripts/tasks.mjs", command];
  if (scope) args.push(scope);
  args.push("--plan");
  return spawnSync("bun", args, {
    cwd: process.cwd(),
    encoding: "utf8",
  });
}

function manifest(file) {
  return JSON.parse(readFileSync(file, "utf8"));
}
