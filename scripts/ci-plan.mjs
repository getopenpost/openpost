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

export function planCI(files, manifest, { full = false } = {}) {
  const touched = new Set(files.flatMap((file) => classifyReleasePath(file, manifest).surfaces));
  const delivery = full || touched.has("delivery");
  const matches = (prefixes, paths = []) =>
    full ||
    delivery ||
    files.some(
      (file) => paths.includes(file) || prefixes.some((prefix) => file.startsWith(prefix)),
    );

  return {
    application: full || delivery || touched.has("application") || touched.has("shared-assets"),
    backend: matches(["backend/"], ["go.work", "go.work.sum"]),
    frontend: matches(
      ["frontend/", "packages/", "assets/"],
      ["package.json", "bun.lock", "bunfig.toml", "turbo.json"],
    ),
    marketing: full || delivery || touched.has("marketing") || touched.has("shared-assets"),
    documentation: full || delivery || touched.has("documentation") || touched.has("shared-assets"),
    cli: matches(["cli/"], ["go.work", "go.work.sum"]),
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
    security: matches(
      ["backend/", "cli/", "frontend/", "mobile/", "packages/"],
      ["bun.lock", "package.json", "go.work", "go.work.sum"],
    ),
    image: matches(
      ["backend/", "frontend/", "packages/", "assets/", "docker/", "provider-certification/"],
      [".dockerignore", "bun.lock", "bunfig.toml", "package.json", "turbo.json"],
    ),
    android: matches(["mobile/"], ["frontend/openapi.json"]),
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
          "frontend/package.json",
          "frontend/turbo.json",
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
  const base = option("--base");
  const head = option("--head") ?? "HEAD";
  if (!full && !base) throw new Error("pass --full or --base REV [--head REV]");
  const files = base ? changedFiles(base, head) : [];
  const plan = planCI(files, manifest, { full });
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
      `## CI surface plan\n\n${full ? "Full main candidate." : `${files.length} changed path(s).`}\n\n| Check | Decision |\n| --- | --- |\n${rows}\n`,
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
