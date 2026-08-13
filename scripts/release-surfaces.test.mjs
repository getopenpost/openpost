import assert from "node:assert/strict";
import test from "node:test";

import {
  classifyReleasePath,
  maintainedReleasePaths,
  readReleaseSurfaceManifest,
  trackedReleasePaths,
  validateReleaseSurfaceManifest,
} from "./release-surfaces.mjs";

test("every tracked path has explicit release ownership", () => {
  const manifest = readReleaseSurfaceManifest();
  assert.deepEqual(
    validateReleaseSurfaceManifest(manifest, trackedReleasePaths()),
    [],
  );
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
