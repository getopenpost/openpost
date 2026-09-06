import assert from "node:assert/strict";
import test from "node:test";
import { execFileSync } from "node:child_process";
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

import {
  classifyReleasePath,
  maintainedReleasePaths,
  readReleaseSurfaceManifest,
  readReleaseSurfaceManifestAtRevision,
  releaseSurfacePlan,
  trackedReleasePaths,
  validateReleaseSurfaceManifest,
} from "./release-surfaces.mjs";

test("every tracked path has explicit release ownership", () => {
  const manifest = readReleaseSurfaceManifest();
  assert.deepEqual(validateReleaseSurfaceManifest(manifest, trackedReleasePaths()), []);
});

test("untracked maintained paths participate in the ownership gate", () => {
  assert.ok(maintainedReleasePaths().includes("config/release-surfaces.json"));
});

test("root build, Compose, registry, skills, launch, and scripts are classified", () => {
  const manifest = readReleaseSurfaceManifest();
  const expected = new Map([
    ["package.json", "delivery"],
    ["docker-compose.yml", "delivery"],
    ["config/mcp/server.json", "agent-tools"],
    [".agents/skills/openpost-cli/SKILL.md", "agent-tools"],
    ["docs/launch-kit/README.md", "launch"],
    ["scripts/release.mjs", "delivery"],
    ["scripts/oxlint/anti-slop/index.ts", "delivery"],
  ]);
  for (const [file, surface] of expected) {
    assert.ok(classifyReleasePath(file, manifest).surfaces.includes(surface));
  }
});

test("a new unowned path fails closed", () => {
  const manifest = readReleaseSurfaceManifest();
  const problems = validateReleaseSurfaceManifest(manifest, [
    ...trackedReleasePaths(),
    "new-release-root.txt",
  ]);
  assert.ok(problems.includes("unowned tracked path: new-release-root.txt"));
});

test("removed paths retain their previous release surface", () => {
  const currentManifest = {
    schema_version: 1,
    surfaces: {
      documentation: {
        description: "Current documentation",
        paths: ["README.md"],
      },
    },
  };
  const previousManifest = {
    schema_version: 1,
    surfaces: {
      documentation: {
        description: "Previous documentation",
        paths: ["removed.md"],
      },
    },
  };

  assert.deepEqual(releaseSurfacePlan(["removed.md"], currentManifest, previousManifest), [
    {
      file: "removed.md",
      surfaces: ["documentation"],
      exemption: undefined,
    },
  ]);
});

test("release comparisons can read manifests before and after the repository move", () => {
  const root = mkdtempSync(path.join(tmpdir(), "openpost-release-history-"));
  const git = (...args) => execFileSync("git", args, { cwd: root, encoding: "utf8" }).trim();
  try {
    git("init", "--quiet");
    const manifest = { schema_version: 1, surfaces: { application: { prefixes: ["backend/"] } } };
    writeFileSync(path.join(root, "release-surfaces.json"), JSON.stringify(manifest));
    git("add", ".");
    git(
      "-c",
      "user.name=Test",
      "-c",
      "user.email=test@example.com",
      "commit",
      "--quiet",
      "-m",
      "Original layout",
    );
    const original = git("rev-parse", "HEAD");
    mkdirSync(path.join(root, "config"));
    git("mv", "release-surfaces.json", "config/release-surfaces.json");
    const moved = { schema_version: 1, surfaces: { application: { prefixes: ["apps/server/"] } } };
    writeFileSync(path.join(root, "config/release-surfaces.json"), JSON.stringify(moved));
    git("add", ".");
    git(
      "-c",
      "user.name=Test",
      "-c",
      "user.email=test@example.com",
      "commit",
      "--quiet",
      "-m",
      "Grouped layout",
    );
    assert.deepEqual(readReleaseSurfaceManifestAtRevision(original, root), manifest);
    assert.deepEqual(readReleaseSurfaceManifestAtRevision("HEAD", root), moved);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
