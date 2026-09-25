import { createHash } from "node:crypto";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { assetName, assetTarget } from "./platform";
import {
  defaultReleaseTag,
  downloadUrl,
  explicitBinaryPath,
  parseChecksum,
  releaseTag,
  resolveBinaryPath,
} from "./resolve";

const BINARY = new Uint8Array([7, 7, 7]);
const BINARY_HEX = createHash("sha256").update(BINARY).digest("hex");

function mockFetch(routes: Record<string, Response>): typeof fetch {
  return vi.fn(async (url: string | URL | Request) => {
    const response = routes[String(url)];
    if (!response) return new Response("not found", { status: 404 });
    return response;
  }) as unknown as typeof fetch;
}

describe("resolve", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it("pins a release tag in package.json", () => {
    expect(defaultReleaseTag()).toMatch(/^v\d+\.\d+\.\d+$/);
  });

  it("prefers the OPENPOST_CLI_TAG override", () => {
    vi.stubEnv("OPENPOST_CLI_TAG", "v9.9.9");
    expect(releaseTag()).toBe("v9.9.9");
  });

  it("returns explicit binary paths without touching the network", async () => {
    vi.stubEnv("OPENPOST_CLI_BIN", "/usr/local/bin/openpost");
    expect(explicitBinaryPath("openpost-cli")).toBe("/usr/local/bin/openpost");
    const fetch = vi.fn();
    expect(await resolveBinaryPath({ fetch: fetch as unknown as typeof fetch })).toBe(
      "/usr/local/bin/openpost",
    );
    expect(fetch).not.toHaveBeenCalled();
  });

  it("downloads and verifies the release binary into the cache dir", async () => {
    const dir = mkdtempSync(path.join(tmpdir(), "openpost-cli-test-"));
    try {
      const tag = "v0.0.9";
      const asset = assetName("openpost-cli", assetTarget());
      const fetch = mockFetch({
        [downloadUrl(tag, asset)]: new Response(BINARY, { status: 200 }),
        [downloadUrl(tag, `${asset}.sha256`)]: new Response(`${BINARY_HEX}  ${asset}\n`, {
          status: 200,
        }),
      });
      const resolved = await resolveBinaryPath({
        binary: "openpost-cli",
        releaseTag: tag,
        cacheDir: dir,
        fetch,
      });
      expect(resolved).toBe(path.join(dir, tag, asset));
      // A cached binary short-circuits the network entirely.
      const cached = await resolveBinaryPath({
        binary: "openpost-cli",
        releaseTag: tag,
        cacheDir: dir,
        fetch: mockFetch({}),
      });
      expect(cached).toBe(resolved);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("fails closed on a checksum mismatch", async () => {
    const dir = mkdtempSync(path.join(tmpdir(), "openpost-cli-test-"));
    try {
      const tag = "v0.0.9";
      const asset = assetName("openpost-cli", assetTarget());
      const fetch = mockFetch({
        [downloadUrl(tag, asset)]: new Response(BINARY, { status: 200 }),
        [downloadUrl(tag, `${asset}.sha256`)]: new Response(`${"0".repeat(64)}  ${asset}\n`, {
          status: 200,
        }),
      });
      await expect(
        resolveBinaryPath({ binary: "openpost-cli", releaseTag: tag, cacheDir: dir, fetch }),
      ).rejects.toThrow(/Checksum mismatch/);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("fails closed when the release predates checksum assets", async () => {
    const dir = mkdtempSync(path.join(tmpdir(), "openpost-cli-test-"));
    try {
      const tag = "v0.0.9";
      const asset = assetName("openpost-cli", assetTarget());
      const fetch = mockFetch({
        [downloadUrl(tag, asset)]: new Response(BINARY, { status: 200 }),
      });
      await expect(
        resolveBinaryPath({ binary: "openpost-cli", releaseTag: tag, cacheDir: dir, fetch }),
      ).rejects.toThrow(/Checksum verification is required/);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("parses sha256sum output bound to the asset name", () => {
    const asset = assetName("openpost-cli", assetTarget());
    expect(parseChecksum(`${BINARY_HEX}  ${asset}\n`, asset)).toBe(BINARY_HEX);
    expect(() => parseChecksum("not a checksum\n", asset)).toThrow(/SHA-256/);
    expect(() => parseChecksum(`${BINARY_HEX}  some-other-binary\n`, asset)).toThrow(/SHA-256/);
  });

  it("rejects release tags outside the release shape", async () => {
    const dir = mkdtempSync(path.join(tmpdir(), "openpost-cli-test-"));
    try {
      await expect(
        resolveBinaryPath({ binary: "openpost-cli", releaseTag: "latest", cacheDir: dir }),
      ).rejects.toThrow(/expected a release tag/);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("replaces a tampered cached binary instead of executing it", async () => {
    const dir = mkdtempSync(path.join(tmpdir(), "openpost-cli-test-"));
    const { writeFileSync } = await import("node:fs");
    try {
      const tag = "v0.0.9";
      const asset = assetName("openpost-cli", assetTarget());
      const cached = path.join(dir, tag, asset);
      const { mkdirSync } = await import("node:fs");
      mkdirSync(path.dirname(cached), { recursive: true });
      writeFileSync(cached, new Uint8Array([9, 9, 9]));
      const fetch = mockFetch({
        [downloadUrl(tag, asset)]: new Response(BINARY, { status: 200 }),
        [downloadUrl(tag, `${asset}.sha256`)]: new Response(`${BINARY_HEX}  ${asset}\n`, {
          status: 200,
        }),
      });
      const resolved = await resolveBinaryPath({
        binary: "openpost-cli",
        releaseTag: tag,
        cacheDir: dir,
        fetch,
      });
      expect(resolved).toBe(cached);
      expect(fetch).toHaveBeenCalledTimes(2);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("refuses oversized downloads", async () => {
    const dir = mkdtempSync(path.join(tmpdir(), "openpost-cli-test-"));
    try {
      const tag = "v0.0.9";
      const asset = assetName("openpost-cli", assetTarget());
      const fetch = mockFetch({
        [downloadUrl(tag, asset)]: new Response(BINARY, {
          status: 200,
          headers: { "content-length": String(1024 * 1024 * 1024) },
        }),
      });
      await expect(
        resolveBinaryPath({ binary: "openpost-cli", releaseTag: tag, cacheDir: dir, fetch }),
      ).rejects.toThrow(/exceeds/);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
