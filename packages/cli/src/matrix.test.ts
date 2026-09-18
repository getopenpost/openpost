import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { assetTarget } from "./platform";

// The wrapper's platform matrix must stay identical to the release
// workflow's build-cli matrix: every supported download needs a built
// binary, and every built binary needs checksum sidecars the wrapper parses.
function buildCliMatrix(): Array<{ os: string; arch: string }> {
  const workflow = readFileSync(
    new URL("../../../.github/workflows/release.yml", import.meta.url),
    "utf8",
  );
  const buildCli = workflow.split("\n  build-cli:")[1]?.split("\n  build-android:")[0];
  if (!buildCli) throw new Error("build-cli job not found in release.yml");
  const pairs: Array<{ os: string; arch: string }> = [];
  for (const match of buildCli.matchAll(/\{\s*os:\s*(\w+),\s*arch:\s*(\w+)/g)) {
    pairs.push({ os: match[1] as string, arch: match[2] as string });
  }
  return pairs;
}

describe("release matrix contract", () => {
  it("covers exactly the wrapper's supported targets", () => {
    const matrix = buildCliMatrix()
      .map(({ os, arch }) => `${os}-${arch}`)
      .sort();
    const supported: Array<[NodeJS.Platform, NodeJS.Architecture]> = [
      ["linux", "x64"],
      ["linux", "arm64"],
      ["darwin", "arm64"],
      ["win32", "x64"],
    ];
    const wrapped = supported
      .map(([platform, arch]) => {
        const target = assetTarget(platform, arch);
        return `${target.os}-${target.arch}`;
      })
      .sort();
    expect(matrix).toEqual(wrapped);
  });
});
