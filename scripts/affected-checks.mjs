import { execFileSync, spawnSync } from "node:child_process";
import path from "node:path";

import {
  changedReleasePaths,
  classifyReleasePath,
  maintainedReleasePaths,
  readReleaseSurfaceManifest,
  validateReleaseSurfaceManifest,
} from "./release-surfaces.mjs";

// These are owner scopes of tasks.mjs, not a second package dependency graph.
const owners = [
  ["apps/server/", "backend"],
  ["apps/cli/", "cli"],
  ["apps/web/src/", "frontend"],
  ["apps/marketing/src/", "marketing"],
  ["apps/docs/", "docs"],
  ["apps/mobile/src/", "mobile"],
  ["apps/mobile/plugins/", "mobile"],
];
const separateGates = [
  "Playwright app/marketing/docs E2E",
  "security/advisory scans",
  "Go race and Hosted integration checks",
  "production builds/container smoke and cross-platform/native packaging",
];

export function affectedSelection(args, root) {
  let base;
  const seen = new Set();
  for (let index = 0; index < args.length; index++) {
    const flag = args[index];
    if (!["--base", "--plan"].includes(flag) || seen.has(flag)) {
      throw new Error(`check:affected: invalid or duplicate argument ${JSON.stringify(flag)}`);
    }
    seen.add(flag);
    if (flag === "--base") {
      base = args[++index];
      if (!base || base.startsWith("-")) throw new Error("check:affected: --base needs a revision");
    }
  }
  const git = (...argv) =>
    execFileSync("git", argv, {
      cwd: root,
      encoding: "utf8",
      maxBuffer: 64 * 1024 * 1024,
    });
  if (git("ls-files", "--unmerged", "-z")) {
    throw new Error("check:affected: resolve index conflicts before checking");
  }
  const resolveCommit = (revision) => {
    const resolved = spawnSync(
      "git",
      [
        "-c",
        "core.warnAmbiguousRefs=true",
        "rev-parse",
        "--verify",
        "--end-of-options",
        `${revision}^{commit}`,
      ],
      { cwd: root, encoding: "utf8", maxBuffer: 64 * 1024 * 1024 },
    );
    const commit = resolved.stdout?.trim() ?? "";
    const diagnostic = resolved.stderr?.trim() ?? "";
    if (
      resolved.error ||
      resolved.status !== 0 ||
      diagnostic ||
      !/^(?:[0-9a-f]{40}|[0-9a-f]{64})$/u.test(commit)
    ) {
      throw new Error(
        `check:affected: cannot resolve ${JSON.stringify(revision)} unambiguously to one commit; use an explicit ref such as refs/heads/<name> or refs/tags/<name>. ${diagnostic || resolved.error?.message || "Git must return exactly one commit ID."}`,
      );
    }
    return commit;
  };
  const head = resolveCommit("HEAD");
  let baseSha = null;
  let mergeBase = null;
  if (base !== undefined) {
    baseSha = resolveCommit(base);
    const bases = git("merge-base", "--all", baseSha, head).trim().split("\n").filter(Boolean);
    if (bases.length !== 1) throw new Error("check:affected: require exactly one merge-base");
    [mergeBase] = bases;
  }
  // The maintained helper unions NUL-delimited committed, working, staged and
  // untracked paths; --no-renames keeps both sides, including deletions.
  const files = changedReleasePaths(mergeBase ?? head, root);
  const reasons = [];
  const scopes = new Set();
  let manifest;
  try {
    manifest = readReleaseSurfaceManifest(root);
    const problems = validateReleaseSurfaceManifest(manifest, maintainedReleasePaths(root), root);
    if (problems.length) reasons.push(`release ownership: ${problems[0]}`);
  } catch (error) {
    reasons.push(`release ownership unavailable: ${error.message}`);
  }
  for (const file of files) {
    const classification = manifest ? classifyReleasePath(file, manifest) : { surfaces: [] };
    const owner = owners.find(([prefix]) => file.startsWith(prefix))?.[1];
    const configuration =
      /(?:^|\/)(?:\.[^/]+|[^/]*(?:config|setup)[^/]*|package\.json|bun\.lock|go\.(?:mod|sum))$/iu.test(
        file,
      ) || /\.(?:jsonc?|ya?ml|toml|nix|lock)$/iu.test(path.basename(file));
    const shared =
      file.startsWith("packages/") ||
      file.startsWith("assets/") ||
      file.startsWith("apps/web/messages/");
    if (
      !owner ||
      configuration ||
      shared ||
      classification.surfaces.includes("delivery") ||
      classification.surfaces.length === 0
    ) {
      reasons.push(`full preflight required for ${JSON.stringify(file)}`);
    } else {
      scopes.add(owner);
    }
  }
  const fallback = reasons.length > 0;
  return {
    files,
    head,
    base: base ?? null,
    baseSha,
    mergeBase,
    scopes: [...scopes].sort(),
    fallback,
    reasons,
    omitted: fallback
      ? separateGates
      : [
          "aggregate repository policy",
          "lint, except incidental check-owned/mobile gates; full dead-code sweep and package payload verification",
          "unselected module/workspace checks and tests",
          ...separateGates,
        ],
    proof: "Local checkout feedback only. No release proof or deployment verification.",
  };
}
