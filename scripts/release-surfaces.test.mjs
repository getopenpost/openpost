import assert from "node:assert/strict";
import test from "node:test";

import {
  classifyReleasePath,
  maintainedReleasePaths,
  readReleaseSurfaceManifest,
  releaseSurfacePlan,
  trackedReleasePaths,
  validateReleaseSurfaceManifest,
} from "./release-surfaces.mjs";

test("every tracked path has explicit release ownership", () => {
  const manifest = readReleaseSurfaceManifest();
  assert.deepEqual(validateReleaseSurfaceManifest(manifest, trackedReleasePaths()), []);
});

test("untracked maintained paths participate in the ownership gate", () => {
  assert.ok(maintainedReleasePaths().includes("release-surfaces.json"));
});

test("root build, Compose, registry, skills, launch, and scripts are classified", () => {
  const manifest = readReleaseSurfaceManifest();
  const expected = new Map([
    ["package.json", "delivery"],
    ["docker-compose.yml", "delivery"],
    ["server.json", "agent-tools"],
    ["skills/openpost/SKILL.md", "agent-tools"],
    ["launch-kit/README.md", "launch"],
    ["scripts/release.mjs", "delivery"],
    ["tools/oxlint/anti-slop/index.ts", "delivery"],
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
