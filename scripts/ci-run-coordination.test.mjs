import { test, expect } from "bun:test";
import { mkdtempSync, writeFileSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawnSync } from "node:child_process";
import { planCI } from "./ci-plan.mjs";
import { readReleaseSurfaceManifest } from "./release-surfaces.mjs";
import { supersededMainRuns } from "./ci-run-coordination.mjs";
const sha = "a".repeat(40);
const current = {
  id: 20,
  workflow_id: 1,
  head_sha: sha,
  head_branch: "v7.34.3",
  event: "push",
  path: ".github/workflows/ci.yml",
  status: "in_progress",
  head_repository: { full_name: "getopenpost/openpost" },
};
const plan = Object.fromEntries(
  ["application", "backend", "frontend", "marketing", "documentation", "security", "image"].map(
    (k) => [k, "true"],
  ),
);
plan.mode = "release";
const main = { ...current, id: 10, head_branch: "main" };

function runCoordination(statuses, changes = {}, changedPlan = {}) {
  const directory = mkdtempSync(join(tmpdir(), "ci-coordination-"));
  try {
    writeFileSync(
      join(directory, "fixture.json"),
      JSON.stringify({
        current: { ...current, ...changes },
        plan: { ...plan, ...changedPlan },
        statuses,
        main,
      }),
    );
    writeFileSync(
      join(directory, "gh"),
      `#!${process.execPath}
import { readFileSync, appendFileSync } from "node:fs";
const fixture = JSON.parse(readFileSync(process.env.COORDINATION_FIXTURE + "/fixture.json", "utf8"));
const log = process.env.COORDINATION_FIXTURE + "/requests";
let requests = [];
try { requests = readFileSync(log, "utf8").trim().split("\\n"); } catch {}
const route = process.argv.at(-1);
appendFileSync(log, route + "\\n");
if (route.endsWith("/cancel")) console.log("null");
else if (route.includes("/workflows/")) console.log(JSON.stringify({workflow_runs: [fixture.main]}));
else {
  const count = requests.filter(r => r === route).length;
  console.log(JSON.stringify({...fixture.current, status: fixture.statuses[Math.min(count, fixture.statuses.length - 1)]}));
}
`,
      { mode: 0o755 },
    );
    const result = spawnSync(process.execPath, [join(import.meta.dir, "ci-run-coordination.mjs")], {
      encoding: "utf8",
      timeout: 20_000,
      env: {
        ...process.env,
        PATH: `${directory}:${process.env.PATH}`,
        GITHUB_REPOSITORY: "getopenpost/openpost",
        GITHUB_RUN_ID: "20",
        CI_PLAN: JSON.stringify({ ...plan, ...changedPlan }),
        COORDINATION_FIXTURE: directory,
      },
    });
    return {
      ...result,
      requests: readFileSync(join(directory, "requests"), "utf8").trim().split("\n"),
    };
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
}

test("a queued API snapshot while the tag job executes is retried before cancellation", () => {
  const result = runCoordination(["queued", "in_progress"]);
  expect(result.stderr).toBe("");
  expect(result.status).toBe(0);
  expect(result.requests.filter((route) => route.endsWith("/runs/20"))).toHaveLength(2);
  expect(result.requests.filter((route) => route.endsWith("/cancel"))).toEqual([
    "repos/getopenpost/openpost/actions/runs/10/cancel",
  ]);
});

test("unconfirmed liveness skips cancellation without failing full tag qualification", () => {
  for (const statuses of [["queued"], ["queued", "completed"]]) {
    const result = runCoordination(statuses);
    expect(result.status).toBe(0);
    expect(result.stdout).toContain("Skipping redundant main cancellation");
    expect(result.requests.length).toBeLessThanOrEqual(3);
    expect(
      result.requests.some((route) => route.includes("/workflows/") || route.endsWith("/cancel")),
    ).toBe(false);
  }
}, 15_000);

test("pending status never bypasses trust and core qualification checks", () => {
  for (const [changes, changedPlan] of [
    [{ head_repository: { full_name: "fork/repo" } }, {}],
    [{}, { security: "false" }],
    [{}, { mode: "reuse" }],
  ]) {
    const result = runCoordination(["queued", "in_progress"], changes, changedPlan);
    expect(result.status).toBe(1);
    expect(result.stderr).toContain("complete core qualification is required");
    expect(result.requests).toHaveLength(1);
  }
});

test("only a running tag can authorize cancellation", () => {
  for (const status of ["queued", "waiting", "pending", "requested", "completed", "unknown"]) {
    expect(() =>
      supersededMainRuns({ ...current, status }, plan, [main], "getopenpost/openpost"),
    ).toThrow(`status=${status}`);
  }
});
test("only redundant main push runs for the identical qualified source can stop", () => {
  expect(
    supersededMainRuns(
      current,
      plan,
      [
        main,
        { ...main, id: 11, status: "queued" },
        { ...main, id: 12, status: "completed" },
        { ...main, id: 13, event: "pull_request" },
        { ...main, id: 14, head_sha: "b".repeat(40) },
        { ...main, id: 15, workflow_id: 2 },
        { ...main, id: 16, head_branch: "feature" },
        { ...main, id: 17, head_repository: { full_name: "fork/repo" } },
        { ...main, id: 18, path: ".github/workflows/other.yml" },
      ],
      "getopenpost/openpost",
    ),
  ).toEqual([10, 11]);
});
test("replacement eligibility fails closed before any cancellation", () => {
  for (const changed of [{ mode: "reuse" }, { application: "false" }, { security: "false" }])
    expect(() =>
      supersededMainRuns(current, { ...plan, ...changed }, [main], "getopenpost/openpost"),
    ).toThrow();
  for (const changed of [
    { event: "workflow_dispatch" },
    { head_branch: "main" },
    { head_branch: "v7.34.3-beta" },
    { head_repository: { full_name: "fork/repo" } },
    { path: ".github/workflows/other.yml" },
  ])
    expect(() =>
      supersededMainRuns({ ...current, ...changed }, plan, [main], "getopenpost/openpost"),
    ).toThrow();
});

test("the actual server-only release plan qualifies as a complete replacement", () => {
  const decisions = planCI(
    ["apps/server/internal/config/config.go"],
    readReleaseSurfaceManifest(),
    { release: true },
  );
  expect(
    supersededMainRuns(current, { ...decisions, mode: "release" }, [main], "getopenpost/openpost"),
  ).toEqual([10]);
});
