#!/usr/bin/env bun

import { rm } from "node:fs/promises";
import path from "node:path";

import { mobileReleasePaths } from "./release-distribution-plan.mjs";
import { checkMCPRegistryOwnership } from "./check-mcp-registry.mjs";
import { releaseCommandEnvironment } from "./release-command-environment.mjs";
import { publishedStableReleaseTag } from "./published-release-tag.mjs";
import {
  changedReleasePaths,
  maintainedReleasePaths,
  readReleaseSurfaceManifest,
  readReleaseSurfaceManifestAtRevision,
  releaseSurfacePlan,
  validateReleaseSurfaceManifest,
} from "./release-surfaces.mjs";

const root = path.resolve(import.meta.dir, "..");
const command = process.argv[2] ?? "plan";
const args = process.argv.slice(3);

try {
  switch (command) {
    case "plan":
      await plan();
      break;
    case "status":
      await status();
      break;
    case "ship":
    case "prod":
      if (args.length > 0) {
        throw new Error(
          "ship releases committed HEAD; commit your work, then run it without arguments",
        );
      }
      await ship();
      break;
    case "watch":
      if (args.length === 0) throw new Error("pass one or more workflow run ids");
      await watchRuns(args.map((id) => ({ id, label: `run ${id}` })));
      break;
    case "failures":
      if (!args[0]) throw new Error("pass a workflow run id");
      printFailures(args[0]);
      break;
    default:
      throw new Error(`unknown release command ${JSON.stringify(command)}`);
  }
} catch (error) {
  console.error(`release ${command}: ${error.message}`);
  process.exitCode = 1;
}

async function plan() {
  const mcpRegistryVersion = checkMCPRegistryOwnership(root);
  const latestTag = git(["tag", "--list", "v*", "--sort=-v:refname"]).split("\n").find(Boolean);
  if (!latestTag) throw new Error("no v* release tags found");

  const releaseSurfaceManifest = readReleaseSurfaceManifest(root);
  const previousReleaseSurfaceManifest = readReleaseSurfaceManifestAtRevision(latestTag, root);
  const changed = changedReleasePaths(latestTag, root);
  const ownershipProblems = validateReleaseSurfaceManifest(
    releaseSurfaceManifest,
    maintainedReleasePaths(root),
    root,
  );
  if (ownershipProblems.length > 0) {
    throw new Error(`release surface ownership failed: ${ownershipProblems.join("; ")}`);
  }
  const pendingMessage = process.env.COMMIT_MESSAGE?.trim() ?? "";
  const commitCount = Number(git(["rev-list", "--count", `${latestTag}..HEAD`]));
  const nextTag =
    commitCount === 0 && changed.length > 0 && !pendingMessage
      ? "set COMMIT_MESSAGE to infer"
      : runCapture(["bun", "scripts/next-release-version.mjs", latestTag], {
          PENDING_COMMIT_MESSAGE: pendingMessage,
        }).trim();
  const surfacePlan = releaseSurfacePlan(
    changed,
    releaseSurfaceManifest,
    previousReleaseSurfaceManifest,
  );
  const unclassified = surfacePlan.filter(
    (entry) => entry.surfaces.length === 0 && !entry.exemption,
  );
  if (unclassified.length > 0) {
    throw new Error(
      `changed release paths have no current or previous owner: ${unclassified
        .map((entry) => entry.file)
        .join(", ")}`,
    );
  }
  const touchedSurfaces = new Set(surfacePlan.flatMap((entry) => entry.surfaces));

  console.log(`Latest release: ${latestTag}`);
  console.log(`Planned release: ${nextTag}`);
  console.log(`MCP registry listing: ${mcpRegistryVersion}`);
  console.log(`Changed paths since ${latestTag}: ${changed.length}`);
  for (const surface of Object.keys(releaseSurfaceManifest.surfaces)) {
    console.log(`  ${touchedSurfaces.has(surface) ? "CHECK" : "skip "} ${surface}`);
  }
  if (surfacePlan.length > 0) {
    console.log(
      surfacePlan
        .map((entry) => {
          const owners = entry.surfaces.length
            ? entry.surfaces.join(",")
            : `exempt:${entry.exemption.reason}`;
          return `  [${owners}] ${entry.file}`;
        })
        .join("\n"),
    );
  }
}

