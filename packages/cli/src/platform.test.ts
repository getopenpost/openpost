import { describe, expect, it } from "vitest";
import { assetName, assetTarget, checksumName } from "./platform";

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

  it("builds asset and checksum names", () => {
    const target = assetTarget("linux", "x64");
    expect(assetName("openpost-cli", target)).toBe("openpost-cli-linux-amd64");
    expect(assetName("openpost-mcp", target)).toBe("openpost-mcp-linux-amd64");
    expect(checksumName("openpost-cli-linux-amd64")).toBe("openpost-cli-linux-amd64.sha256");
    expect(assetName("openpost-cli", assetTarget("win32", "x64"))).toBe(
      "openpost-cli-windows-amd64.exe",
    );
  });
});
