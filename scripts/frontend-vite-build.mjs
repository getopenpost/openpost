import { spawnSync } from "node:child_process";
import { mkdtemp, readFile, readdir, rm } from "node:fs/promises";
import { createRequire } from "node:module";
import os from "node:os";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

import {
  copyFrontendWithoutImmutableAssets,
  validateImmutableFrontendAssets,
} from "./immutable-frontend-assets.mjs";

export const frontendBuildHeapMiB = 8192;

// The editor graph needs more than Node's roughly 4 GiB default. This is an
// upper bound, not a reservation: retain user flags and larger heap choices,
// but append the repository minimum after a smaller cap so Node applies it.
const heapOptionPattern = /(?:^|\s)--max(?:-|_)old(?:-|_)space(?:-|_)size(?:=|\s+)(\d+)(?=\s|$)/g;

export function frontendBuildNodeOptions(nodeOptions = "") {
  const existing = nodeOptions.trim();
  const heapOptions = [...existing.matchAll(heapOptionPattern)];
  const effectiveHeapMiB = Number(heapOptions.at(-1)?.[1] ?? 0);
  if (effectiveHeapMiB >= frontendBuildHeapMiB) return existing;

  return [existing, `--max-old-space-size=${frontendBuildHeapMiB}`].filter(Boolean).join(" ");
}

export function parseFrontendBuildArguments(args) {
  if (args.length === 0) return {};

  throw new Error(`Unsupported frontend build arguments: ${args.join(" ") || "(none)"}`);
}

const uncompiledRuneCall =
  /\$(?:state|derived|effect|props|bindable|inspect|host)(?:\.[A-Za-z]+)?\s*\(/;

export async function validateCompiledWorkerRunes(workerDirectory) {
  const entries = await readdir(workerDirectory, { recursive: true, withFileTypes: true });
  const invalidFiles = [];
  for (const entry of entries) {
    if (!entry.isFile() || !entry.name.endsWith(".js")) continue;
    const filePath = path.join(entry.parentPath, entry.name);
    const contents = await readFile(filePath, "utf8");
    if (uncompiledRuneCall.test(contents)) {
      invalidFiles.push(path.relative(workerDirectory, filePath));
    }
  }
  if (invalidFiles.length > 0) {
    throw new Error(`Uncompiled Svelte rune calls in worker output: ${invalidFiles.join(", ")}`);
  }
}

export async function runFrontendViteBuild() {
  const repositoryRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
  const staticDirectory = path.join(repositoryRoot, "apps/web/static");
  await validateImmutableFrontendAssets(staticDirectory);
  const temporaryRoot = await mkdtemp(path.join(os.tmpdir(), "openpost-frontend-public-"));
  let exitStatus;
  try {
    const publicDirectory = path.join(temporaryRoot, "static");
    await copyFrontendWithoutImmutableAssets({
      sourceDirectory: staticDirectory,
      outputDirectory: publicDirectory,
    });
    const requireFromFrontend = createRequire(path.join(repositoryRoot, "apps/web/package.json"));
    const vitePackage = requireFromFrontend.resolve("vite/package.json");
    const environment = {
      ...process.env,
      NODE_OPTIONS: frontendBuildNodeOptions(process.env.NODE_OPTIONS),
      OPENPOST_BUILD_PUBLIC_DIR: publicDirectory,
      OPENPOST_PARAGLIDE_PRECOMPILED: "1",
    };
    const result = spawnSync(
      process.execPath,
      [path.join(path.dirname(vitePackage), "bin/vite.js"), "build"],
      {
        cwd: path.join(repositoryRoot, "apps/web"),
        env: environment,
        stdio: "inherit",
      },
    );
    if (result.error) throw result.error;
    if (result.signal) {
      throw new Error(`Frontend Vite build stopped by signal ${result.signal}`);
    }
    exitStatus = result.status ?? 1;
  } finally {
    await rm(temporaryRoot, { recursive: true, force: true });
  }
  if (exitStatus !== 0) process.exit(exitStatus);
  await validateCompiledWorkerRunes(
    path.join(repositoryRoot, "apps/web/build/_app/immutable/workers"),
  );
}

const isEntrypoint =
  process.argv[1] && pathToFileURL(path.resolve(process.argv[1])).href === import.meta.url;
if (isEntrypoint) {
  await runFrontendViteBuild(parseFrontendBuildArguments(process.argv.slice(2)));
}
