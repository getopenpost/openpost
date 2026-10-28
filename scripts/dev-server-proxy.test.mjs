import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, test } from "bun:test";

const repositoryRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const viteConfigPath = path.join(repositoryRoot, "apps/web/vite.config.ts");

// The dev proxy block is a plain object literal, so extract its entries without
// importing the config (which would pull in SvelteKit, Tailwind and Paraglide).
function readProxyEntries(source) {
  const entries = new Map();
  const pattern = /(['"])(\^?\/[^'"]+)\1\s*:\s*\{\s*target:\s*(['"])([^'"]+)\3/gsu;
  for (const match of source.matchAll(pattern)) {
    entries.set(match[2], match[4]);
  }
  return entries;
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

async function loadProxyEntries() {
  return readProxyEntries(await readFile(viteConfigPath, "utf8"));
}

describe("web dev-server proxy", () => {
  test("forwards avatar paths to the Go backend like media paths", async () => {
    const entries = await loadProxyEntries();
    expect(isProxied(entries, "/avatars/abc123")).toBe(true);
    expect(entries.get("^/avatars/[^/]+")).toBe("http://localhost:8080");
  });

  test("keeps the existing api and media forwarding", async () => {
    const entries = await loadProxyEntries();
    expect(isProxied(entries, "/api/v1/accounts")).toBe(true);
    expect(isProxied(entries, "/media/abc123")).toBe(true);
    expect(entries.get("/api")).toBe("http://localhost:8080");
    expect(entries.get("^/media/[^/]+")).toBe("http://localhost:8080");
  });

  test("does not forward arbitrary or bare paths", async () => {
    const entries = await loadProxyEntries();
    for (const url of ["/avatars", "/avatars/", "/", "/_app/immutable/chunk.js", "/other"]) {
      expect(isProxied(entries, url)).toBe(false);
    }
  });
});
