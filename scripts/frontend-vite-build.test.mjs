import { spawnSync } from "node:child_process";
import { describe, expect, test } from "bun:test";

import {
  frontendBuildHeapMiB,
  frontendBuildNodeOptions,
  parseFrontendBuildArguments,
} from "./frontend-vite-build.mjs";

describe("frontend Vite build memory", () => {
  test("adds the repository build heap when NODE_OPTIONS is empty", () => {
    expect(frontendBuildNodeOptions()).toBe(
      `--max-old-space-size=${frontendBuildHeapMiB}`,
    );
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
    expect(
      frontendBuildNodeOptions("--max-old-space-size=4096 --trace-warnings"),
    ).toBe(
      `--max-old-space-size=4096 --trace-warnings --max-old-space-size=${frontendBuildHeapMiB}`,
    );
  });

  test("uses the last user heap option when enforcing the minimum", () => {
    expect(
      frontendBuildNodeOptions(
        "--max-old-space-size=12288 --max-old-space-size=4096",
      ),
    ).toEndWith(`--max-old-space-size=${frontendBuildHeapMiB}`);
  });

  test("the merged options give Node at least the repository heap", () => {
    const result = spawnSync(
      "node",
      [
        "-e",
        'process.stdout.write(String(require("node:v8").getHeapStatistics().heap_size_limit))',
      ],
      {
        encoding: "utf8",
        env: {
          ...process.env,
          NODE_OPTIONS: frontendBuildNodeOptions("--max-old-space-size=4096"),
        },
      },
    );

    expect(result.status).toBe(0);
    expect(Number(result.stdout)).toBeGreaterThanOrEqual(
      frontendBuildHeapMiB * 1024 * 1024,
    );
  });
});

describe("frontend Vite build arguments", () => {
  test("uses the web application mode by default", () => {
    expect(parseFrontendBuildArguments([])).toEqual({});
  });

  test("accepts the Capacitor application mode", () => {
    expect(parseFrontendBuildArguments(["--app-mode=capacitor"])).toEqual({
      appMode: "capacitor",
    });
  });

  test("rejects arguments that could silently change the canonical build", () => {
    expect(() => parseFrontendBuildArguments(["--mode=development"])).toThrow(
      "Unsupported frontend build arguments",
    );
  });
});
