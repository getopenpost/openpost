#!/usr/bin/env bun

import { createHash } from "node:crypto";
import { mkdir, readFile, rm, stat } from "node:fs/promises";
import path from "node:path";

import { mobileReleasePaths } from "./release-distribution-plan.mjs";
import { checkMCPRegistryOwnership } from "./check-mcp-registry.mjs";
import { releaseCommandEnvironment } from "./release-command-environment.mjs";
import { formatFailureDigest } from "./release-failures.mjs";
import { findReleaseProofRun } from "./release-proof.mjs";
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
    case "preflight":
      await preflight();
      break;
    case "check":
      await check();
      break;
    case "check-full":
      await checkFull();
      break;
    case "status":
      await status();
      break;
    case "prepare":
      await prepare();
      break;
    case "promote":
      await promote(args[0]);
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

async function preflight() {
  run(["bun", "run", "doctor"]);
  requireCommand("gh");
  verifyGitHubReleaseAccess();
  await warnUnlessProductionReady("preflight");
  console.log("release preflight: worktree, GitHub, workflows, and secrets are ready");
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

async function check() {
  const started = Date.now();
  run(["bun", "run", "doctor"]);
  run(["bun", "install", "--frozen-lockfile"]);
  run(["bun", "install", "--cwd", "apps/mobile", "--frozen-lockfile"]);
  run(["bun", "scripts/tasks.mjs", "preflight"]);
  console.log(`release check: local preflight passed in ${formatDuration(Date.now() - started)}`);
  console.log(
    "Remote gates still include end-to-end browsers, race/integration tests, security scans, and release artifacts. Use check-full for a broader local rehearsal.",
  );
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

async function checkFull() {
  await requireLocalReleaseHost();
  run(["bun", "run", "doctor"]);
  run(["bun", "install", "--frozen-lockfile"]);
  run(["bun", "install", "--cwd", "apps/mobile", "--frozen-lockfile"]);
  run(["bun", "run", "check", "--", "provider-certification"]);
  const fingerprint = await worktreeFingerprint();
  const stampDir = path.join(root, ".devenv", "state", "release-check");
  const stampPath = path.join(stampDir, `${fingerprint}.json`);
  if (process.env.OPENPOST_FORCE_RELEASE_CHECK !== "1" && (await exists(stampPath))) {
    const stamp = await stat(stampPath);
    if (Date.now() - stamp.mtimeMs < 24 * 60 * 60 * 1_000) {
      console.log(
        `release check-full: exact worktree passed in the last 24 hours (${fingerprint.slice(0, 12)})`,
      );
      return;
    }
  }

  run(["bun", "run", "verify"]);
  run(["bun", "run", "test", "--", "backend"], {
    OPENPOST_GO_TEST_RACE: "1",
  });
  run(["scripts/security-check.sh"]);
  run(["bun", "run", "test", "--", "e2e"]);
  run(["bun", "run", "test", "--", "e2e-app"]);

  const revision = git(["rev-parse", "HEAD"]);
  const image = `openpost-release-check:${fingerprint.slice(0, 12)}`;
  const imageArchitecture = { arm64: "arm64", x64: "amd64" }[process.arch];
  if (!imageArchitecture) {
    throw new Error(`release image checks do not support host architecture ${process.arch}`);
  }
  try {
    run(
      [
        "docker",
        "build",
        "--platform",
        `linux/${imageArchitecture}`,
        "--build-context",
        "frontend_artifact=apps/server/cmd/openpost/public",
        "--file",
        "deploy/docker/Dockerfile",
        "--tag",
        image,
        "--build-arg",
        `VERSION=local-${fingerprint.slice(0, 12)}`,
        "--build-arg",
        `COMMIT=${revision}`,
        ".",
      ],
      { DOCKER_BUILDKIT: "1" },
    );
    run(["scripts/smoke-production-image.sh", image, revision, "", imageArchitecture]);
  } finally {
    runOptional(["docker", "image", "rm", image]);
    pruneDockerBuildCache();
  }

  await mkdir(stampDir, { recursive: true });
  await Bun.write(
    stampPath,
    JSON.stringify({ fingerprint, revision, passed_at: new Date().toISOString() }, null, 2) + "\n",
  );
  console.log(`release check-full: complete (${fingerprint.slice(0, 12)})`);
}

async function prepare() {
  requireCommand("git");
  requireCommand("gh");
  const branch = git(["branch", "--show-current"]);
  if (branch !== "main") throw new Error(`refusing to release from ${JSON.stringify(branch)}`);
  if (isDirty())
    throw new Error(
      "preparation requires a clean worktree; commit the candidate before verification",
    );

  verifyGitHubReleaseAccess();
  await warnUnlessProductionReady("prepare");

  run(["git", "fetch", "origin", "main", "--tags"]);
  const divergence = git(["rev-list", "--left-right", "--count", "HEAD...origin/main"]);
  if (Number(divergence.split("\t")[1]) !== 0)
    throw new Error(
      `main must include origin/main before preparation; divergence is ${divergence}`,
    );

  const latestTag = git(["tag", "--list", "v*", "--sort=-v:refname"]).split("\n").find(Boolean);
  if (!latestTag) throw new Error("no v* release tags found");
  const headTag = git(["tag", "--points-at", "HEAD", "--list", "v*", "--sort=-v:refname"])
    .split("\n")
    .find(Boolean);
  if (headTag && !isDirty()) {
    console.log(`release prepare: HEAD is already ${headTag}`);
    return headTag;
  }

  const tag = runCapture(["bun", "scripts/next-release-version.mjs", latestTag]).trim();
  const revision = git(["rev-parse", "HEAD"]);

  // Validate release inputs before running the shared local gates.
  run(["bun", "scripts/check-changelog.mjs"]);
  checkReleaseContracts();
  await checkReleaseMobileIdentity(publishedStableReleaseTag());

  // Fail fast when the candidate has no releasable notes. Tag CI builds the
  // draft notes from changes/ fragments plus [Unreleased] at the tag, so an
  // empty or invalid combination must stop here instead of in tag CI.
  runCapture(["bun", "scripts/release-notes.mjs", tag]);

  // Preparation owns no files. The changelog is generated in CI at draft
  // time and recorded on main by the release workflow after publication, so
  // preparation never commits. The candidate is the pushed main SHA: push
  // local main commits so the tag (created by promote) points at an
  // origin/main revision. Later main commits cannot enter the tag; a
  // rejected push means origin advanced and preparation stops here.
  await verifyLocalCandidate(revision);
  const ahead = Number(git(["rev-list", "--count", "origin/main..HEAD"]));
  if (ahead > 0) run(["git", "push", "origin", `${revision}:refs/heads/main`]);
  console.log(`release prepare: ${tag} candidate selected at ${revision}; run promote to tag it`);
  return tag;
}

async function promote(requestedTag) {
  requireCommand("gh");
  if (isDirty()) throw new Error("promotion requires a clean worktree");
  const revision = git(["rev-parse", "HEAD"]);
  const branch = git(["branch", "--show-current"]);
  if (branch !== "main") throw new Error("promotion requires main");

  let tag = requestedTag?.trim();
  if (!tag) {
    tag = git(["tag", "--points-at", "HEAD", "--list", "v*", "--sort=-v:refname"])
      .split("\n")
      .find(Boolean);
  }
  if (!tag) throw new Error("pass the prepared version tag to release -- promote");

  runCapture(["bun", "scripts/release-notes.mjs", tag]);
  // Tag CI proves the candidate with the final version embedded; main CI is
  // development feedback, not a serial predecessor. Do not wait for it here.

  const remoteTag = git(["ls-remote", "--tags", "origin", `refs/tags/${tag}`]);
  if (!remoteTag) {
    runQuiet(["git", "fetch", "--quiet", "origin", "main"]);
    if (!runOptional(["git", "merge-base", "--is-ancestor", revision, "origin/main"]).ok) {
      throw new Error(
        "promotion requires a candidate already pushed to origin/main; run prepare first",
      );
    }
    await verifyLocalCandidate(revision);
    const localTarget = runOptional(["git", "rev-parse", "--verify", `refs/tags/${tag}`]);
    if (!localTarget.ok) run(["git", "tag", tag, revision]);
    if (git(["rev-list", "-n", "1", tag]) !== revision)
      throw new Error(`${tag} does not point at HEAD`);
    run(["git", "push", "origin", tag], { OPENPOST_SKIP_PUSH_CHECK: "1" });
  } else if (remoteTag.split(/\s+/u)[0] !== revision) {
    throw new Error(`remote ${tag} points at another revision`);
  }

  await watchRuns([
    { id: await waitForTagRun("CI", tag, revision), label: `${tag} CI` },
    { id: await waitForTagRun("Build and Release", tag, revision), label: `${tag} release` },
  ]);
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
  await verifyProduction(tag, revision);
  console.log(`release promote: shipped ${tag}`);
  console.log(releaseURL);
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
    // Tag CI reuses a completed exact-SHA proof if one already exists. Otherwise
    // it runs every required gate. A moving main run is never a prerequisite.
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
  console.log(`\n${formatFailureDigest(job.name, log.stdout, { url: job.url })}\n`);
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
    const proof = findReleaseProofRun({ repository: repositoryName(), sha: revision });
    console.log(`Proof:      ${proof ? `CI run ${proof}; ship skips the test gates` : "none yet"}`);
  } catch (error) {
    console.log(`Proof:      unavailable (${error.message})`);
  }
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

async function warnUnlessProductionReady(stage) {
  // A broken production must never block shipping its fix. Readiness gates
  // the deployment result, not the decision to release.
  try {
    const response = await fetch("https://app.openpo.st/api/v1/ready", {
      signal: AbortSignal.timeout(10_000),
    });
    if (response.ok) return;
    console.warn(
      `release ${stage}: production readiness returned HTTP ${response.status}; continuing`,
    );
  } catch (error) {
    console.warn(
      `release ${stage}: production readiness unreachable (${error.message}); continuing`,
    );
  }
}

function verifyGitHubReleaseAccess() {
  run(["gh", "auth", "status"]);
  const permission = runCapture([
    "gh",
    "repo",
    "view",
    "--json",
    "viewerPermission",
    "--jq",
    ".viewerPermission",
  ]).trim();
  if (!["ADMIN", "MAINTAIN", "WRITE"].includes(permission)) {
    throw new Error(`GitHub permission ${JSON.stringify(permission)} cannot publish a release`);
  }

  const secrets = new Set(
    runCapture(["gh", "secret", "list", "--app", "actions", "--json", "name", "--jq", ".[].name"])
      .split("\n")
      .filter(Boolean),
  );
  if (!secrets.has("DEPLOY_WEBHOOK_SECRET")) {
    throw new Error("GitHub Actions secret DEPLOY_WEBHOOK_SECRET is missing");
  }
  run(["gh", "workflow", "view", "CI"]);
  run(["gh", "workflow", "view", "Build and Release"]);
}

function releaseDiskStatus() {
  const minimumGiB = Number(process.env.OPENPOST_RELEASE_MIN_FREE_GIB ?? "10");
  if (!Number.isFinite(minimumGiB) || minimumGiB <= 0) {
    throw new Error("OPENPOST_RELEASE_MIN_FREE_GIB must be a positive number");
  }
  const lines = runCapture(["df", "-Pk", root]).trim().split("\n");
  const fields = lines.at(-1)?.trim().split(/\s+/) ?? [];
  const availableKiB = Number(fields[3]);
  if (!Number.isFinite(availableKiB)) throw new Error("could not determine free disk space");
  return { availableGiB: availableKiB / 1024 / 1024, minimumGiB };
}

function requireFreeDisk() {
  const { availableGiB, minimumGiB } = releaseDiskStatus();
  if (availableGiB < minimumGiB) {
    throw new Error(
      `release checks need ${minimumGiB} GiB free; only ${availableGiB.toFixed(1)} GiB is available after pruning unused Docker build cache`,
    );
  }
}

async function requireLocalReleaseHost() {
  const initialDisk = releaseDiskStatus();
  try {
    await requireDocker();
  } catch (error) {
    if (initialDisk.availableGiB < initialDisk.minimumGiB) {
      throw new Error(
        `${error.message}; the host also has only ${initialDisk.availableGiB.toFixed(1)} GiB free. Stop Docker Desktop and inventory bind mounts and volumes before any reset or purge`,
      );
    }
    throw error;
  }
  if (initialDisk.availableGiB < initialDisk.minimumGiB) {
    console.log(
      `release preflight: only ${initialDisk.availableGiB.toFixed(1)} GiB is free; pruning unused Docker build cache`,
    );
    pruneDockerBuildCache();
  }
  requireFreeDisk();
}

function pruneDockerBuildCache() {
  const maximum = process.env.OPENPOST_DOCKER_CACHE_MAX_STORAGE ?? "20gb";
  const minimumFree = process.env.OPENPOST_DOCKER_MIN_FREE_SPACE ?? "20gb";
  run([
    "docker",
    "buildx",
    "prune",
    "--all",
    "--force",
    "--max-used-space",
    maximum,
    "--min-free-space",
    minimumFree,
  ]);
}

async function requireDocker() {
  requireCommand("docker");
  const timeoutMs = 10_000;
  const proc = Bun.spawn(["docker", "info", "--format", "{{.ServerVersion}} {{.MemTotal}}"], {
    cwd: root,
    stdout: "pipe",
    stderr: "pipe",
  });
  const stdout = new Response(proc.stdout).text();
  const stderr = new Response(proc.stderr).text();
  let timedOut = false;
  const timer = setTimeout(() => {
    timedOut = true;
    proc.kill();
  }, timeoutMs);
  const exitCode = await proc.exited;
  clearTimeout(timer);
  const [serverInfo, errorOutput] = await Promise.all([stdout, stderr]);
  if (timedOut)
    throw new Error(`Docker daemon did not respond within ${timeoutMs / 1_000} seconds`);
  if (exitCode !== 0 || !serverInfo.trim()) {
    throw new Error(`Docker daemon is unavailable: ${errorOutput.trim() || `exit ${exitCode}`}`);
  }

  if (process.platform === "darwin") {
    const [, memoryBytesText] = serverInfo.trim().split(/\s+/, 2);
    const memoryBytes = Number(memoryBytesText);
    const minimumGiB = Number(process.env.OPENPOST_DOCKER_MIN_MEMORY_GIB ?? "9.5");
    if (!Number.isFinite(minimumGiB) || minimumGiB <= 0) {
      throw new Error("OPENPOST_DOCKER_MIN_MEMORY_GIB must be a positive number");
    }
    if (Number.isFinite(memoryBytes)) {
      const memoryGiB = memoryBytes / 1024 ** 3;
      if (memoryGiB < minimumGiB) {
        throw new Error(
          `Docker Desktop has ${memoryGiB.toFixed(1)} GiB of VM memory; release image builds need at least ${minimumGiB} GiB. Set Docker Desktop Resources to 10 GB memory and 4 GB swap`,
        );
      }
    }
  }
}

async function worktreeFingerprint() {
  const hash = createHash("sha256");
  hash.update(git(["rev-parse", "HEAD"]));
  hash.update(runCapture(["bun", "--version"]));
  hash.update(runCapture(["go", "version"]));
  hash.update(runCapture(["git", "diff", "--binary", "HEAD"]));
  const untracked = git(["ls-files", "--others", "--exclude-standard"])
    .split("\n")
    .filter(Boolean)
    .sort();
  for (const file of untracked) {
    hash.update(file);
    hash.update(await readFile(path.join(root, file)));
  }
  return hash.digest("hex");
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

async function exists(file) {
  try {
    await stat(file);
    return true;
  } catch (error) {
    if (error.code === "ENOENT") return false;
    throw error;
  }
}
