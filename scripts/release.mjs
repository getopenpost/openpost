#!/usr/bin/env bun

import { createHash } from "node:crypto";
import { mkdir, mkdtemp, readFile, rm, stat } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { checkMCPRegistryOwnership } from "./check-mcp-registry.mjs";
import { resolveRunArtifact } from "./ci-artifacts.mjs";
import {
  requireConventionalCommitMessage,
  selectWorkflowRun,
} from "./release-lifecycle.mjs";
import { readReleaseManifest } from "./release-manifest.mjs";
import {
  changedReleasePaths,
  maintainedReleasePaths,
  readReleaseSurfaceManifest,
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
      await prepare(args.join(" ").trim());
      break;
    case "promote":
      await promote(args[0]);
      break;
    case "prod": {
      const tag = await prepare(args.join(" ").trim());
      await promote(tag);
      break;
    }
    default:
      throw new Error(`unknown release command ${JSON.stringify(command)}`);
  }
} catch (error) {
  console.error(`release:${command}: ${error.message}`);
  process.exitCode = 1;
}

async function plan() {
  const mcpRegistryVersion = checkMCPRegistryOwnership(root);
  const latestTag = git(["tag", "--list", "v*", "--sort=-v:refname"])
    .split("\n")
    .find(Boolean);
  if (!latestTag) throw new Error("no v* release tags found");

  const releaseSurfaceManifest = readReleaseSurfaceManifest(root);
  const changed = changedReleasePaths(latestTag, root);
  const ownershipProblems = validateReleaseSurfaceManifest(
    releaseSurfaceManifest,
    [...new Set([...maintainedReleasePaths(root), ...changed])],
    root,
  );
  if (ownershipProblems.length > 0) {
    throw new Error(
      `release surface ownership failed: ${ownershipProblems.join("; ")}`,
    );
  }
  const pendingMessage = process.env.COMMIT_MESSAGE?.trim() ?? "";
  const commitCount = Number(
    git(["rev-list", "--count", `${latestTag}..HEAD`]),
  );
  const nextTag =
    commitCount === 0 && changed.length > 0 && !pendingMessage
      ? "set COMMIT_MESSAGE to infer"
      : runCapture(["bun", "scripts/next-release-version.mjs", latestTag], {
          PENDING_COMMIT_MESSAGE: pendingMessage,
        }).trim();
  const surfacePlan = releaseSurfacePlan(changed, releaseSurfaceManifest);
  const touchedSurfaces = new Set(
    surfacePlan.flatMap((entry) => entry.surfaces),
  );

  console.log(`Latest release: ${latestTag}`);
  console.log(`Planned release: ${nextTag}`);
  console.log(`MCP registry listing: ${mcpRegistryVersion}`);
  console.log(`Changed paths since ${latestTag}: ${changed.length}`);
  for (const surface of Object.keys(releaseSurfaceManifest.surfaces)) {
    console.log(
      `  ${touchedSurfaces.has(surface) ? "CHECK" : "skip "} ${surface}`,
    );
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
  run(["devenv", "shell", "--", "doctor"]);
  requireCommand("gh");
  verifyGitHubReleaseAccess();
  await verifyProductionReady();
  console.log(
    "release:preflight: worktree, GitHub, workflows, secrets, and production are ready",
  );
}

function checkReleaseContracts() {
  run(["bun", "run", "check:release-version"]);
  run(["bun", "run", "check:changelog"]);
  run(["bun", "run", "check:provider-certification"]);
}

async function check() {
  run(["devenv", "shell", "--", "doctor"]);
  run(["devenv", "shell", "--", "bun", "install", "--frozen-lockfile"]);
  run(["devenv", "shell", "--", "bun", "scripts/release-check.mjs"]);
  console.log("release:check: local checks passed");
}

async function checkFull() {
  await requireLocalReleaseHost();
  run(["devenv", "shell", "--", "doctor"]);
  run(["devenv", "shell", "--", "bun", "install", "--frozen-lockfile"]);
  run(["bun", "run", "check:provider-certification"]);
  const fingerprint = await worktreeFingerprint();
  const stampDir = path.join(root, ".devenv", "state", "release-check");
  const stampPath = path.join(stampDir, `${fingerprint}.json`);
  if (
    process.env.OPENPOST_FORCE_RELEASE_CHECK !== "1" &&
    (await exists(stampPath))
  ) {
    const stamp = await stat(stampPath);
    if (Date.now() - stamp.mtimeMs < 24 * 60 * 60 * 1_000) {
      console.log(
        `release:check-full: exact worktree passed in the last 24 hours (${fingerprint.slice(0, 12)})`,
      );
      return;
    }
  }

  run(["devenv", "shell", "--", "verify"]);
  run([
    "devenv",
    "shell",
    "--",
    "bash",
    "-c",
    "cd backend && go test -tags dev -race ./...",
  ]);
  run(["devenv", "shell", "--", "security"]);
  run(["bun", "run", "test:e2e"]);
  run(["bun", "run", "test:e2e:app"]);
  run(["bun", "run", "test:e2e:docs"]);

  const revision = git(["rev-parse", "HEAD"]);
  const image = `openpost-release-check:${fingerprint.slice(0, 12)}`;
  const imagePlatform = await publishedImagePlatform();
  try {
    run(
      [
        "docker",
        "build",
        "--platform",
        imagePlatform,
        "--build-context",
        "frontend_artifact=backend/cmd/openpost/public",
        "--file",
        "docker/Dockerfile",
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
    run(["scripts/smoke-production-image.sh", image, revision]);
  } finally {
    runOptional(["docker", "image", "rm", image]);
    pruneDockerBuildCache();
  }

  await mkdir(stampDir, { recursive: true });
  await Bun.write(
    stampPath,
    JSON.stringify(
      { fingerprint, revision, passed_at: new Date().toISOString() },
      null,
      2,
    ) + "\n",
  );
  console.log(`release:check-full: complete (${fingerprint.slice(0, 12)})`);
}

async function publishedImagePlatform() {
  const policy = JSON.parse(
    await readFile(path.join(root, "docker", "image-policy.json"), "utf8"),
  );
  if (
    !Array.isArray(policy.supported_platforms) ||
    policy.supported_platforms.length !== 1
  ) {
    throw new Error("image policy must declare exactly one published platform");
  }
  return policy.supported_platforms[0];
}

async function prepare(commitMessage) {
  requireCommand("git");
  requireCommand("gh");
  const branch = git(["branch", "--show-current"]);
  if (branch !== "main")
    throw new Error(`refusing to release from ${JSON.stringify(branch)}`);
  if (isDirty()) requireConventionalCommitMessage(commitMessage);

  verifyGitHubReleaseAccess();
  await verifyProductionReady();

  run(["git", "fetch", "origin", "main", "--tags"]);
  const divergence = git([
    "rev-list",
    "--left-right",
    "--count",
    "HEAD...origin/main",
  ]);
  if (divergence !== "0\t0")
    throw new Error(
      `main must match origin/main before preparation; divergence is ${divergence}`,
    );

  const latestTag = git(["tag", "--list", "v*", "--sort=-v:refname"])
    .split("\n")
    .find(Boolean);
  if (!latestTag) throw new Error("no v* release tags found");
  const headTag = git([
    "tag",
    "--points-at",
    "HEAD",
    "--list",
    "v*",
    "--sort=-v:refname",
  ])
    .split("\n")
    .find(Boolean);
  if (headTag && !isDirty()) {
    console.log(`release:prepare: HEAD is already ${headTag}`);
    return headTag;
  }

  let tag;
  if (isDirty()) {
    if (!commitMessage)
      throw new Error(
        "uncommitted work requires a Conventional Commit message",
      );
    tag = runCapture(["bun", "scripts/next-release-version.mjs", latestTag], {
      PENDING_COMMIT_MESSAGE: commitMessage,
    }).trim();
  } else {
    tag = runCapture([
      "bun",
      "scripts/next-release-version.mjs",
      latestTag,
    ]).trim();
  }

  const changelogPath = path.join(root, "CHANGELOG.md");
  const originalChangelog = await readFile(changelogPath);
  run(["bun", "scripts/prepare-release-changelog.mjs", tag]);
  try {
    checkReleaseContracts();
  } catch (error) {
    await Bun.write(changelogPath, originalChangelog);
    throw error;
  }
  run(["git", "add", "--all"]);
  run([
    "git",
    "commit",
    "-m",
    commitMessage || `docs: prepare ${tag} changelog`,
  ]);
  run(["git", "push", "origin", "main"]);

  const revision = git(["rev-parse", "HEAD"]);
  await waitForCI(revision);
  console.log(`release:prepare: ${tag} is a tested candidate at ${revision}`);
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
    tag = git([
      "tag",
      "--points-at",
      "HEAD",
      "--list",
      "v*",
      "--sort=-v:refname",
    ])
      .split("\n")
      .find(Boolean);
  }
  if (!tag) throw new Error("pass the prepared version tag to release:promote");

  const ciRun = await waitForCI(revision);
  await verifyCandidateManifest(ciRun, tag, revision);

  const remoteTag = runOptional([
    "git",
    "ls-remote",
    "--exit-code",
    "--tags",
    "origin",
    `refs/tags/${tag}`,
  ]);
  if (!remoteTag.ok) {
    const localTarget = runOptional(["git", "rev-parse", `refs/tags/${tag}`]);
    if (!localTarget.ok) run(["git", "tag", tag]);
    if (git(["rev-list", "-n", "1", tag]) !== revision)
      throw new Error(`${tag} does not point at HEAD`);
    run(["git", "push", "origin", tag], { OPENPOST_SKIP_PRE_PUSH_LINT: "1" });
  } else {
    const remoteTarget = remoteTag.stdout.trim().split(/\s+/)[0];
    if (remoteTarget !== revision)
      throw new Error(
        `remote ${tag} points at ${remoteTarget}, not ${revision}`,
      );
  }

  const releaseRun = await waitForWorkflow("Build and Release", tag, revision);
  run(["gh", "run", "watch", releaseRun.id, "--exit-status"]);
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
  console.log(`release:promote: shipped ${tag}`);
  console.log(releaseURL);
}

async function status() {
  const branch = git(["branch", "--show-current"]);
  const revision = git(["rev-parse", "HEAD"]);
  const localTag =
    git(["tag", "--points-at", "HEAD", "--list", "v*", "--sort=-v:refname"])
      .split("\n")
      .find(Boolean) || "untagged";
  console.log(
    `Local:      ${branch} ${revision} (${localTag})${isDirty() ? " dirty" : ""}`,
  );

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
  console.log(
    `Candidate:  ${ci.ok && ci.stdout.trim() !== "{}" ? ci.stdout.trim() : "not found"}`,
  );
  try {
    const response = await fetch("https://app.openpost.social/api/v1/version", {
      signal: AbortSignal.timeout(10_000),
    });
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    const live = await response.json();
    const comparison =
      live.revision === revision ? "matches local" : "differs from local";
    console.log(
      `Production: ${live.version} ${live.revision} (${live.edition}; ${comparison})`,
    );
  } catch (error) {
    const ready = await fetch("https://app.openpost.social/api/v1/ready", {
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

async function waitForCI(revision) {
  const workflowRun = await waitForWorkflow("CI", "main", revision);
  run(["gh", "run", "watch", workflowRun.id, "--exit-status"]);
  return workflowRun;
}

async function waitForWorkflow(workflow, branch, revision) {
  for (let attempt = 0; attempt < 120; attempt += 1) {
    const result = runOptional([
      "gh",
      "run",
      "list",
      "--workflow",
      workflow,
      "--commit",
      revision,
      "--limit",
      "20",
      "--json",
      "databaseId,attempt,headBranch,status,conclusion",
    ]);
    if (result.ok) {
      const runs = JSON.parse(result.stdout || "[]");
      const match = selectWorkflowRun(runs, { workflow, branch, revision });
      if (match) {
        return match;
      }
    }
    await Bun.sleep(5_000);
  }
  throw new Error(`${workflow} did not appear for ${revision}`);
}

async function verifyProduction(version, revision) {
  for (let attempt = 0; attempt < 60; attempt += 1) {
    try {
      const response = await fetch(
        "https://app.openpost.social/api/v1/version",
        { signal: AbortSignal.timeout(10_000) },
      );
      const info = response.ok ? await response.json() : {};
      if (info.version === version && info.revision === revision) return;
    } catch {
      // Deployment readiness may briefly fail while the service restarts.
    }
    await Bun.sleep(5_000);
  }
  throw new Error(
    `production did not report ${version} at revision ${revision}`,
  );
}

async function verifyCandidateManifest(ciRun, version, revision) {
  const directory = await mkdtemp(
    path.join(os.tmpdir(), "openpost-release-candidate-"),
  );
  try {
    const repository = runCapture([
      "gh",
      "repo",
      "view",
      "--json",
      "nameWithOwner",
      "--jq",
      ".nameWithOwner",
    ]).trim();
    const artifact = resolveRunArtifact({
      repository,
      runId: ciRun.id,
      prefix: `release-manifest-${revision}-`,
    });
    run([
      "gh",
      "run",
      "download",
      ciRun.id,
      "--name",
      artifact,
      "--dir",
      directory,
    ]);
    await readReleaseManifest(path.join(directory, "release-manifest.json"), {
      expectedVersion: version,
      expectedRevision: revision,
    });
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
}

async function verifyProductionReady() {
  let response;
  try {
    response = await fetch("https://app.openpost.social/api/v1/ready", {
      signal: AbortSignal.timeout(10_000),
    });
  } catch (error) {
    throw new Error(`production readiness preflight failed: ${error.message}`);
  }
  if (!response.ok)
    throw new Error(
      `production readiness preflight returned HTTP ${response.status}`,
    );
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
    throw new Error(
      `GitHub permission ${JSON.stringify(permission)} cannot publish a release`,
    );
  }

  const secrets = new Set(
    runCapture([
      "gh",
      "secret",
      "list",
      "--app",
      "actions",
      "--json",
      "name",
      "--jq",
      ".[].name",
    ])
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
  if (!Number.isFinite(availableKiB))
    throw new Error("could not determine free disk space");
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
  const proc = Bun.spawn(
    ["docker", "info", "--format", "{{.ServerVersion}} {{.MemTotal}}"],
    {
      cwd: root,
      stdout: "pipe",
      stderr: "pipe",
    },
  );
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
    throw new Error(
      `Docker daemon did not respond within ${timeoutMs / 1_000} seconds`,
    );
  if (exitCode !== 0 || !serverInfo.trim()) {
    throw new Error(
      `Docker daemon is unavailable: ${errorOutput.trim() || `exit ${exitCode}`}`,
    );
  }

  if (process.platform === "darwin") {
    const [, memoryBytesText] = serverInfo.trim().split(/\s+/, 2);
    const memoryBytes = Number(memoryBytesText);
    const minimumGiB = Number(
      process.env.OPENPOST_DOCKER_MIN_MEMORY_GIB ?? "9.5",
    );
    if (!Number.isFinite(minimumGiB) || minimumGiB <= 0) {
      throw new Error(
        "OPENPOST_DOCKER_MIN_MEMORY_GIB must be a positive number",
      );
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
    env: { ...process.env, ...extraEnv },
    stdin: "inherit",
    stdout: "inherit",
    stderr: "inherit",
  });
  if (result.exitCode !== 0)
    throw new Error(`${argv[0]} exited with ${result.exitCode}`);
}

function runCapture(argv, extraEnv = {}) {
  const result = Bun.spawnSync(argv, {
    cwd: root,
    env: { ...process.env, ...extraEnv },
    stdout: "pipe",
    stderr: "inherit",
  });
  if (result.exitCode !== 0)
    throw new Error(`${argv[0]} exited with ${result.exitCode}`);
  return result.stdout.toString();
}

function runOptional(argv) {
  const result = Bun.spawnSync(argv, {
    cwd: root,
    env: process.env,
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
  if (result.exitCode !== 0)
    throw new Error(`missing required command: ${name}`);
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