function checkReleaseContracts() {
  run(["bun", "run", "check", "--", "release-version"]);
  run(["bun", "run", "check", "--", "changelog"]);
  run(["bun", "run", "check", "--", "provider-certification"]);
}

async function checkReleaseMobileIdentity(previousReleaseTag) {
  const previousPath =
    git(["ls-tree", "--name-only", previousReleaseTag, "apps/mobile/app.json"]).trim().length > 0
      ? "apps/mobile/app.json"
      : "mobile/app.json";
  const previousConfig = git(["show", `${previousReleaseTag}:${previousPath}`]);
  const previousFile = path.join(
    root,
    ".devenv",
    "state",
    `previous-release-app-${process.pid}.json`,
  );
  await Bun.write(previousFile, previousConfig);
  try {
    const changed = git([
      "diff",
      "--name-only",
      previousReleaseTag,
      "--",
      ...mobileReleasePaths,
    ]).trim();
    run([
      "bun",
      "scripts/mobile-release.mjs",
      "check-release",
      "--config",
      "apps/mobile/app.json",
      "--package",
      "apps/mobile/package.json",
      "--previous-config",
      previousFile,
      "--changed",
      changed ? "true" : "false",
    ]);
  } finally {
    await rm(previousFile, { force: true });
  }
}

async function verifyLocalCandidate(revision) {
  // Remote release qualification owns exhaustive gates. Local feedback selects
  // unpushed changes and fails closed to preflight for shared/configuration work.
  run(["bun", "run", "doctor"]);
  run(["bun", "install", "--frozen-lockfile"]);
  run(["bun", "install", "--cwd", "apps/mobile", "--frozen-lockfile"]);
  run(["bun", "scripts/tasks.mjs", "check:affected", "--base", "refs/remotes/origin/main"]);
  if (git(["rev-parse", "HEAD"]) !== revision || isDirty()) {
    throw new Error(
      "candidate changed during local checks; commit the intended revision and run ship again",
    );
  }
}

