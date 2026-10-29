import { test, expect } from "bun:test";
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
