import assert from "node:assert/strict";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";

import { assetSurfaceManifest } from "./asset-surfaces.ts";
import {
  assetSizeReport,
  directAssetReferences,
  repositoryRoot,
  validateAssetSurfaceManifest,
  validateAssetTarget,
} from "./asset-surfaces.mjs";
import { moveAssetDirectory } from "./sync-assets.mjs";

test("finds deployed asset URLs without treating source imports as copies", () => {
  const source = [
    `const favicon = "/assets/brand/icon.svg";`,
    `const sourceImport = "../../../../assets/logos/x.svg?raw";`,
    `const editorAudio = "/video-editor-audio/assets/tap.wav";`,
    "const docsLogo = `${docsBase}assets/brand/logo-docs.svg`;",
  ].join("\n");

  assert.deepEqual(directAssetReferences(source), [
    "brand/icon.svg",
    "brand/logo-docs.svg",
  ]);
});

test(
  "every copied asset exists and has a source reference",
  { timeout: 15_000 },
  async () => {
    assert.deepEqual(await validateAssetSurfaceManifest(), []);
  },
);

test(
  "an undeclared reference fails the surface check",
  { timeout: 15_000 },
  async () => {
    const manifest = {
      ...assetSurfaceManifest,
      frontend: ["brand/logo.svg"],
    };
    const problems = await validateAssetSurfaceManifest(
      manifest,
      repositoryRoot,
      ["frontend"],
    );
    assert.ok(
      problems.includes("frontend references undeclared asset: brand/icon.svg"),
    );
  },
);

test("a package build validates only its selected asset surface", async () => {
  assert.deepEqual(
    await validateAssetSurfaceManifest(assetSurfaceManifest, repositoryRoot, [
      "frontend",
    ]),
    [],
  );
});

test("staged outputs reject missing and undeclared files", async () => {
  const target = await mkdtemp(path.join(tmpdir(), "openpost-assets-"));
  try {
    await mkdir(path.join(target, "brand"));
    await writeFile(path.join(target, "brand/icon.svg"), "<svg/>");
    await writeFile(path.join(target, "extra.svg"), "<svg/>");
    assert.deepEqual(
      await validateAssetTarget(
        "frontend",
        target,
        {
          ...assetSurfaceManifest,
          frontend: ["brand/icon.svg", "missing.svg"],
        },
        { verifyContents: false },
      ),
      [
        "frontend target is missing missing.svg",
        "frontend target has undeclared file extra.svg",
      ],
    );
  } finally {
    await rm(target, { recursive: true, force: true });
  }
});

test("staged outputs reject content that differs from the canonical asset", async () => {
  const target = await mkdtemp(path.join(tmpdir(), "openpost-assets-"));
  try {
    await mkdir(path.join(target, "brand"));
    await writeFile(path.join(target, "brand/icon.svg"), "changed");
    assert.deepEqual(await validateAssetTarget("frontend", target), [
      "frontend target content differs for brand/icon.svg",
    ]);
  } finally {
    await rm(target, { recursive: true, force: true });
  }
});

test("asset directory moves fall back safely across filesystems", async () => {
  const parent = await mkdtemp(path.join(tmpdir(), "openpost-asset-move-"));
  const source = path.join(parent, "source");
  const destination = path.join(parent, "destination");
  try {
    await mkdir(source);
    await writeFile(path.join(source, "asset.txt"), "asset contents");
    await moveAssetDirectory(source, destination, {
      renameDirectory: async () => {
        const error = new Error("cross-device link");
        error.code = "EXDEV";
        throw error;
      },
    });
    assert.equal(existsSync(source), false);
    assert.equal(
      await readFile(path.join(destination, "asset.txt"), "utf8"),
      "asset contents",
    );
  } finally {
    await rm(parent, { recursive: true, force: true });
  }
});

test("per-surface copies are smaller than three complete copies", async () => {
  const report = await assetSizeReport();
  assert.ok(report.copiedBytes < report.previousCopiedBytes);
  assert.ok(report.surfaceBytes.frontend < report.sourceBytes);
  assert.ok(report.surfaceBytes.docs < report.sourceBytes);
  assert.ok(report.surfaceBytes.marketing < report.sourceBytes);
});