// Local verification precedes every new candidate push. An existing immutable
// tag resumes independently of newer main commits or canceled main CI runs.
async function ship() {
  const started = Date.now();
  const phase = (message) => console.log(`\n[${formatDuration(Date.now() - started)}] ${message}`);
  requireCommand("gh");
  const branch = git(["branch", "--show-current"]);
  if (
    branch !== "main" &&
    !(
      branch === "" && git(["rev-parse", "HEAD"]) === git(["rev-parse", "refs/remotes/origin/main"])
    )
  )
    throw new Error(`refusing to release from ${JSON.stringify(branch)}`);
  if (isDirty())
    throw new Error(
      "ship requires a clean worktree; commit the candidate before running local release checks",
    );

  runQuiet(["git", "fetch", "--quiet", "origin", "main", "--tags"]);
  const revision = git(["rev-parse", "HEAD"]);
  let tag = git(["tag", "--points-at", "HEAD", "--list", "v*", "--sort=-v:refname"])
    .split("\n")
    .find(Boolean);
  const remoteTag = tag ? git(["ls-remote", "--tags", "origin", `refs/tags/${tag}`]) : "";
  if (remoteTag && remoteTag.split(/\s+/u)[0] !== revision) {
    throw new Error(`remote ${tag} points at another revision; ship a new commit instead`);
  }

  if (!remoteTag) {
    const [ahead, behind] = git(["rev-list", "--left-right", "--count", "HEAD...origin/main"])
      .split(/\s+/u)
      .map(Number);
    if (behind > 0) {
      throw new Error(
        `main is ${behind} commit(s) behind origin/main; integrate origin/main before selecting a new candidate`,
      );
    }
    phase("Checking release inputs");
    const latestTag = git(["tag", "--list", "v*", "--sort=-v:refname"]).split("\n").find(Boolean);
    if (!latestTag) throw new Error("no v* release tags found");
    run(["bun", "scripts/check-changelog.mjs"]);
    checkReleaseContracts();
    await checkReleaseMobileIdentity(publishedStableReleaseTag());
    tag ??= runCapture(["bun", "scripts/next-release-version.mjs", latestTag]).trim();
    runCapture(["bun", "scripts/release-notes.mjs", tag]);

    phase(`Verifying ${revision.slice(0, 12)} locally before push`);
    await verifyLocalCandidate(revision);
    if (ahead > 0) {
      phase(`Pushing ${ahead} verified commit(s) to main`);
      run(["git", "push", "origin", `${revision}:refs/heads/main`]);
    }
    // Tag CI runs every required gate for the exact tagged revision.
    phase(`Tagging ${tag} at ${revision.slice(0, 12)}`);
    if (!runOptional(["git", "rev-parse", "--verify", `refs/tags/${tag}`]).ok) {
      run(["git", "tag", tag, revision]);
    }
    if (git(["rev-list", "-n", "1", tag]) !== revision)
      throw new Error(`${tag} does not point at the verified revision`);
    run(["git", "push", "origin", tag], { OPENPOST_SKIP_PUSH_CHECK: "1" });
  } else {
    phase(`Resuming immutable ${tag} at ${revision.slice(0, 12)}`);
  }

  const remoteStarted = Date.now();
  const preparation = formatDuration(remoteStarted - started);
  phase(`Preparation complete (${preparation}); remote CI, publication, and deployment start`);
  await watchRuns([
    { id: await waitForTagRun("CI", tag, revision), label: `${tag} CI` },
    { id: await waitForTagRun("Build and Release", tag, revision), label: `${tag} release` },
  ]);
  phase("Verifying production");
  await verifyProduction(tag, revision);
  const releaseURL = runCapture([
    "gh",
    "release",
    "view",
    tag,
    "--json",
    "url",
    "--jq",
    ".url",
  ]).trim();
  console.log(
    `\nrelease ship: ${tag} is live at ${revision}\nPreparation: ${preparation}. Remote CI, publication, and deployment observed: ${formatDuration(Date.now() - remoteStarted)}.\n${releaseURL}`,
  );
}

async function waitForTagRun(workflow, tag, revision) {
  for (let attempt = 0; attempt < 36; attempt += 1) {
    const result = runOptional([
      "gh",
      "run",
      "list",
      "--workflow",
      workflow,
      "--branch",
      tag,
      "--limit",
      "5",
      "--json",
      "databaseId,headSha",
      "--jq",
      `[.[] | select(.headSha == "${revision}") | .databaseId] | max // empty`,
    ]);
    const id = result.ok ? result.stdout.trim() : "";
    if (/^[1-9][0-9]*$/u.test(id)) return id;
    await Bun.sleep(5_000);
  }
  throw new Error(`${workflow} did not start for ${tag}`);
}

