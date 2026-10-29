import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { copyFileSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";

const revision = "a".repeat(40);

test("browser review captures do not dirty candidates or hide authored images", () => {
  const directory = mkdtempSync(path.join(tmpdir(), "openpost-release-captures-"));
  try {
    copyFileSync(".gitignore", path.join(directory, ".gitignore"));
    const git = (args) => spawnSync("git", args, { cwd: directory, encoding: "utf8" });
    assert.equal(git(["init", "--quiet"]).status, 0);
    const component = "apps/web/src/lib/video-editor/components";
    for (const name of ["mt002-light-320.png", "__screenshots__/anchor.png"]) {
      const result = git([
        "-c",
        "core.excludesFile=/dev/null",
        "check-ignore",
        `${component}/${name}`,
      ]);
      assert.equal(result.status, 0, `${name} would dirty a verified candidate`);
    }
    assert.equal(git(["check-ignore", `${component}/authored-diagram.png`]).status, 1);
    assert.equal(git(["check-ignore", "assets/brand/mt002-light-320.png"]).status, 1);
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});

function shipScenario(scenario = {}, command = "ship") {
  const directory = mkdtempSync(path.join(tmpdir(), "openpost-release-ship-"));
  try {
    mkdirSync(path.join(directory, "scripts"));
    mkdirSync(path.join(directory, "packages/changelog/src"), { recursive: true });
    copyFileSync(
      "packages/changelog/src/index.js",
      path.join(directory, "packages/changelog/src/index.js"),
    );
    for (const file of [
      "release.mjs",
      "check-changelog.mjs",
      "check-mcp-registry.mjs",
      "mobile-release.mjs",
      "release-command-environment.mjs",
      "release-failures.mjs",
      "release-proof.mjs",
      "ci-artifacts.mjs",
      "published-release-tag.mjs",
      "release-surfaces.mjs",
      "release-notes.mjs",
      "changelog-fragments.mjs",
    ])
      copyFileSync(`scripts/${file}`, path.join(directory, "scripts", file));
    writeFileSync(path.join(directory, "scenario.json"), JSON.stringify(scenario));
    writeFileSync(
      path.join(directory, "preload.mjs"),
      `
      import { appendFileSync, readFileSync } from "node:fs";
      const scenario = JSON.parse(readFileSync("scenario.json"));
      let checked = false;
      let tagged = !!scenario.resume;
      globalThis.fetch = async () => Response.json({version: "v1.0.1", revision: "${revision}", status: "ready"});
      Bun.spawnSync = (argv) => {
        appendFileSync("commands.jsonl", JSON.stringify(argv) + "\\n");
        const command = argv.join(" ");
        let stdout = "", exitCode = 0;
        if (command === "git branch --show-current") stdout = "main";
        else if (command === "git status --porcelain") stdout = scenario.dirty ? " M source.ts" : "";
        else if (command === "git rev-list --left-right --count HEAD...origin/main") stdout = scenario.resume ? "0\\t2" : "1\\t0";
        else if (command === "git rev-parse HEAD") stdout = checked && scenario.moved ? "${"b".repeat(40)}" : "${revision}";
        else if (command.startsWith("git tag --points-at")) stdout = tagged ? "v1.0.1" : "";
        else if (command.startsWith("git tag --list")) stdout = "v1.0.0";
        else if (command.startsWith("git rev-list -n 1")) stdout = "${revision}";
        else if (command.startsWith("git ls-remote")) { stdout = scenario.resume ? "${revision}\\trefs/tags/v1.0.1" : ""; exitCode = 0; }
        else if (command.startsWith("git rev-parse --verify")) exitCode = tagged ? 0 : 1;
        else if (command.startsWith("git tag v")) tagged = true;
        else if (command.startsWith("git ls-tree")) stdout = "";
        else if (command.startsWith("git show")) stdout = "{}";
        else if (command.startsWith("bun scripts/mobile-release.mjs")) stdout = "";
        else if (command.startsWith("git diff --name-only")) stdout = "";
        else if (command.startsWith("gh repo view")) stdout = "getopenpost/openpost";
        else if (command.startsWith("gh api --paginate --slurp")) stdout = JSON.stringify([[{tag_name: "v1.0.0", draft:false, prerelease:false, published_at:"2026-01-01T00:00:00Z"}]]);
        else if (command.startsWith("gh api") && command.includes("actions/workflows/ci.yml/runs")) stdout = "";
        else if (command.startsWith("gh api") && command.includes("actions/jobs/44")) stdout = "https://api.github.com/repos/getopenpost/openpost/check-runs/44";
        else if (command.startsWith("gh api") && command.includes("check-runs/44/annotations")) stdout = "The job has exceeded the maximum execution time of 40m0s";
        else if (command.startsWith("gh run list")) stdout = "12";
        else if (command.startsWith("gh run view") && command.includes("--json")) stdout = JSON.stringify(scenario.state ?? {status:"completed", conclusion:"success", jobs:[]});
        else if (command.startsWith("gh run view") && command.includes("--log")) stdout = scenario.log ?? "";
        else if (command.startsWith("gh release view")) stdout = "https://github.com/getopenpost/openpost/releases/tag/v1.0.1";
        else if (command === "bun scripts/next-release-version.mjs v1.0.0") stdout = "v1.0.1";
        else if (command.startsWith("bun scripts/release-notes.mjs")) stdout = "## Fixed\\n\\n- Release workflow.";
        else if (command === "bun scripts/tasks.mjs check:affected --base origin/main") { checked = true; exitCode = scenario.failCheck ? 1 : 0; }
        else if (!(command.startsWith("bun run check --") || command === "bun scripts/check-changelog.mjs" || command.startsWith("bun install") || command === "bun run doctor" || command.startsWith("bash -lc command -v") || command.startsWith("git fetch") || command.startsWith("git push") || command.startsWith("git merge-base"))) throw Error("Unexpected command: " + command);
        return {exitCode, stdout:Buffer.from(stdout), stderr:Buffer.from("")};
      };
    `,
    );
    const result = spawnSync(
      "bun",
      [
        "--preload",
        "./preload.mjs",
        "scripts/release.mjs",
        command,
        ...(command === "watch" ? ["12"] : []),
      ],
      { cwd: directory, encoding: "utf8", timeout: 1500 },
    );
    const commands = readFileSync(path.join(directory, "commands.jsonl"), "utf8")
      .trim()
      .split("\n")
      .map(JSON.parse);
    return { ...result, commands, output: result.stdout + result.stderr };
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
}

test("ship stops locally before pushing or tagging when verification fails", () => {
  const result = shipScenario({ failCheck: true });
  assert.ok(
    result.commands.some(
      (argv) => argv.join(" ") === "bun scripts/tasks.mjs check:affected --base origin/main",
    ),
    result.output,
  );
  assert.equal(result.status, 1, result.output);
  assert.ok(
    !result.commands.some(
      ([tool, action, name]) => tool === "git" && action === "tag" && name === "v1.0.1",
    ),
  );
  assert.ok(!result.commands.some(([tool, action]) => tool === "git" && action === "push"));
});

test("ship checks the exact clean revision then pushes and tags without waiting for main CI", () => {
  const result = shipScenario();
  assert.equal(result.status, 0, result.output);
  const commands = result.commands.map((argv) => argv.join(" "));
  assert.ok(commands.indexOf("bun scripts/tasks.mjs check:affected --base origin/main") >= 0);
  assert.ok(
    commands.indexOf(`git push origin ${revision}:refs/heads/main`) >
      commands.indexOf("bun scripts/tasks.mjs check:affected --base origin/main"),
  );
  assert.ok(commands.includes(`git tag v1.0.1 ${revision}`));
  assert.ok(
    !commands.some(
      (command) =>
        command.includes("actions/workflows/ci.yml/runs") && command.includes("max // empty"),
    ),
  );
});

for (const scenario of [{ dirty: true }, { moved: true }]) {
  test(`ship rejects ${scenario.dirty ? "dirty input" : "a revision changed during checks"} before a push`, () => {
    const result = shipScenario(scenario);
    assert.equal(result.status, 1, result.output);
    assert.match(
      result.output,
      scenario.dirty ? /clean|uncommitted/u : /changed.*checks|changed during/u,
    );
    assert.ok(!result.commands.some(([tool, action]) => tool === "git" && action === "push"));
  });
}

test("ship resumes an immutable published tag after origin/main advances", () => {
  const result = shipScenario({ resume: true });
  assert.equal(result.status, 0, result.output);
  assert.ok(!result.commands.some(([tool, action]) => tool === "git" && action === "push"));
  assert.ok(
    !result.commands.some(
      (argv) => argv.join(" ") === "bun scripts/tasks.mjs check:affected --base origin/main",
    ),
  );
});

test("watch reports a cancelled job's timeout and step instead of inventing a superseding push", () => {
  // Captured from run 40285285377, job 121447481218; the timeout reason is an annotation, not a test assertion.
  const log =
    "Backend tests (4/4)\tUNKNOWN STEP\t2026-10-26T08:01:56.7867414Z ##[error]The operation was canceled.";
  const result = shipScenario(
    {
      log,
      state: {
        status: "completed",
        conclusion: "cancelled",
        url: "https://example.test/run/12",
        jobs: [
          {
            databaseId: 44,
            name: "Backend tests (4/4)",
            status: "completed",
            conclusion: "cancelled",
            steps: [{ name: "Run tests", conclusion: "cancelled", status: "completed" }],
          },
        ],
      },
    },
    "watch",
  );
  assert.equal(result.status, 1, result.output);
  assert.match(result.output, /maximum execution time|timed out/u);
  assert.match(result.output, /Run tests/u);
  assert.match(result.output, /The operation was canceled/u);
  assert.doesNotMatch(result.output, /newer main push|pull and ship/u);
  assert.ok(result.commands.some((argv) => argv.includes("--log")));
});
