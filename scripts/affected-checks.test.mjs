import assert from "node:assert/strict";
import test from "node:test";
import {
  copyFileSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  renameSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";

function fixture(t) {
  const root = mkdtempSync(path.join(os.tmpdir(), "openpost-affected-cli-"));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const write = (file, content, options) => {
    mkdirSync(path.dirname(path.join(root, file)), { recursive: true });
    writeFileSync(path.join(root, file), content, options);
  };
  const git = (...args) => {
    const result = spawnSync("git", args, { cwd: root, encoding: "utf8" });
    assert.equal(result.status, 0, result.stderr);
    return result.stdout.trim();
  };
  git("init", "--quiet", "--initial-branch=main");
  git("config", "user.email", "test@openpost.local");
  git("config", "user.name", "OpenPost test");
  git("config", "core.hooksPath", "/dev/null");
  git("config", "commit.gpgsign", "false");
  write(".gitignore", ".turbo/\ncache/\nbin/\n");
  write(
    "config/release-surfaces.json",
    JSON.stringify({
      schema_version: 1,
      surfaces: {
        application: { description: "fixture apps", prefixes: ["apps/", "packages/"] },
        delivery: {
          description: "fixture tooling",
          prefixes: ["scripts/", "config/"],
          paths: ["package.json"],
        },
        "shared-assets": { description: "fixture shared assets", prefixes: ["assets/"] },
        repository: { description: "fixture ignore rules", paths: [".gitignore"] },
      },
      exemptions: [],
    }),
  );
  write("package.json", '{"private":true,"type":"module"}\n');
  for (const file of [
    "apps/server/value.txt",
    "apps/cli/value.txt",
    "apps/web/src/routes/value.txt",
    "apps/marketing/src/value.txt",
    "apps/docs/content/value.txt",
    "apps/mobile/src/value.txt",
    "packages/shared/value.txt",
    "assets/value.txt",
  ])
    write(file, "base\n");
  for (const script of [
    "tasks.mjs",
    "task-process.mjs",
    "affected-checks.mjs",
    "release-surfaces.mjs",
    "turbo-cache.mjs",
    "go-test-shards.mjs",
    "changed-files-check.sh",
  ]) {
    const target = path.join(root, "scripts", script);
    mkdirSync(path.dirname(target), { recursive: true });
    copyFileSync(new URL(`./${script}`, import.meta.url), target);
  }
  const commit = () => {
    git("add", "--all");
    git("commit", "--quiet", "-m", "fixture");
  };
  commit();
  const cli = (args = [], env = {}) =>
    spawnSync(process.execPath, ["scripts/tasks.mjs", "check:affected", ...args], {
      cwd: root,
      encoding: "utf8",
      timeout: 15_000,
      env: {
        ...process.env,
        OPENPOST_ROOT_TASK_LOCKED: "",
        OPENPOST_TURBO_CACHE_DIR: path.join(root, "cache"),
        OPENPOST_GO_TEST_SHARD: "",
        OPENPOST_GO_TEST_RACE: "",
        OPENPOST_GO_COVERAGE_FILE: "",
        ...env,
      },
    });
  const plan = (...args) => {
    const result = cli([...args, "--plan"]);
    assert.equal(result.status, 0, result.stdout + result.stderr);
    return JSON.parse(result.stdout);
  };
  return { root, write, git, commit, cli, plan };
}

test("affected CLI unions real Git inventories and both rename owners, including committed changes", (t) => {
  const f = fixture(t);
  const base = f.git("rev-parse", "HEAD");
  f.git("branch", "comparison");
  f.write("apps/server/value.txt", "committed\n");
  f.commit();
  f.git("switch", "--quiet", "comparison");
  f.write("apps/docs/content/reference-only.txt", "base branch advanced\n");
  f.commit();
  const baseSha = f.git("rev-parse", "HEAD");
  f.git("switch", "--quiet", "main");
  f.write("apps/marketing/src/value.txt", "staged\n");
  f.git("add", "apps/marketing/src/value.txt");
  f.write("apps/cli/value.txt", "working\n");
  const unusual = "apps/mobile/src/space and\nnewline.txt";
  f.write(unusual, "untracked\n");
  renameSync(
    path.join(f.root, "apps/web/src/routes/value.txt"),
    path.join(f.root, "apps/docs/content/moved.txt"),
  );
  const selected = f.plan("--base", "comparison");
  assert.deepEqual(
    selected.affected.files,
    [
      "apps/cli/value.txt",
      "apps/docs/content/moved.txt",
      unusual,
      "apps/marketing/src/value.txt",
      "apps/server/value.txt",
      "apps/web/src/routes/value.txt",
    ].sort(),
  );
  assert.deepEqual(selected.affected.scopes, [
    "backend",
    "cli",
    "docs",
    "frontend",
    "marketing",
    "mobile",
  ]);
  assert.equal(selected.affected.fallback, false);
  assert.equal(selected.affected.baseSha, baseSha);
  assert.equal(selected.affected.mergeBase, base);
  assert.equal(selected.stages.filter(({ label }) => label === "contracts").length, 1);
  assert.equal(selected.stages.filter(({ label }) => label === "frontend translations").length, 1);
  assert.equal(selected.stages.filter(({ label }) => label === "mobile source checks").length, 1);
  const executionRoot = f.git("rev-parse", "--show-toplevel");
  const backend = selected.stages.find(({ label }) => label === "backend types").steps?.[0];
  assert.deepEqual(backend, {
    type: "command",
    cwd: path.join(executionRoot, "apps/server"),
    argv: ["go", "test", "-tags", "dev", "-run", "^$", "./..."],
    env: { OPENPOST_ROOT_TASK_LOCKED: "1" },
  });
  const cliTypes = selected.stages.find(({ label }) => label === "CLI types").steps[0];
  assert.equal(cliTypes.cwd, path.join(executionRoot, "apps/cli"));
  assert.deepEqual(cliTypes.argv, ["go", "test", "-run", "^$", "./..."]);
  const mobile = selected.stages.find(({ label }) => label === "mobile source checks").steps[0];
  assert.equal(mobile.cwd, path.join(executionRoot, "apps/mobile"));
  assert.deepEqual(mobile.argv, ["bun", "run", "check:source"]);
  const frontend = selected.stages.find(({ label }) => label === "frontend types").steps[0];
  assert.deepEqual(frontend.env, { OPENPOST_CHECK_PREPARED: "1", OPENPOST_ROOT_TASK_LOCKED: "1" });
  const privateEnvironment = f.cli(["--plan"], {
    OPENPOST_AFFECTED_TEST_SECRET: "synthetic-private-value",
  });
  assert.equal(privateEnvironment.status, 0, privateEnvironment.stderr);
  assert.doesNotMatch(
    privateEnvironment.stdout,
    /OPENPOST_AFFECTED_TEST_SECRET|synthetic-private-value/u,
  );
  f.commit();
  assert.deepEqual(f.plan().affected.files, []);
  assert.deepEqual(f.plan("--base", "comparison").affected.files, selected.affected.files);
});

test("shared consumers and unknown/config inputs fall back; invalid arguments and conflicts fail closed", (t) => {
  const f = fixture(t);
  const reference = spawnSync(process.execPath, ["scripts/tasks.mjs", "preflight", "--plan"], {
    cwd: f.root,
    encoding: "utf8",
  });
  assert.equal(reference.status, 0, reference.stderr);
  const preflight = JSON.parse(reference.stdout);
  assert.ok(preflight.stages.every((stage) => !Object.hasOwn(stage, "steps")));
  const assertFallback = (selected, prefixes, root) => {
    assert.deepEqual(
      selected.stages.slice(0, prefixes.length).map(({ label }) => label),
      prefixes,
    );
    const body = selected.stages.slice(prefixes.length).map(({ steps, ...stage }) => ({
      ...stage,
      phase: stage.phase - prefixes.length,
    }));
    assert.deepEqual(body, preflight.stages);
    const nested = selected.stages.find(({ label }) => label === "static checks").steps?.[0];
    assert.deepEqual(nested, {
      type: "task",
      task: "check",
      scope: null,
      argv: ["bun", "scripts/tasks.mjs", "check"],
      cwd: root,
      env: { OPENPOST_ROOT_TASK_LOCKED: "1" },
    });
  };

  for (const file of [
    "apps/web/src/lib/shared.ts",
    "apps/web/messages/en.json",
    "packages/shared/value.txt",
    "assets/value.txt",
    "apps/web/openapi.json",
    "apps/mobile/tsconfig.json",
    "unowned.txt",
  ]) {
    const existed = file === "packages/shared/value.txt" || file === "assets/value.txt";
    f.write(file, "changed\n");
    const selected = f.plan();
    assert.equal(selected.affected.fallback, true, file);
    assertFallback(selected, ["changed syntax and format"], f.git("rev-parse", "--show-toplevel"));
    assert.ok(
      selected.stages.some(({ commands }) => commands.includes("bun run check")),
      file,
    );
    assert.ok(
      selected.stages.some(({ commands }) => commands.includes("bun run test")),
      file,
    );
    assert.match(selected.affected.omitted.join(" "), /E2E.*security.*race.*builds/u);
    if (existed) f.write(file, "base\n");
    else rmSync(path.join(f.root, file));
  }
  for (const [file, content, diagnostic] of [
    ["fallback.sh", "if true; then\n", /syntax error/u],
    ["unowned.txt", "<<<<<<< mine\nlocal\n=======\nother\n>>>>>>> theirs\n", /conflict marker/u],
  ]) {
    const committed = fixture(t);
    const base = committed.git("rev-parse", "HEAD");
    committed.write(file, content);
    committed.commit();
    assertFallback(
      committed.plan("--base", base),
      ["committed whitespace", "changed syntax and format"],
      committed.git("rev-parse", "--show-toplevel"),
    );
    committed.write("bin/bun", "#!/bin/sh\necho 'preflight leaf reached' >&2\nexit 91\n", {
      mode: 0o755,
    });
    const rejected = committed.cli(["--base", base], {
      PATH: `${committed.root}/bin:${process.env.PATH}`,
    });
    assert.notEqual(rejected.status, 0);
    assert.match(rejected.stdout + rejected.stderr, diagnostic);
    assert.doesNotMatch(
      rejected.stdout + rejected.stderr,
      /preflight leaf reached|▶ static checks/u,
    );
  }
  rmSync(path.join(f.root, "apps/server/value.txt"));
  assert.deepEqual(f.plan().affected.scopes, ["backend"]);
  for (const args of [
    ["--base"],
    ["--unknown"],
    ["frontend"],
    ["--plan", "--plan"],
    ["--base", "HEAD", "--base", "HEAD"],
    ["--base", "missing-ref"],
  ]) {
    const result = f.cli(args);
    assert.notEqual(result.status, 0, JSON.stringify(args));
    assert.doesNotMatch(result.stdout, /▶/u);
  }
  f.git("restore", "apps/server/value.txt");
  f.git("switch", "--quiet", "-c", "side");
  f.write("apps/cli/value.txt", "side\n");
  f.commit();
  f.git("switch", "--quiet", "main");
  f.write("apps/cli/value.txt", "main\n");
  f.commit();
  const merge = spawnSync("git", ["merge", "side"], { cwd: f.root, encoding: "utf8" });
  assert.notEqual(merge.status, 0);
  const conflict = f.cli(["--plan"]);
  assert.notEqual(conflict.status, 0);
  assert.match(conflict.stderr, /resolve index conflicts/u);
});

test("affected execution propagates leaf failure under the existing lock/executor, then reruns repaired work", (t) => {
  const f = fixture(t);
  // Same public-runner fixture boundary as tasks.test.mjs: real orchestration,
  // leaf tool processes only. This tests status/ordering, not Go behavior.
  const shim = `#!${process.execPath}
import { appendFileSync, readFileSync } from "node:fs";
import { basename } from "node:path";
const tool = basename(process.argv[1]);
const args = process.argv.slice(2);
appendFileSync(process.env.EVENTS, JSON.stringify({ tool, args, locked: process.env.OPENPOST_ROOT_TASK_LOCKED }) + "\\n");
if (tool === "bun" && ["scripts/check-contracts.mjs", "scripts/check-handwritten-contracts.mjs"].includes(args[0])) process.exit(0);
if (tool === "go") process.exit(args.join(" ") === "test ./..." ? Number(readFileSync(process.env.LEAF_STATUS, "utf8")) : 0);
throw new Error("unexpected fixture tool invocation");
`;
  for (const tool of ["bun", "go"]) f.write(`bin/${tool}`, shim, { mode: 0o755 });
  const status = path.join(f.root, "bin/status");
  const events = path.join(f.root, "bin/events");
  const env = { PATH: `${f.root}/bin:${process.env.PATH}`, EVENTS: events, LEAF_STATUS: status };
  f.write("apps/cli/value.txt", "changed\n");
  f.write("bin/status", "23\n");
  const failed = f.cli([], env);
  assert.notEqual(failed.status, 0, failed.stdout + failed.stderr);
  assert.match(failed.stderr, /check:affected failed/u);
  assert.doesNotMatch(failed.stdout, /selected checks passed/u);
  f.write("bin/status", "0\n");
  const repaired = f.cli([], env);
  assert.equal(repaired.status, 0, repaired.stdout + repaired.stderr);
  assert.match(repaired.stdout, /selected checks passed/u);
  const recorded = readFileSync(events, "utf8").trim().split("\n").map(JSON.parse);
  assert.ok(recorded.every(({ locked }) => locked === "1"));
  assert.equal(
    recorded.filter(({ tool, args }) => tool === "go" && args.join(" ") === "test ./...").length,
    2,
  );
});

test("affected CLI rejects ambiguous bases even when Git warning configuration disables them", (t) => {
  const f = fixture(t);
  const branchCommit = f.git("rev-parse", "HEAD");
  f.git("branch", "shared-name");
  f.write("apps/server/value.txt", "new commit\n");
  f.commit();
  f.git("tag", "shared-name");
  f.git("config", "core.warnAmbiguousRefs", "false");
  const rejected = f.cli(["--base", "shared-name", "--plan"]);
  assert.notEqual(rejected.status, 0, rejected.stdout + rejected.stderr);
  assert.match(rejected.stderr, /explicit ref.*refs\/heads/u);
  assert.doesNotMatch(rejected.stdout, /▶/u);
  const executionRejected = f.cli(["--base", "shared-name"]);
  assert.notEqual(executionRejected.status, 0);
  assert.doesNotMatch(executionRejected.stdout, /▶/u);
  assert.equal(f.plan("--base", "refs/heads/shared-name").affected.baseSha, branchCommit);
  assert.equal(f.plan("--base", branchCommit).affected.baseSha, branchCommit);
  assert.equal(f.plan("--base", "HEAD~1").affected.baseSha, branchCommit); // A successful tool exit alone is insufficient: require one commit ID.
  const executable = spawnSync("sh", ["-c", "command -v git"], { encoding: "utf8" });
  assert.equal(executable.status, 0, executable.stderr);
  const realGit = executable.stdout.trim();
  const shim = `#!${process.execPath}
import { spawnSync } from "node:child_process";
const args = process.argv.slice(2);
if (args.includes("rev-parse")) {
  process.stdout.write(process.env.FIXTURE_REVISION_OUTPUT);
  process.exit(0);
}
const result = spawnSync(${JSON.stringify(realGit)}, args, { stdio: "inherit" });
process.exit(result.status ?? 1);
`;
  f.write("bin/git", shim, { mode: 0o755 });
  for (const output of ["", `${branchCommit}\n${f.git("rev-parse", "HEAD")}\n`]) {
    const malformed = f.cli(["--base", "refs/heads/shared-name", "--plan"], {
      PATH: `${f.root}/bin:${process.env.PATH}`,
      FIXTURE_REVISION_OUTPUT: output,
    });
    assert.notEqual(malformed.status, 0);
    assert.match(malformed.stderr, /unambiguously to one commit/u);
    assert.doesNotMatch(malformed.stdout, /▶/u);
  }
});