// Reports each finished job once and stops at the first failure with the
// failing tests and their local reproduction commands. Remaining jobs keep
// running in GitHub, so a rerun of ship resumes without losing their work.
async function watchRuns(runs, { pollMs = 20_000 } = {}) {
  const reported = new Set();
  let heartbeat = Date.now();
  for (;;) {
    const states = runs.map((entry) => ({ ...entry, ...runState(entry.id) }));
    for (const state of states) {
      for (const job of state.jobs) {
        if (job.status !== "completed" || reported.has(job.databaseId)) continue;
        reported.add(job.databaseId);
        if (job.conclusion === "skipped") continue;
        const took =
          job.startedAt && job.completedAt
            ? Date.parse(job.completedAt) - Date.parse(job.startedAt)
            : 0;
        const mark = job.conclusion === "success" ? "✓" : "✗";
        console.log(`${mark} ${state.label}: ${job.name} (${formatDuration(took)})`);
        if (job.conclusion === "success" || job.name === "Release Candidate") {
          continue;
        }
        printJobFailure(state.id, job);
        throw new Error(
          `${job.name} ${job.conclusion} in ${state.label}. Inspect the reported step and log. ` +
            `For setup failure, timeout, or cancellation, recover the same candidate with gh run rerun ${state.id} --failed, then resume ship. ` +
            "For a code failure, reproduce locally, fix and commit, then ship a new tag.",
        );
      }
    }
    if (states.every((state) => state.status === "completed")) {
      const unfinished = states.find((state) => state.conclusion !== "success");
      if (unfinished?.conclusion === "cancelled") {
        throw new Error(
          `${unfinished.label} was canceled: ${unfinished.url}. The run result alone does not identify the cause. Inspect its annotations, then rerun failed jobs for the same candidate.`,
        );
      }
      if (unfinished) {
        throw new Error(`${unfinished.label} finished ${unfinished.conclusion}: ${unfinished.url}`);
      }
      return;
    }
    if (Date.now() - heartbeat >= 5 * 60_000) {
      heartbeat = Date.now();
      const running = states.flatMap((state) =>
        state.jobs.filter((job) => job.status !== "completed").map((job) => job.name),
      );
      console.log(`… ${running.length} job(s) running: ${running.slice(0, 6).join(", ")}`);
    }
    await Bun.sleep(pollMs);
  }
}

function runState(id) {
  const result = runOptional([
    "gh",
    "run",
    "view",
    String(id),
    "--json",
    "status,conclusion,url,jobs",
  ]);
  if (!result.ok)
    throw new Error(
      `could not read workflow run ${id}: ${result.stderr.trim()}. Resume watch or ship when GitHub is reachable; the remote run has not been canceled.`,
    );
  return JSON.parse(result.stdout);
}

function printJobFailure(runId, job) {
  const interrupted = ["cancelled", "timed_out"].includes(job.conclusion);
  const step = job.steps?.find((item) =>
    ["failure", "cancelled", "timed_out"].includes(item.conclusion),
  );
  if (step) console.log(`Step: ${step.name} (${step.conclusion})`);
  if (interrupted) {
    const metadata = runOptional([
      "gh",
      "api",
      `repos/${repositoryName()}/actions/jobs/${job.databaseId}`,
      "--jq",
      ".check_run_url",
    ]);
    if (metadata.ok && metadata.stdout.trim()) {
      const annotations = runOptional([
        "gh",
        "api",
        `${metadata.stdout.trim()}/annotations`,
        "--jq",
        '.[] | select(.annotation_level == "failure") | .message',
      ]);
      if (annotations.ok && annotations.stdout.trim())
        console.log(`GitHub annotations:\n${annotations.stdout.trim()}`);
    }
    for (const item of job.steps ?? []) {
      const elapsed = Date.parse(item.completedAt) - Date.parse(item.startedAt);
      if (elapsed >= 60_000)
        console.log(`  ${item.name}: ${formatDuration(elapsed)} (${item.conclusion})`);
    }
  }
  const log = runOptional([
    "gh",
    "run",
    "view",
    String(runId),
    "--job",
    String(job.databaseId),
    interrupted ? "--log" : "--log-failed",
  ]);
  if (!log.ok) console.log(`Job log unavailable: ${log.stderr.trim()}`);
  const tail = log.stdout.trimEnd().split("\n").slice(-80).join("\n");
  console.log(`\n${job.name}: ${job.url}\n${tail}\n`);
}

function printFailures(runId) {
  const state = runState(runId);
  const failed = state.jobs.filter(
    (job) =>
      ["failure", "cancelled", "timed_out"].includes(job.conclusion) &&
      job.name !== "Release Candidate",
  );
  if (failed.length === 0) {
    console.log(`run ${runId} has no failed jobs (${state.status} ${state.conclusion ?? ""})`);
    return;
  }
  for (const job of failed) printJobFailure(runId, job);
}

function repositoryName() {
  return runCapture([
    "gh",
    "repo",
    "view",
    "--json",
    "nameWithOwner",
    "--jq",
    ".nameWithOwner",
  ]).trim();
}

