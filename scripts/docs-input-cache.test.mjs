import assert from "node:assert/strict";
import { test } from "bun:test";
import { mkdtemp, readFile, writeFile, rm, readdir } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { cachedDocsInputs, docsInputKey } from "./docs-input-cache.mjs";

test("verified docs inputs restore outputs, invalidate changed inputs and reject corruption", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "docs-inputs-"));
  let input = "source-a-toolchain-a";
  let calls = 0;
  const options = {
    root,
    outputs: ["result"],
    key: async () => input,
    generate: async () => {
      calls++;
      await writeFile(path.join(root, "result"), "expected");
    },
  };
  try {
    assert.equal(await cachedDocsInputs(options), "miss");
    await rm(path.join(root, "result"));
    assert.equal(await cachedDocsInputs(options), "hit");
    assert.equal(await readFile(path.join(root, "result"), "utf8"), "expected");
    assert.equal(calls, 1);
    input = "source-b-toolchain-a";
    assert.equal(await cachedDocsInputs(options), "miss");
    input = "source-b-toolchain-b";
    assert.equal(await cachedDocsInputs(options), "miss");
    const entry = path.join(root, ".turbo/docs-inputs", `${input}.json`);
    const manifest = JSON.parse(await readFile(entry, "utf8"));
    manifest.outputs.result.content = Buffer.from("corrupted").toString("base64");
    await writeFile(entry, JSON.stringify(manifest));
    assert.equal(await cachedDocsInputs(options), "miss");
    assert.equal(calls, 4);
    const unknown = {
      ...options,
      key: async () => {
        throw new Error("unknown toolchain");
      },
    };
    assert.equal(await cachedDocsInputs(unknown), "uncached");
    assert.equal(calls, 5);
    await assert.rejects(
      cachedDocsInputs({
        ...options,
        key: async () => "failure",
        generate: async () => {
          throw new Error("generator failed");
        },
      }),
      /generator failed/u,
    );
    assert.ok(!(await readdir(path.join(root, ".turbo/docs-inputs"))).includes("failure.json"));
    let version = 0;
    assert.equal(
      await cachedDocsInputs({ ...options, key: async () => String(version++) }),
      "uncached",
    );
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("actual fingerprint includes Go source, config, generator, toolchain and provenance", async () => {
  // Exercise the real discovery and toolchain probes, changing only task-owned
  // temporary inputs and restoring them even if an assertion fails.
  const root = path.resolve(import.meta.dirname, "..");
  const files = [
    "scripts/lane-a-cache-input-probe",
    "config/lane-a-cache-input-probe",
    "apps/server/lane-a-cache-input-probe.go",
    "apps/cli/lane-a-cache-input-probe.go",
  ].map((file) => path.join(root, file));
  try {
    const baseline = await docsInputKey(root);
    assert.equal(await docsInputKey(root), baseline);
    for (const file of files) {
      await writeFile(file, "first");
      const first = await docsInputKey(root);
      assert.notEqual(first, baseline);
      await writeFile(file, "second");
      assert.notEqual(await docsInputKey(root), first);
      await rm(file);
    }
    assert.notEqual(
      await docsInputKey(root, { ...process.env, GOTOOLCHAIN: "test-identity" }),
      baseline,
    );
    assert.notEqual(
      await docsInputKey(root, { ...process.env, CF_PAGES_COMMIT_SHA: "new-revision" }),
      baseline,
    );
  } finally {
    for (const file of files) await rm(file, { force: true });
  }
});
