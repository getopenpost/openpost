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

export function planCI(files, manifest, { full = false, release = false, reuse = false } = {}) {
  if (reuse) {
    // The exact SHA already passed the release plan on main. The tag only
    // rebuilds the versioned image from the proven frontend artifact, relays
    // the proven Android build when mobile changed, and refreshes the
    // time-dependent advisory gates.
    const proven = planCI(files, manifest, { release: true });
    return {
      ...Object.fromEntries(Object.keys(proven).map((name) => [name, false])),
      security: true,
      image: true,
      android: proven.android,
    };
  }
  if (release) {
    // Main pushes and unproven tags run the release plan: core gates always
    // run, and distributions follow the published-release diff so a
    // server-only release skips Android/n8n packaging. Only a green run of
    // this plan writes a release proof; path-filtered runs never do.
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
  // A changelog entry is required on every PR. It must not force the complete
  // test matrix; the policy job still validates the entry on every PR.
  const delivery = full
    ? true
    : files.some(
        (file) =>
          !file.startsWith("changes/") &&
          classifyReleasePath(file, manifest).surfaces.includes("delivery"),
      );
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
        "scripts/check-npm-package-build.mjs",
        "tests/build/npm-package-build.test.mjs",
        "scripts/verify-published-npm-package.mjs",
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
      ["apps/mobile/", "packages/api-contract/", "packages/query-catalog/", "packages/dither/"],
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
  const proofRun = option("--reuse") ?? "";
  const reuse = proofRun !== "";
  if (reuse && !/^[1-9][0-9]*$/u.test(proofRun)) {
    throw new Error("--reuse requires the proven CI run id");
  }
  const base = option("--base");
  const head = option("--head") ?? "HEAD";
  if (!release && !full && !reuse && !base)
    throw new Error("pass --full, --release, --reuse RUN, or --base REV [--head REV]");
  if (reuse && !base) throw new Error("--reuse needs the published release --base");
  const files = base ? changedFiles(base, head) : [];
  const plan = planCI(files, manifest, { full, release, reuse });
  const mode = reuse ? "reuse" : release ? "release" : full ? "full" : "filtered";
  const output = process.env.GITHUB_OUTPUT;
  for (const [name, value] of Object.entries({ ...plan, mode, proof_run: proofRun })) {
    const line = `${name}=${value}\n`;
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
      `## CI surface plan\n\n${reuse ? `Proven by CI run ${proofRun}: versioned image, advisories, and artifact relay only.` : release ? `Release candidate: core gates forced, distributions from ${files.length} changed path(s) since the last published stable release.` : full ? "Full candidate." : `${files.length} changed path(s).`}\n\n| Check | Decision |\n| --- | --- |\n${rows}\n`,
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
