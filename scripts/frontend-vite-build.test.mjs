import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { describe, expect, test } from "bun:test";

import {
  frontendBuildHeapMiB,
  frontendBuildNodeOptions,
  parseFrontendBuildArguments,
  validateCompiledWorkerRunes,
} from "./frontend-vite-build.mjs";

describe("frontend Vite build memory", () => {
  test("adds the repository build heap when NODE_OPTIONS is empty", () => {
    expect(frontendBuildNodeOptions()).toBe("--max-old-space-size=8192");
  });

  test("preserves unrelated user options", () => {
    expect(frontendBuildNodeOptions(" --trace-warnings ")).toBe(
      `--trace-warnings --max-old-space-size=${frontendBuildHeapMiB}`,
    );
  });

  test.each([
    "--max-old-space-size=12288",
    "--max_old_space_size=12288 --trace-warnings",
    "--trace-warnings --max-old-space-size 12288",
  ])("keeps a larger explicit user heap: %s", (nodeOptions) => {
    expect(frontendBuildNodeOptions(nodeOptions)).toBe(nodeOptions);
  });

  test("raises a smaller user heap without discarding it or other options", () => {
    expect(frontendBuildNodeOptions("--max-old-space-size=4096 --trace-warnings")).toBe(
      `--max-old-space-size=4096 --trace-warnings --max-old-space-size=${frontendBuildHeapMiB}`,
    );
  });
});

describe("frontend Vite build arguments", () => {
  test("rejects arguments that could silently change the canonical build", () => {
    expect(() => parseFrontendBuildArguments(["--mode=development"])).toThrow(
      "Unsupported frontend build arguments",
    );
  });
});

describe("frontend worker output", () => {
  test("rejects rune calls that escaped Svelte compilation", async () => {
    const directory = await mkdtemp(path.join(os.tmpdir(), "openpost-worker-runes-"));
    try {
      await writeFile(path.join(directory, "broken.js"), "const state = $state({ ready: true });");

      await mkdir(path.join(directory, "chunks"));
      await writeFile(path.join(directory, "chunks/nested.js"), "const value = $derived(ready);");
      const failure = await validateCompiledWorkerRunes(directory).catch((error) => error);
      expect(failure).toBeInstanceOf(Error);
      const prefix = "Uncompiled Svelte rune calls in worker output: ";
      expect(failure.message).toStartWith(prefix);
      expect(failure.message.slice(prefix.length).split(", ").sort()).toEqual([
        "broken.js",
        "chunks/nested.js",
      ]);
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  });

  test("accepts compiled Svelte runtime markers in nested worker chunks", async () => {
    const directory = await mkdtemp(path.join(os.tmpdir(), "openpost-worker-runes-"));
    try {
      const chunks = path.join(directory, "chunks");
      await mkdir(chunks);
      await writeFile(path.join(chunks, "compiled.js"), "const marker = Symbol('$state');");

      await expect(validateCompiledWorkerRunes(directory)).resolves.toBeUndefined();
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  });
});
