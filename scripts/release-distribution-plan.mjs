#!/usr/bin/env bun
import { fileURLToPath } from "node:url";

export const mobileReleasePaths = [
  "apps/mobile",
  "packages/api-contract",
  "packages/query-catalog",
  "packages/dither",
  "packages/platform-text",
  "packages/telemetry",
  "packages/video-project",
  "apps/web/openapi.json",
  "bunfig.toml",
];
export function mobileChanged(paths) {
  return paths.some((path) =>
    mobileReleasePaths.some((input) => path === input || path.startsWith(`${input}/`)),
  );
}

// Shared build inputs are deliberately conservative: a false positive costs a
// package check, while a false negative can leave a release unpublished.
export function distributionPlan(paths) {
  const shared =
    /^(bun\.lock|bunfig\.toml|package\.json|tsconfig[^/]*|apps\/web\/openapi\.json|packages\/api-contract\/)/;
  const changed = (directory) =>
    paths.some((path) => shared.test(path) || path.startsWith(directory));
  const npmTooling = paths.some((path) =>
    /^scripts\/(?:npm-package-release|check-npm-package-build|verify-published-npm-package)\.mjs$/.test(
      path,
    ),
  );
  return {
    sdk: changed("packages/sdk/") || npmTooling,
    n8n:
      changed("packages/n8n-nodes-openpost/") ||
      paths.some((path) =>
        /^scripts\/(?:generate-selected-automation-contract|n8n-package-release|check-n8n-package-build|verify-published-n8n-package)\.mjs$/.test(
          path,
        ),
      ),
    cli:
      npmTooling ||
      paths.some((path) =>
        /^(apps\/cli\/|packages\/cli\/|apps\/web\/openapi\.json$|go\.work(?:\.sum)?$|tsconfig[^/]*$|scripts\/(?:npm-package-release|check-npm-package-build)\.mjs$)/.test(
          path,
        ),
      ),
  };
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  const [base, head] = process.argv.slice(2);
  if (!base || !head) throw new Error("usage: release-distribution-plan.mjs <base> <head>");
  const result = Bun.spawnSync([
    "git",
    "diff",
    "--name-only",
    "-z",
    "--no-renames",
    base,
    head,
    "--",
  ]);
  if (result.exitCode !== 0) throw new Error(`git diff failed: ${result.stderr.toString()}`);
  const paths = result.stdout.toString().split("\0").filter(Boolean);
  const plan = distributionPlan(paths);
  if (process.argv.includes("--json")) {
    console.log(JSON.stringify({ ...plan, mobile: mobileChanged(paths) }));
    process.exit(0);
  }
  for (const [name, value] of Object.entries(plan)) console.log(`${name}=${value}`);
}
