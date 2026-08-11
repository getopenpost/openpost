import { spawnSync } from "node:child_process";
import { randomUUID } from "node:crypto";
import { lstat, mkdir, mkdtemp, rename, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import {
  artifactManifest,
  defaultDestinationDirectory,
  defaultSourceDirectory,
  packageFrontend,
  repositoryRoot,
} from "./package-frontend.mjs";

const keepOutput = process.argv.includes("--keep-output");
const cacheDirectory = await mkdtemp(
  path.join(os.tmpdir(), "openpost-frontend-turbo-cache-"),
);
const lockDirectory = path.join(
  repositoryRoot,
  ".frontend-build-cache-proof.lock",
);
const generatedPaths = [
  defaultSourceDirectory,
  defaultDestinationDirectory,
  path.join(repositoryRoot, "frontend/.svelte-kit"),
  path.join(repositoryRoot, "frontend/project.inlang/.gitignore"),
  path.join(repositoryRoot, "frontend/project.inlang/.meta.json"),
  path.join(repositoryRoot, "frontend/project.inlang/README.md"),
  path.join(repositoryRoot, "frontend/project.inlang/cache"),
  path.join(repositoryRoot, "frontend/src/lib/paraglide"),
  path.join(repositoryRoot, "frontend/static/assets"),
];
const preserved = [];

async function exists(pathname) {
  try {
    await lstat(pathname);
    return true;
  } catch (error) {
    if (error?.code === "ENOENT") return false;
    throw error;
  }
}

async function preserveGeneratedPaths() {
  for (const pathname of generatedPaths) {
    if (!(await exists(pathname))) continue;
    const backup = `${pathname}.cache-proof-backup-${randomUUID()}`;
    await rename(pathname, backup);
    preserved.push({ pathname, backup });
  }
}

async function clearProofOutputs() {
  await Promise.all(
    generatedPaths.map((pathname) =>
      rm(pathname, { recursive: true, force: true }),
    ),
  );
}

async function restoreGeneratedPaths() {
  const keep = new Set(
    keepOutput ? [defaultSourceDirectory, defaultDestinationDirectory] : [],
  );
  const errors = [];
  for (const pathname of [...generatedPaths].reverse()) {
    try {
      const record = preserved.find(
        (candidate) => candidate.pathname === pathname,
      );
      if (keep.has(pathname)) {
        if (record) await rm(record.backup, { recursive: true, force: true });
        continue;
      }
      await rm(pathname, { recursive: true, force: true });
      if (record) await rename(record.backup, pathname);
    } catch (error) {
      errors.push(error);
    }
  }
  if (errors.length > 0) {
    throw new AggregateError(
      errors,
      "Could not restore every path preserved by the frontend cache proof",
    );
  }
}

function turbo(args, { capture = false } = {}) {
  const result = spawnSync("bunx", ["turbo", ...args], {
    cwd: repositoryRoot,
    encoding: capture ? "utf8" : undefined,
    stdio: capture ? "pipe" : "inherit",
    maxBuffer: 30 * 1024 * 1024,
  });
  if (result.status !== 0) {
    if (capture && result.stderr) process.stderr.write(result.stderr);
    throw new Error(`Turbo failed with exit code ${result.status}`);
  }
  return result.stdout;
}

const common = [
  "run",
  "build",
  "--filter",
  "@openpost/web",
  "--cache-dir",
  cacheDirectory,
  "--output-logs",
  "errors-only",
];

function dryBuild() {
  return JSON.parse(
    turbo(
      [
        "run",
        "build",
        "--filter",
        "@openpost/web",
        "--cache-dir",
        cacheDirectory,
        "--dry=json",
      ],
      { capture: true },
    ),
  );
}

function changedTaskInputs(before, after) {
  const changes = [];
  const beforeTasks = new Map(before.tasks.map((task) => [task.taskId, task]));
  for (const task of after.tasks) {
    const previous = beforeTasks.get(task.taskId);
    if (!previous || previous.hash === task.hash) continue;
    const previousInputs = previous.inputs ?? {};
    const currentInputs = task.inputs ?? {};
    const paths = new Set([
      ...Object.keys(previousInputs),
      ...Object.keys(currentInputs),
    ]);
    const changed = [...paths]
      .filter(
        (pathname) => previousInputs[pathname] !== currentInputs[pathname],
      )
      .sort();
    changes.push(
      `${task.taskId} ${previous.hash} -> ${task.hash}: ${changed.join(", ") || "non-file task metadata"}`,
    );
  }
  return changes;
}

try {
  await mkdir(lockDirectory);
} catch (error) {
  await rm(cacheDirectory, { recursive: true, force: true });
  if (error?.code === "EEXIST") {
    throw new Error("Another frontend cache proof is already running");
  }
  throw error;
}

let proofError;
try {
  await preserveGeneratedPaths();
  const pristine = dryBuild();
  // The proof cache starts empty, so this is already a guaranteed miss. Avoid
  // --force here: forced tasks are not a portable cache-seeding contract.
  turbo(common);
  const cleanSource = await artifactManifest(defaultSourceDirectory);
  await packageFrontend();
  const cleanPackaged = await artifactManifest(defaultDestinationDirectory);
  if (JSON.stringify(cleanPackaged) !== JSON.stringify(cleanSource)) {
    throw new Error("Clean frontend packaging changed the artifact");
  }

  await clearProofOutputs();
  const dry = dryBuild();
  const frontendTask = dry.tasks.find(
    (task) => task.taskId === "@openpost/web#build",
  );
  if (frontendTask?.cache?.status !== "HIT") {
    const changes = changedTaskInputs(pristine, dry);
    throw new Error(
      `Expected the second frontend build to restore from cache, received ${frontendTask?.cache?.status ?? "no status"}. Changed task inputs: ${changes.join("; ") || "none"}`,
    );
  }

  turbo(common);
  const cachedSource = await artifactManifest(defaultSourceDirectory);
  await packageFrontend();
  const cachedPackaged = await artifactManifest(defaultDestinationDirectory);
  if (
    JSON.stringify(cachedSource) !== JSON.stringify(cleanSource) ||
    JSON.stringify(cachedPackaged) !== JSON.stringify(cleanSource)
  ) {
    throw new Error(
      "Cached frontend artifact differs from the clean build by path, content, or mode",
    );
  }
  console.log(
    `Frontend cache proof passed for ${cleanSource.length} files using content hashes and modes.`,
  );
} catch (error) {
  proofError = error;
}

const cleanupErrors = [];
try {
  await restoreGeneratedPaths();
} catch (error) {
  cleanupErrors.push(error);
}
try {
  await rm(cacheDirectory, { recursive: true, force: true });
} catch (error) {
  cleanupErrors.push(error);
}
try {
  await rm(lockDirectory, { recursive: true, force: true });
} catch (error) {
  cleanupErrors.push(error);
}

if (proofError && cleanupErrors.length > 0) {
  throw new AggregateError(
    [proofError, ...cleanupErrors],
    "Frontend cache proof failed and cleanup was incomplete",
  );
}
if (proofError) throw proofError;
if (cleanupErrors.length > 0) {
  throw new AggregateError(
    cleanupErrors,
    "Frontend cache proof cleanup was incomplete",
  );
}
