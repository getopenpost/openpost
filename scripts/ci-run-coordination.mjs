#!/usr/bin/env bun
import { execFileSync } from "node:child_process";
import { setTimeout } from "node:timers/promises";

function requireQualifiedTag(current, plan, repository) {
  const core = ["application", "backend", "frontend", "security", "image"];
  if (
    current.head_repository?.full_name !== repository ||
    current.path !== ".github/workflows/ci.yml" ||
    current.event !== "push" ||
    !/^v\d+\.\d+\.\d+$/u.test(current.head_branch || "") ||
    !/^[a-f0-9]{40}$/u.test(current.head_sha || "") ||
    !["release", "full"].includes(plan.mode) ||
    core.some((key) => ![true, "true"].includes(plan[key]))
  )
    throw new Error(
      `A trusted tag with complete core qualification is required: ${JSON.stringify({
        id: current.id,
        repository: current.head_repository?.full_name,
        path: current.path,
        event: current.event,
        ref: current.head_branch,
        sha: current.head_sha,
        status: current.status,
        mode: plan.mode,
        missingCore: core.filter((key) => ![true, "true"].includes(plan[key])),
      })}`,
    );
}

export function supersededMainRuns(current, plan, runs, repository) {
  requireQualifiedTag(current, plan, repository);
  if (current.status !== "in_progress")
    throw new Error(
      `Tag run ${current.id} must be in_progress before cancellation; status=${current.status}`,
    );
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
  let current = api(`repos/${repository}/actions/runs/${id}`);
  const plan = JSON.parse(process.env.CI_PLAN || "{}");
  // GitHub's aggregate run status can lag the executing job. Never cancel on
  // a pending snapshot, or make this optional optimization fail qualification.
  for (let attempt = 1; ; attempt++) {
    requireQualifiedTag(current, plan, repository);
    if (current.status === "in_progress") break;
    if (!["queued", "waiting", "pending", "requested", "completed"].includes(current.status))
      throw new Error(`Unexpected tag run ${id} status=${current.status}`);
    if (attempt === 3 || current.status === "completed") {
      console.log(
        `Skipping redundant main cancellation: tag ${id} status=${current.status} after ${attempt} read(s); full tag qualification continues.`,
      );
      process.exit(0);
    }
    console.log(
      `Waiting for tag ${id} to become in_progress: status=${current.status}, read=${attempt}/3.`,
    );
    await setTimeout(2_000);
    current = api(`repos/${repository}/actions/runs/${id}`);
  }
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
