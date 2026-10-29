#!/usr/bin/env bun
import { execFileSync } from "node:child_process";

export function supersededMainRuns(current, plan, runs, repository) {
  const core = ["application", "backend", "frontend", "security", "image"];
  if (
    current.head_repository?.full_name !== repository ||
    current.path !== ".github/workflows/ci.yml" ||
    current.event !== "push" ||
    !/^v\d+\.\d+\.\d+$/u.test(current.head_branch || "") ||
    !/^[a-f0-9]{40}$/u.test(current.head_sha || "") ||
    current.status !== "in_progress" ||
    !["release", "full"].includes(plan.mode) ||
    core.some((key) => ![true, "true"].includes(plan[key]))
  )
    throw new Error("A trusted running tag with complete core qualification is required");
  return runs
    .filter(
      (run) =>
        run.id !== current.id &&
        run.workflow_id === current.workflow_id &&
        run.head_repository?.full_name === repository &&
        run.head_sha === current.head_sha &&
        run.head_branch === "main" &&
        run.event === "push" &&
        run.path === current.path &&
        ["queued", "in_progress", "waiting", "pending", "requested"].includes(run.status),
    )
    .map((run) => run.id);
}

function api(route, method = "GET") {
  return JSON.parse(
    execFileSync("gh", ["api", "--method", method, route], {
      encoding: "utf8",
      timeout: 30_000,
      maxBuffer: 8 * 1024 * 1024,
    }) || "null",
  );
}
if (import.meta.main) {
  const repository = process.env.GITHUB_REPOSITORY;
  const id = process.env.GITHUB_RUN_ID;
  if (!/^[\w.-]+\/[\w.-]+$/u.test(repository || "") || !/^\d+$/u.test(id || ""))
    throw new Error("GitHub run identity is required");
  const current = api(`repos/${repository}/actions/runs/${id}`);
  const plan = JSON.parse(process.env.CI_PLAN || "{}");
  const runs = [];
  for (let page = 1; page <= 10; page++) {
    const result = api(
      `repos/${repository}/actions/workflows/${current.workflow_id}/runs?branch=main&event=push&head_sha=${current.head_sha}&per_page=100&page=${page}`,
    );
    runs.push(...result.workflow_runs);
    if (result.workflow_runs.length < 100) break;
    if (page === 10) throw new Error("Unexpected run history size");
  }
  for (const runId of supersededMainRuns(current, plan, runs, repository)) {
    try {
      api(`repos/${repository}/actions/runs/${runId}/cancel`, "POST");
    } catch (error) {
      // A main run may finish between listing and cancellation. Only that race
      // is harmless; authorization and service errors remain visible failures.
      if (api(`repos/${repository}/actions/runs/${runId}`).status !== "completed") throw error;
    }
    console.log(`Stopped redundant main CI ${runId}; tag ${id} qualifies the same source.`);
  }
}
