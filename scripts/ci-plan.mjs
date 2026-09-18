#!/usr/bin/env bun

import { execFileSync } from "node:child_process";
import { appendFileSync, readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import {
  classifyReleasePath,
  maintainedReleasePaths,
  readReleaseSurfaceManifest,
  validateReleaseSurfaceManifest,
} from "./release-surfaces.mjs";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

export function planCI(files, manifest, { full = false, release = false } = {}) {
  if (release) {
    // Release candidates must prove the full core product on their own tag.
    // A green path-filtered main run is not proof: it may have been canceled
    // or skipped the backend/security gates that this candidate inherits.
    // Core gates therefore always run; distributions follow the tag diff so a
    // server-only release neither builds nor waits for Android/n8n packaging.
    const filtered = planFiltered(files, manifest);
    return {
      ...filtered,
      application: true,
      backend: true,
      frontend: true,
      security: true,
      image: true,
    };
  }
  return planFiltered(files, manifest, { full });
}

function planFiltered(files, manifest, { full = false } = {}) {
  const touched = new Set(files.flatMap((file) => classifyReleasePath(file, manifest).surfaces));
  const delivery = full || touched.has("delivery");
  const sharedAssets = manifest.surfaces["shared-assets"].prefixes;
  const matches = (prefixes, paths = []) =>
    full ||
    delivery ||
    files.some(
      (file) => paths.includes(file) || prefixes.some((prefix) => file.startsWith(prefix)),
    );

  return {
    application: full || delivery || touched.has("application") || touched.has("shared-assets"),
    backend: matches(["apps/server/"], ["go.work", "go.work.sum"]),
    frontend: matches(
      ["apps/web/", "packages/", ...sharedAssets],
      ["package.json", "bun.lock", "bunfig.toml", "turbo.json"],
    ),
    marketing: full || delivery || touched.has("marketing") || touched.has("shared-assets"),
    documentation: full || delivery || touched.has("documentation") || touched.has("shared-assets"),
    cli: matches(["apps/cli/"], ["go.work", "go.work.sum"]),
    n8n: matches(
      ["packages/n8n-nodes-openpost/"],
      [
        "bun.lock",
        "package.json",
        "scripts/generate-selected-automation-contract.mjs",
        "scripts/generate-selected-automation-contract.test.mjs",
        "scripts/n8n-package-release.mjs",
        "scripts/n8n-package-release.test.mjs",
      ],
    ),
    npm: matches(
      ["packages/sdk/", "packages/cli/"],
      [
        "bun.lock",
        "package.json",
        "scripts/npm-package-release.mjs",
        "scripts/npm-package-release.test.mjs",
      ],
    ),
    security: matches(
      ["apps/server/", "apps/cli/", "apps/web/", "apps/mobile/", "packages/"],
      ["bun.lock", "package.json", "go.work", "go.work.sum"],
    ),
    image: matches(
      [
        "apps/server/",
        "apps/web/",
        "packages/",
        ...sharedAssets,
        "deploy/docker/",
        "config/provider-certification/",
      ],
      [".dockerignore", "bun.lock", "bunfig.toml", "package.json", "turbo.json"],
    ),
    android: matches(
      ["apps/mobile/", "packages/api-contract/", "packages/query-catalog/"],
      ["apps/web/openapi.json"],
    ),
    cache_contract: files.some(
      (file) =>
        [
          "scripts/verify-frontend-build-cache.mjs",
          "scripts/package-frontend.mjs",
          "scripts/frontend-vite-build.mjs",
          "scripts/sync-assets.mjs",
        ].includes(file) ||
        [
          "bun.lock",
          "bunfig.toml",
          "package.json",
          "turbo.json",
          "apps/web/package.json",
          "apps/web/turbo.json",
        ].includes(file),
    ),
  };
}

function changedFiles(base, head) {
  return execFileSync("git", ["diff", "--name-only", "--no-renames", `${base}...${head}`], {
    cwd: root,
    encoding: "utf8",
  })
    .split("\n")
    .filter(Boolean)
    .sort();
}

function option(name) {
  const index = process.argv.indexOf(name);
  return index >= 0 ? process.argv[index + 1] : undefined;
}

function main() {
  const manifest = readReleaseSurfaceManifest(root);
  const problems = validateReleaseSurfaceManifest(manifest, maintainedReleasePaths(root), root);
  if (problems.length) {
    throw new Error(`release surface ownership failed: ${problems.join("; ")}`);
  }

  const full = process.argv.includes("--full");
  const release = process.argv.includes("--release");
  const base = option("--base");
  const head = option("--head") ?? "HEAD";
  if (!release && !full && !base)
    throw new Error("pass --full, --release, or --base REV [--head REV]");
  const files = base ? changedFiles(base, head) : [];
  const plan = planCI(files, manifest, { full, release });
  const output = process.env.GITHUB_OUTPUT;
  for (const [name, enabled] of Object.entries(plan)) {
    const line = `${name}=${enabled}\n`;
    if (output) appendFileSync(output, line);
    else process.stdout.write(line);
  }
  const summary = process.env.GITHUB_STEP_SUMMARY;
  if (summary) {
    const rows = Object.entries(plan)
      .map(([name, enabled]) => `| ${name} | ${enabled ? "run" : "skip"} |`)
      .join("\n");
    appendFileSync(
      summary,
      `## CI surface plan\n\n${release ? `Release candidate: core gates forced, distributions from ${files.length} changed path(s) since the previous tag.` : full ? "Full main candidate." : `${files.length} changed path(s).`}\n\n| Check | Decision |\n| --- | --- |\n${rows}\n`,
    );
  }
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  try {
    main();
  } catch (error) {
    console.error(`ci-plan: ${error.message}`);
    process.exitCode = 1;
  }
}
