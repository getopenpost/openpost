import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { spawn } from "node:child_process";
import { once } from "node:events";
import { chmod, mkdir, mkdtemp, readFile, readdir, rm, stat, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { fileURLToPath, pathToFileURL } from "node:url";

import { artifactManifest, packageFrontend, shouldCopyFrontendPath } from "./package-frontend.mjs";

const scriptDirectory = path.dirname(fileURLToPath(import.meta.url));
const imageResources = [
  "/onnxruntime-web/ort-wasm-simd-threaded.jsep.wasm",
  "/onnxruntime-web/ort-wasm-simd-threaded.wasm",
  "/onnxruntime-web/ort-wasm-simd-threaded.jsep.mjs",
  "/onnxruntime-web/ort-wasm-simd-threaded.mjs",
  "/models/isnet_quint8",
];
const sha256 = (value) => createHash("sha256").update(value).digest("hex");

async function writeImmutableAssetFixture(source, model = "model-weights\n") {
  await mkdir(path.join(source, "image-editor-models"), { recursive: true });
  const modelPath = "fixture.onnx";
  await Promise.all([
    writeFile(path.join(source, "image-editor-models/chunk.bin"), "chunk\n"),
    writeFile(
      path.join(source, "image-editor-models/resources.json"),
      JSON.stringify(
        Object.fromEntries([
          ...imageResources.map((resource) => [
            resource,
            { chunks: [{ name: "chunk.bin", hash: sha256("chunk\n"), offsets: [0, 6] }] },
          ]),
          [
            "/models/fixture",
            {
              chunks: [
                { name: modelPath, hash: sha256(model), offsets: [0, Buffer.byteLength(model)] },
              ],
            },
          ],
        ]),
      ),
    ),
    writeFile(
      path.join(source, "image-editor-models/bundle-manifest.json"),
      JSON.stringify({ version: 1, resources: [...imageResources, "/models/fixture"] }),
    ),
    writeFile(path.join(source, "image-editor-models", modelPath), model),
  ]);
}

async function interruptPackaging({ root, source, destination, phase }) {
  const runner = path.join(root, "interrupt-package-frontend.mjs");
  await writeFile(
    runner,
    [
      `import { packageFrontend } from ${JSON.stringify(pathToFileURL(path.join(scriptDirectory, "package-frontend.mjs")).href)};`,
      "const [sourceDirectory, destinationDirectory, pausePhase] = process.argv.slice(2);",
      "await packageFrontend({",
      "  sourceDirectory,",
      "  destinationDirectory,",
      "  onTransactionPhase: async (currentPhase) => {",
      "    if (currentPhase !== pausePhase) return;",
      "    process.stdout.write(`paused:${currentPhase}\\n`);",
      "    await new Promise(() => setInterval(() => {}, 1_000));",
      "  },",
      "});",
      "",
    ].join("\n"),
  );

  const child = spawn(process.execPath, [runner, source, destination, phase], {
    stdio: ["ignore", "pipe", "pipe"],
  });
  let stdout = "";
  let stderr = "";
  child.stdout.setEncoding("utf8");
  child.stderr.setEncoding("utf8");
  child.stdout.on("data", (chunk) => {
    stdout += chunk;
  });
  child.stderr.on("data", (chunk) => {
    stderr += chunk;
  });

  await new Promise((resolve, reject) => {
    const timeout = setTimeout(() => {
      reject(new Error(`Timed out waiting for interrupted packager (${stdout}${stderr})`));
    }, 10_000);
    const poll = setInterval(() => {
      if (!stdout.includes(`paused:${phase}`)) return;
      clearInterval(poll);
      clearTimeout(timeout);
      resolve();
    }, 10);
    child.once("exit", (code, signal) => {
      clearInterval(poll);
      clearTimeout(timeout);
      reject(new Error(`Packager exited before its pause point (${code ?? signal}): ${stderr}`));
    });
  });

  assert.equal(child.kill("SIGKILL"), true);
  const [, signal] = await once(child, "exit");
  assert.equal(signal, "SIGKILL");
}

async function assertNoTransactionDebris(destination) {
  const destinationParent = path.dirname(destination);
  const prefix = `.${path.basename(destination)}-package`;
  assert.deepEqual(
    (await readdir(destinationParent)).filter((entry) => entry.startsWith(prefix)),
    [],
  );
}

async function fixture() {
  const root = await mkdtemp(path.join(os.tmpdir(), "openpost-package-frontend-"));
  const source = path.join(root, "frontend-build");
  const destination = path.join(root, "apps/server", "public");
  await mkdir(path.join(source, "assets"), { recursive: true });
  await writeImmutableAssetFixture(source);
  await Promise.all([
    writeFile(path.join(source, "index.html"), "<!doctype html><h1>OpenPost</h1>\n"),
    writeFile(
      path.join(source, "app-routes.json"),
      `${JSON.stringify({ schema_version: 1, routes: ["/", "/settings"] })}\n`,
    ),
    writeFile(path.join(source, "assets", "app.js"), "console.log('openpost');\n"),
  ]);
  await chmod(path.join(source, "assets", "app.js"), 0o755);
  return { root, source, destination };
}

test("atomically mirrors the complete artifact and removes stale files", async (t) => {
  const { root, source, destination } = await fixture();
  t.after(() => rm(root, { recursive: true, force: true }));
  await mkdir(destination, { recursive: true });
  await writeFile(path.join(destination, "stale.js"), "stale\n");

  await packageFrontend({
    sourceDirectory: source,
    destinationDirectory: destination,
  });

  assert.deepEqual(await artifactManifest(destination), await artifactManifest(source));
  await assert.rejects(readFile(path.join(destination, "stale.js")), /ENOENT/);
  const executable = (await artifactManifest(destination)).find(
    (entry) => entry.path === "assets/app.js",
  );
  assert.equal(executable?.mode, 0o755);
  const [sourceModel, packagedModel] = await Promise.all([
    stat(path.join(source, "image-editor-models", "fixture.onnx")),
    stat(path.join(destination, "image-editor-models", "fixture.onnx")),
  ]);
  assert.equal(packagedModel.dev, sourceModel.dev);
  assert.equal(packagedModel.ino, sourceModel.ino);
});

test("a rejected source leaves the previous embed tree intact", async (t) => {
  const { root, source, destination } = await fixture();
  t.after(() => rm(root, { recursive: true, force: true }));
  await packageFrontend({
    sourceDirectory: source,
    destinationDirectory: destination,
  });
  const before = await artifactManifest(destination);
  await rm(path.join(source, "app-routes.json"));

  await assert.rejects(
    packageFrontend({
      sourceDirectory: source,
      destinationDirectory: destination,
    }),
    /missing app-routes\.json/,
  );
  assert.deepEqual(await artifactManifest(destination), before);
});

test("materializes immutable assets omitted from a cached frontend build", async (t) => {
  const { root, source, destination } = await fixture();
  t.after(() => rm(root, { recursive: true, force: true }));
  const canonical = path.join(root, "frontend-static");
  const client = path.join(root, "svelte-client");
  await writeImmutableAssetFixture(canonical, "cached-model-weights\n");
  await mkdir(path.join(client, "image-editor-models"), { recursive: true });
  await writeFile(path.join(client, "image-editor-models/fixture.onnx"), "stale-model-weights\n");
  await rm(path.join(source, "image-editor-models"), { recursive: true, force: true });

  await packageFrontend({
    sourceDirectory: source,
    destinationDirectory: destination,
    assetSourceDirectory: canonical,
    clientOutputDirectory: client,
  });

  const [canonicalModel, clientModel, buildModel, packagedModel] = await Promise.all([
    stat(path.join(canonical, "image-editor-models", "fixture.onnx")),
    stat(path.join(client, "image-editor-models", "fixture.onnx")),
    stat(path.join(source, "image-editor-models", "fixture.onnx")),
    stat(path.join(destination, "image-editor-models", "fixture.onnx")),
  ]);
  assert.equal(clientModel.ino, canonicalModel.ino);
  assert.equal(buildModel.ino, canonicalModel.ino);
  assert.equal(packagedModel.ino, canonicalModel.ino);
});

test("staging copy omits immutable assets before they are linked", () => {
  const source = "/work/openpost/frontend/build";
  assert.equal(shouldCopyFrontendPath(source, source), true);
  assert.equal(shouldCopyFrontendPath(source, path.join(source, "assets", "app.js")), true);
  assert.equal(shouldCopyFrontendPath(source, path.join(source, "image-editor-models")), false);
  assert.equal(
    shouldCopyFrontendPath(source, path.join(source, "image-editor-models", "model.onnx")),
    false,
  );
});

test("rejects overlapping source and destination paths", async (t) => {
  const { root, source } = await fixture();
  t.after(() => rm(root, { recursive: true, force: true }));

  await assert.rejects(
    packageFrontend({
      sourceDirectory: source,
      destinationDirectory: path.join(source, "nested"),
    }),
    /must be disjoint/,
  );
});

test("restores the validated previous artifact after interruption during the swap", async (t) => {
  const { root, source, destination } = await fixture();
  t.after(() => rm(root, { recursive: true, force: true }));
  await packageFrontend({
    sourceDirectory: source,
    destinationDirectory: destination,
  });
  const previous = await artifactManifest(destination);
  await writeFile(path.join(source, "assets", "app.js"), "console.log('replacement');\n");

  await interruptPackaging({
    root,
    source,
    destination,
    phase: "destination-backed-up",
  });
  await rm(path.join(source, "app-routes.json"));

  await assert.rejects(
    packageFrontend({
      sourceDirectory: source,
      destinationDirectory: destination,
    }),
    /missing app-routes\.json/,
  );
  assert.deepEqual(await artifactManifest(destination), previous);
  await assertNoTransactionDebris(destination);
});

test("keeps the validated replacement after interruption following installation", async (t) => {
  const { root, source, destination } = await fixture();
  t.after(() => rm(root, { recursive: true, force: true }));
  await packageFrontend({
    sourceDirectory: source,
    destinationDirectory: destination,
  });
  await writeFile(path.join(source, "assets", "app.js"), "console.log('replacement');\n");
  const replacement = await artifactManifest(source);

  await interruptPackaging({
    root,
    source,
    destination,
    phase: "destination-installed",
  });
  await rm(path.join(source, "app-routes.json"));

  await assert.rejects(
    packageFrontend({
      sourceDirectory: source,
      destinationDirectory: destination,
    }),
    /missing app-routes\.json/,
  );
  assert.deepEqual(await artifactManifest(destination), replacement);
  await assertNoTransactionDebris(destination);
});
