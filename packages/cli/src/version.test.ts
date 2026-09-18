import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { CLI_WRAPPER_VERSION } from "./version";

describe("CLI wrapper version", () => {
  it("matches the published package version", () => {
    const manifest = JSON.parse(
      readFileSync(new URL("../package.json", import.meta.url), "utf8"),
    ) as { version: string };
    expect(CLI_WRAPPER_VERSION).toBe(manifest.version);
  });
});
