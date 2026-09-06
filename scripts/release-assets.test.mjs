import assert from "node:assert/strict";
import test from "node:test";

import { validateRelease } from "./release-assets.mjs";

const downloads = [
  "openpost-server-linux-amd64",
  "openpost-server-darwin-arm64",
  "openpost-server-windows-amd64.exe",
  "openpost-cli-linux-amd64",
  "openpost-cli-linux-arm64",
  "openpost-cli-darwin-arm64",
  "openpost-cli-windows-amd64.exe",
  "openpost-mcp-linux-amd64",
  "openpost-mcp-linux-arm64",
  "openpost-mcp-darwin-arm64",
  "openpost-mcp-windows-amd64.exe",
  "openpost-app-android.apk",
];

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

test("a consistent draft can be reused while its expected assets are partial", () => {
  assert.deepEqual(
    validateRelease(
      release({
        body: `${notes}\n`,
        assets: [asset("openpost-app-android.apk")],
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
        asset("openpost-app-android.apk"),
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
        assets: downloads.map(asset),
      }),
      { tag, notes, complete: true, published: true },
    ),
    [],
  );
});

test("a complete release contains downloads without internal build metadata", () => {
  assert.deepEqual(
    validateRelease(release({ assets: downloads.map(asset) }), { tag, notes, complete: true }),
    [],
  );
  for (const name of [
    "release-manifest.json",
    "openpost-image-evidence.json",
    "openpost-image.spdx.json",
    "openpost-image-trivy.json",
    "openpost-app-android-release.json",
  ]) {
    assert.ok(
      validateRelease(release({ assets: [...downloads, name].map(asset) }), {
        tag,
        notes,
        complete: true,
      }).some((problem) => problem === `unexpected release asset: ${name}`),
    );
  }
  assert.ok(
    validateRelease(
      release({
        assets: downloads.filter((name) => name !== "openpost-server-linux-amd64").map(asset),
      }),
      { tag, notes, complete: true },
    ).includes("missing release asset: openpost-server-linux-amd64"),
  );
});
