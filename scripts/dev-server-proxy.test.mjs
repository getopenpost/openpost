import { describe, expect, test } from "bun:test";
import { devProxy } from "../apps/web/dev-proxy.ts";

function proxyEntries(backend) {
  return new Map(Object.entries(devProxy(backend)).map(([key, value]) => [key, value.target]));
}

// Mirror Vite dev-proxy matching: a `^...` key is a RegExp, a plain string key
// is a path prefix. The proxy applies to every method, so GET and HEAD share it.
function matchesProxyKey(key, url) {
  if (key.startsWith("^")) return new RegExp(key).test(url);
  return url.startsWith(key);
}

function isProxied(entries, url) {
  return [...entries.keys()].some((key) => matchesProxyKey(key, url));
}

describe("web dev-server proxy", () => {
  test("forwards avatar paths to the Go backend like media paths", async () => {
    const entries = proxyEntries();
    expect(isProxied(entries, "/avatars/abc123")).toBe(true);
    expect(entries.get("^/avatars/[^/]+")).toBe("http://localhost:8080");
  });

  test("keeps the existing api and media forwarding", async () => {
    const entries = proxyEntries();
    expect(isProxied(entries, "/api/v1/accounts")).toBe(true);
    expect(isProxied(entries, "/media/abc123")).toBe(true);
    expect(entries.get("/api")).toBe("http://localhost:8080");
    expect(entries.get("^/media/[^/]+")).toBe("http://localhost:8080");
  });

  test("does not forward arbitrary or bare paths", async () => {
    const entries = proxyEntries();
    for (const url of ["/avatars", "/avatars/", "/", "/_app/immutable/chunk.js", "/other"]) {
      expect(isProxied(entries, url)).toBe(false);
    }
  });

  test("routes each worktree to its configured backend", () => {
    for (const port of [18080, 18081]) {
      const target = `http://127.0.0.1:${port}`;
      expect([...proxyEntries(target).values()]).toEqual([target, target, target]);
    }
  });
});
