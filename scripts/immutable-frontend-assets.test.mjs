import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdir, mkdtemp, readFile, rm, stat, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import {
  copyFrontendWithoutImmutableAssets,
  frontendAssetOutputDirectories,
  materializeImmutableFrontendAssets,
} from "./immutable-frontend-assets.mjs";

const imageResources = [
  "/onnxruntime-web/ort-wasm-simd-threaded.jsep.wasm",
  "/onnxruntime-web/ort-wasm-simd-threaded.wasm",
  "/onnxruntime-web/ort-wasm-simd-threaded.jsep.mjs",
  "/onnxruntime-web/ort-wasm-simd-threaded.mjs",
  "/models/isnet_quint8",
];
const sha256 = (value) => createHash("sha256").update(value).digest("hex");

async function writeValidAssetFixture(source) {
  await mkdir(path.join(source, "image-editor-models"), { recursive: true });
  await Promise.all([
    writeFile(path.join(source, "image-editor-models/chunk.bin"), "chunk\n"),
    writeFile(
      path.join(source, "image-editor-models/resources.json"),
      JSON.stringify(
        Object.fromEntries(
          imageResources.map((resource) => [
            resource,
            { chunks: [{ name: "chunk.bin", hash: sha256("chunk\n"), offsets: [0, 6] }] },
          ]),
        ),
      ),
    ),
    writeFile(
      path.join(source, "image-editor-models/bundle-manifest.json"),
      JSON.stringify({ version: 1, resources: imageResources }),
    ),
  ]);
}

test("immutable editor assets replace generated copies with shared files", async (t) => {
  const root = await mkdtemp(path.join(os.tmpdir(), "openpost-immutable-assets-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  const source = path.join(root, "static");
  const output = path.join(root, "build");
  await writeValidAssetFixture(source);
  await mkdir(path.join(output, "image-editor-models"), { recursive: true });
  await Promise.all([
    writeFile(path.join(output, "image-editor-models", "chunk.bin"), "copy\n"),
    writeFile(path.join(output, "image-editor-models", "stale.onnx"), "stale\n"),
    writeFile(path.join(output, "app.js"), "app\n"),
  ]);

  await materializeImmutableFrontendAssets({
    sourceDirectory: source,
    outputDirectory: output,
  });

  const [canonical, materialized] = await Promise.all([
    stat(path.join(source, "image-editor-models", "chunk.bin")),
    stat(path.join(output, "image-editor-models", "chunk.bin")),
  ]);
  assert.equal(materialized.ino, canonical.ino);
  assert.equal(await readFile(path.join(output, "app.js"), "utf8"), "app\n");
  await assert.rejects(stat(path.join(output, "image-editor-models", "stale.onnx")), /ENOENT/u);
});

test("thin frontend copies omit immutable assets before build tools copy public files", async (t) => {
  const root = await mkdtemp(path.join(os.tmpdir(), "openpost-thin-frontend-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  const source = path.join(root, "static");
  const output = path.join(root, "thin");
  await writeValidAssetFixture(source);
  await writeFile(path.join(source, "robots.txt"), "User-agent: *\n");

  await copyFrontendWithoutImmutableAssets({ sourceDirectory: source, outputDirectory: output });

  assert.equal(await readFile(path.join(output, "robots.txt"), "utf8"), "User-agent: *\n");
  await assert.rejects(stat(path.join(output, "image-editor-models")), /ENOENT/u);
});

test("frontend asset materialization targets only generated surface trees", () => {
  assert.deepEqual(frontendAssetOutputDirectories("web", "/work/openpost"), [
    "/work/openpost/apps/web/.svelte-kit/output/client",
    "/work/openpost/apps/web/build",
  ]);
  assert.throws(() => frontendAssetOutputDirectories("android", "/work/openpost"));
});

test("missing canonical asset directories fail without changing generated copies", async (t) => {
  const root = await mkdtemp(path.join(os.tmpdir(), "openpost-immutable-assets-missing-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  const source = path.join(root, "static");
  const output = path.join(root, "build");
  await mkdir(path.join(output, "image-editor-models"), { recursive: true });
  await writeFile(path.join(output, "image-editor-models", "removed.onnx"), "stale\n");

  await assert.rejects(
    materializeImmutableFrontendAssets({
      sourceDirectory: source,
      outputDirectory: output,
    }),
    /Missing canonical immutable frontend asset directory/u,
  );

  assert.equal(
    await readFile(path.join(output, "image-editor-models", "removed.onnx"), "utf8"),
    "stale\n",
  );
});

test("missing manifest entries fail without changing generated copies", async (t) => {
  const root = await mkdtemp(path.join(os.tmpdir(), "openpost-immutable-assets-partial-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  const source = path.join(root, "static");
  const output = path.join(root, "build");
  await writeValidAssetFixture(source);
  await rm(path.join(source, "image-editor-models/chunk.bin"));
  await mkdir(path.join(output, "image-editor-models"), { recursive: true });
  await writeFile(path.join(output, "image-editor-models/stale.onnx"), "stale\n");

  await assert.rejects(
    materializeImmutableFrontendAssets({ sourceDirectory: source, outputDirectory: output }),
    /Missing canonical immutable frontend asset/u,
  );

  assert.equal(
    await readFile(path.join(output, "image-editor-models/stale.onnx"), "utf8"),
    "stale\n",
  );
});

test("same-size asset corruption fails digest validation", async (t) => {
  const root = await mkdtemp(path.join(os.tmpdir(), "openpost-immutable-assets-corrupt-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  const source = path.join(root, "static");
  const output = path.join(root, "build");
  await writeValidAssetFixture(source);
  await writeFile(path.join(source, "image-editor-models/chunk.bin"), "wrong\n");

  await assert.rejects(
    materializeImmutableFrontendAssets({ sourceDirectory: source, outputDirectory: output }),
    /Invalid canonical immutable frontend asset digest/u,
  );
});
