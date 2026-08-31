import assert from "node:assert/strict";
import test from "node:test";

import { expectedReleaseAssets, validateRelease } from "./release-assets.mjs";

const tag = "v4.5.6";
const notes = "## Fixed\n\n- Kept releases atomic.\n";

function release(overrides = {}) {
  return {
    tag_name: tag,
    name: tag,
    draft: true,
    prerelease: false,
    body: notes,
    assets: [],
    ...overrides,
  };
}

function asset(name) {
  return { name, state: "uploaded", size: 42 };
}

test("the canonical release asset set has no duplicate upload names", () => {
  assert.equal(new Set(expectedReleaseAssets).size, expectedReleaseAssets.length);
});

test("a consistent draft can be reused while its expected assets are partial", () => {
  assert.deepEqual(
    validateRelease(
      release({
        body: `${notes}\n`,
        assets: [asset("release-manifest.json")],
      }),
      { tag, notes },
    ),
    [],
  );
});

test("public, inconsistent, incomplete, and unfinished releases fail closed", () => {
  const problems = validateRelease(
    release({
      tag_name: "v0.0.0",
      name: "wrong",
      draft: false,
      prerelease: true,
      body: "wrong",
      assets: [
        asset("release-manifest.json"),
        asset("unexpected.txt"),
        { name: "openpost-app-android.apk", state: "new", size: 0 },
      ],
    }),
    { tag, notes, complete: true },
  );
  for (const expected of [
    "workflow tag",
    "title",
    "remain a draft",
    "must not be a prerelease",
    "notes",
    "unexpected release asset",
    "not completely uploaded",
    "missing release asset",
  ]) {
    assert.ok(problems.some((problem) => problem.includes(expected)));
  }
});

test("the same exact asset set validates after the final publication", () => {
  assert.deepEqual(
    validateRelease(
      release({
        draft: false,
        assets: expectedReleaseAssets.map(asset),
      }),
      { tag, notes, complete: true, published: true },
    ),
    [],
  );
});