function formatDuration(milliseconds) {
  const seconds = Math.max(0, Math.round(milliseconds / 1_000));
  return `${Math.floor(seconds / 60)}m${String(seconds % 60).padStart(2, "0")}s`;
}

async function status() {
  const branch = git(["branch", "--show-current"]);
  const revision = git(["rev-parse", "HEAD"]);
  const localTag =
    git(["tag", "--points-at", "HEAD", "--list", "v*", "--sort=-v:refname"])
      .split("\n")
      .find(Boolean) || "untagged";
  console.log(`Local:      ${branch} ${revision} (${localTag})${isDirty() ? " dirty" : ""}`);

  const ci = runOptional([
    "gh",
    "run",
    "list",
    "--workflow",
    "CI",
    "--commit",
    revision,
    "--limit",
    "1",
    "--json",
    "status,conclusion,url",
    "--jq",
    ".[0] // {}",
  ]);
  console.log(`Candidate:  ${ci.ok && ci.stdout.trim() !== "{}" ? ci.stdout.trim() : "not found"}`);
  try {
    const response = await fetch("https://app.openpo.st/api/v1/version", {
      signal: AbortSignal.timeout(10_000),
    });
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    const live = await response.json();
    const comparison = live.revision === revision ? "matches local" : "differs from local";
    console.log(`Production: ${live.version} ${live.revision} (${live.edition}; ${comparison})`);
  } catch (error) {
    const ready = await fetch("https://app.openpo.st/api/v1/ready", {
      signal: AbortSignal.timeout(10_000),
    }).catch(() => undefined);
    if (ready?.ok) {
      console.log(
        `Production: ready; revision unavailable until this release ships (${error.message})`,
      );
    } else {
      console.log(`Production: unavailable (${error.message})`);
    }
  }
}

async function verifyProduction(version, revision) {
  for (let attempt = 0; attempt < 60; attempt += 1) {
    try {
      const response = await fetch("https://app.openpo.st/api/v1/version", {
        signal: AbortSignal.timeout(10_000),
      });
      const info = response.ok ? await response.json() : {};
      if (info.version === version && info.revision === revision) return;
    } catch {
      // Deployment readiness may briefly fail while the service restarts.
    }
    await Bun.sleep(5_000);
  }
  throw new Error(`production did not report ${version} at revision ${revision}`);
}

function isDirty() {
  return git(["status", "--porcelain"]) !== "";
}

function git(args) {
  return runCapture(["git", ...args]).trim();
}

function run(argv, extraEnv = {}) {
  console.log(`\n==> ${argv.join(" ")}`);
  const result = Bun.spawnSync(argv, {
    cwd: root,
    env: releaseCommandEnvironment(process.env, extraEnv),
    stdin: "inherit",
    stdout: "inherit",
    stderr: "inherit",
  });
  if (result.exitCode !== 0) throw new Error(`${argv[0]} exited with ${result.exitCode}`);
}

function runCapture(argv, extraEnv = {}) {
  const result = Bun.spawnSync(argv, {
    cwd: root,
    env: releaseCommandEnvironment(process.env, extraEnv),
    stdout: "pipe",
    stderr: "inherit",
  });
  if (result.exitCode !== 0) throw new Error(`${argv[0]} exited with ${result.exitCode}`);
  return result.stdout.toString();
}

function runQuiet(argv) {
  const result = runOptional(argv);
  if (!result.ok) throw new Error(`${argv.join(" ")} failed: ${result.stderr.trim()}`);
}

function runOptional(argv) {
  const result = Bun.spawnSync(argv, {
    cwd: root,
    env: releaseCommandEnvironment(),
    stdout: "pipe",
    stderr: "pipe",
  });
  return {
    ok: result.exitCode === 0,
    stdout: result.stdout.toString(),
    stderr: result.stderr.toString(),
  };
}

function requireCommand(name) {
  const result = Bun.spawnSync(["bash", "-lc", `command -v ${name}`], {
    stdout: "ignore",
    stderr: "ignore",
  });
  if (result.exitCode !== 0) throw new Error(`missing required command: ${name}`);
}
