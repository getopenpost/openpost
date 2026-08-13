import { spawnSync } from "node:child_process";
import { createRequire } from "node:module";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

export const frontendBuildHeapMiB = 8192;

// The editor graph needs more than Node's roughly 4 GiB default. This is an
// upper bound, not a reservation: retain user flags and larger heap choices,
// but append the repository minimum after a smaller cap so Node applies it.
const heapOptionPattern =
  /(?:^|\s)--max(?:-|_)old(?:-|_)space(?:-|_)size(?:=|\s+)(\d+)(?=\s|$)/g;

export function frontendBuildNodeOptions(nodeOptions = "") {
  const existing = nodeOptions.trim();
  const heapOptions = [...existing.matchAll(heapOptionPattern)];
  const effectiveHeapMiB = Number(heapOptions.at(-1)?.[1] ?? 0);
  if (effectiveHeapMiB >= frontendBuildHeapMiB) return existing;

  return [existing, `--max-old-space-size=${frontendBuildHeapMiB}`]
    .filter(Boolean)
    .join(" ");
}

export function parseFrontendBuildArguments(args) {
  if (args.length === 0) return {};
  if (args.length === 1 && args[0] === "--app-mode=capacitor") {
    return { appMode: "capacitor" };
  }

  throw new Error(
    `Unsupported frontend build arguments: ${args.join(" ") || "(none)"}`,
  );
}

export function runFrontendViteBuild({ appMode } = {}) {
  const repositoryRoot = path.resolve(
    path.dirname(fileURLToPath(import.meta.url)),
    "..",
  );
  const requireFromFrontend = createRequire(
    path.join(repositoryRoot, "frontend/package.json"),
  );
  const vitePackage = requireFromFrontend.resolve("vite/package.json");
  const environment = {
    ...process.env,
    NODE_OPTIONS: frontendBuildNodeOptions(process.env.NODE_OPTIONS),
    OPENPOST_PARAGLIDE_PRECOMPILED: "1",
  };
  if (appMode) environment.VITE_APP_MODE = appMode;

  const result = spawnSync(
    process.execPath,
    [path.join(path.dirname(vitePackage), "bin/vite.js"), "build"],
    {
      cwd: path.join(repositoryRoot, "frontend"),
      env: environment,
      stdio: "inherit",
    },
  );
  if (result.error) throw result.error;
  if (result.signal) {
    throw new Error(`Frontend Vite build stopped by signal ${result.signal}`);
  }
  if (result.status !== 0) process.exit(result.status ?? 1);
}

const isEntrypoint =
  process.argv[1] &&
  pathToFileURL(path.resolve(process.argv[1])).href === import.meta.url;
if (isEntrypoint) {
  runFrontendViteBuild(parseFrontendBuildArguments(process.argv.slice(2)));
}
