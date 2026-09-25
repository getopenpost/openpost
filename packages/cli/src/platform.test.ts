import { describe, expect, it } from "vitest";
import { assetTarget } from "./platform";

describe("assetTarget", () => {
  it("maps the release matrix to asset triples", () => {
    expect(assetTarget("linux", "x64")).toEqual({ os: "linux", arch: "amd64", extension: "" });
    expect(assetTarget("linux", "arm64")).toEqual({ os: "linux", arch: "arm64", extension: "" });
    expect(assetTarget("darwin", "arm64")).toEqual({ os: "darwin", arch: "arm64", extension: "" });
    expect(assetTarget("win32", "x64")).toEqual({
      os: "windows",
      arch: "amd64",
      extension: ".exe",
    });
  });

  it("rejects targets outside the release matrix", () => {
    expect(() => assetTarget("darwin", "x64")).toThrow(/no prebuilt binary/);
    expect(() => assetTarget("win32", "arm64")).toThrow(/no prebuilt binary/);
  });
});
