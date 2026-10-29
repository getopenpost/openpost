import { test, expect } from "bun:test";
import { reusedDownloads } from "./release-reuse-notes.mjs";
const asset = {
  name: "openpost-app-android.apk",
  state: "uploaded",
  size: 10,
  digest: `sha256:${"a".repeat(64)}`,
  browser_download_url:
    "https://github.com/getopenpost/openpost/releases/download/v1.0.0/openpost-app-android.apk",
};
const release = { tag_name: "v1.0.0", draft: false, prerelease: false, assets: [asset] };
const identity = { expo: { version: "0.2.0", android: { versionCode: 2 } } };
function dependencies(overrides = {}) {
  return {
    releases: async () => [{ ...release, tag_name: "v1.1.0", assets: [] }, release],
    identity: async () => identity,
    paths: async () => [],
    verifyAsset: async (asset) =>
      asset.name.endsWith(".sha256")
        ? `${"a".repeat(64)}  ${asset.name.slice(0, -7)}\n`
        : undefined,
    ...overrides,
  };
}
test("finds APK across releases without assets and preserves its original tag", async () => {
  const notes = await reusedDownloads(
    {
      repository: "getopenpost/openpost",
      tag: "v1.2.0",
      plan: { mobile: false, cli: true, sdk: true, n8n: true },
      identity,
    },
    dependencies(),
  );
  expect(notes).toContain(asset.browser_download_url);
  expect(notes).toContain("0.2.0 (2)");
});
test("fails closed on missing, corrupt, changed-input or mismatched APK", async () => {
  const options = {
    repository: "getopenpost/openpost",
    tag: "v1.2.0",
    plan: { mobile: false, cli: true, sdk: true, n8n: true },
    identity,
  };
  for (const overrides of [
    { releases: async () => [] },
    { identity: async () => ({ expo: { version: "0.1.0", android: { versionCode: 1 } } }) },
    { paths: async () => ["packages/telemetry/src/index.ts"] },
    {
      verifyAsset: async () => {
        throw Error("digest mismatch");
      },
    },
    { releases: async () => [{ ...release, assets: [{ ...asset, digest: null }] }] },
    { releases: async () => [{ ...release, draft: true }] },
  ])
    await expect(reusedDownloads(options, dependencies(overrides))).rejects.toThrow();
});
test("changed distributions need no old downloads", async () => {
  expect(
    await reusedDownloads(
      { plan: { mobile: true, cli: true, sdk: true, n8n: true } },
      dependencies({
        releases: async () => {
          throw Error("unneeded lookup");
        },
      }),
    ),
  ).toBe("");
});

test("links unchanged CLI/MCP and package versions, and rejects incomplete recovery", async () => {
  const { coreReleaseAssets } = await import("./release-assets.mjs");
  const assets = coreReleaseAssets
    .filter((name) => /^openpost-(cli|mcp)-/.test(name))
    .map((name, index) => ({
      ...asset,
      digest: `sha256:${String(index + 1).padStart(64, "0")}`,
      name,
      browser_download_url: `https://github.com/getopenpost/openpost/releases/download/v1.0.0/${name}`,
    }));
  const options = {
    repository: "getopenpost/openpost",
    tag: "v1.2.0",
    plan: { mobile: true, cli: false, sdk: false, n8n: false },
  };
  const deps = dependencies({
    releases: async () => [{ ...release, assets }],
    verifyAsset: async (asset) =>
      asset.name.endsWith(".sha256")
        ? `${assets.find((binary) => binary.name === asset.name.slice(0, -7)).digest.slice(7)}  ${asset.name.slice(0, -7)}\n`
        : undefined,
    registry: async (directory) => ({ name: directory.slice(9), version: "0.1.0", pin: "v1.0.0" }),
  });
  const notes = await reusedDownloads(options, deps);
  expect(notes).toContain("v1.0.0 downloads");
  expect(notes).toContain("wrapper pins v1.0.0");
  expect(notes).toContain("sdk/v/0.1.0");
  for (const overrides of [
    {
      verifyAsset: async (asset) =>
        asset.name.endsWith(".sha256")
          ? `${assets.find((binary) => binary.name === asset.name.slice(0, -7)).digest.slice(7)}  other-binary\n`
          : undefined,
    },
    {
      verifyAsset: async (asset) =>
        asset.name.endsWith(".sha256")
          ? `${assets.find((binary) => !binary.name.endsWith(".sha256") && binary.name !== asset.name.slice(0, -7)).digest.slice(7)}  ${asset.name.slice(0, -7)}\n`
          : undefined,
    },

    {
      verifyAsset: async (asset) =>
        asset.name.endsWith(".sha256")
          ? `${"b".repeat(64)}  ${asset.name.slice(0, -7)}\n`
          : undefined,
    },

    { releases: async () => [{ ...release, assets: assets.slice(1) }] },
    { paths: async () => ["apps/cli/cmd/main.go"] },
    {
      registry: async () => {
        throw Error("unpublished package");
      },
    },
    { registry: async () => ({ name: "cli", version: "0.1.0", pin: "v0.9.0" }) },
  ])
    await expect(reusedDownloads(options, { ...deps, ...overrides })).rejects.toThrow();
});
