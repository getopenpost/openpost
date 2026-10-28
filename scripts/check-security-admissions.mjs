import { createHash } from "node:crypto";
import { readFileSync, readdirSync } from "node:fs";
import path from "node:path";

// GHSA-mrhx-c7xc-m3w5: Zod 4 is patched. The remaining Zod 3 copies
// serve IMG.LY's bounded local configuration and n8n's development toolchain.
// Pin the entire reviewed dependency graph, including workspace dependency
// scopes and parent versions. Any dependency edit requires re-review until
// those legacy consumers adopt patched versions and this admission is removed.
// Pin the editor configuration boundary too, and reject n8n imports outside
// its own package. The published n8n node has no runtime dependencies.
// GHSA-pfhg-q3qv-9q6r and GHSA-27mw-82g8-phjj: the static SvelteKit
// consumers do not use enhanced form actions or prerender setHeaders. Inspect
// all first-party app/package modules, including imported module extensions.
// GHSA-gcqx-w48m-w2h4 has no patched deepmerge release. Its current parents
// are Svelte/Vite/Workbox configuration and n8n development tooling. The locked
// graph pins those consumers; reject first-party imports so it cannot become
// a runtime helper without re-review. The Go image carries no Node packages.
const reviewedArtifacts = {
  // Re-reviewed after the qs 6.16.1 patch: all other package versions and scopes
  // are unchanged. deepmerge remains confined to the reviewed development graph.
  "bun.lock": "38923e9892899f7d3fe1ec623a1d6a4999b3929cd3c974f8e7d6b4f3f4f5911d",
  "apps/web/src/lib/image-editor/background-removal.worker.ts":
    "06f3aaf6c78d574c1d2538903e8bf34cf70032801824d8988a9ba2d2435749d5",
};
const generatedDirectories = new Set([
  "node_modules",
  "dist",
  "build",
  "out",
  ".git",
  ".turbo",
  ".svelte-kit",
  ".expo",
]);

function inspectSources(directory) {
  for (const entry of readdirSync(directory, { withFileTypes: true })) {
    const sourcePath = path.join(directory, entry.name);
    if (entry.isDirectory()) {
      if (!generatedDirectories.has(entry.name)) inspectSources(sourcePath);
      continue;
    }
    if (!entry.isFile() || !/\.(?:[cm]?[jt]s|svelte)$/.test(entry.name)) continue;
    const source = readFileSync(sourcePath, "utf8");
    if (/\$app\/forms|\bsetHeaders\b|use:enhance\b/.test(source)) {
      throw new Error(`Re-review SvelteKit advisory admissions: ${sourcePath}`);
    }
    if (/(?:from\s*|import\s*\(|require\s*\()\s*["']deepmerge(?:["'/])/.test(source)) {
      throw new Error(`Re-review deepmerge development-only admission: ${sourcePath}`);
    }
    if (
      !sourcePath.startsWith(`packages${path.sep}n8n-nodes-openpost${path.sep}`) &&
      /(?:from\s*|import\s*\(|require\s*\()\s*["'](?:@n8n\/|n8n-workflow(?:["'/]))/.test(source)
    ) {
      throw new Error(`Re-review n8n development-only admission: ${sourcePath}`);
    }
  }
}

try {
  for (const [file, expected] of Object.entries(reviewedArtifacts)) {
    const actual = createHash("sha256").update(readFileSync(file)).digest("hex");
    if (actual !== expected) throw new Error(`Re-review legacy Zod admission: ${file}`);
  }
  for (const directory of ["apps/web", "apps/marketing", "packages"]) inspectSources(directory);
  console.log("Verified reviewed dependency graph, editor boundary and unused SvelteKit APIs");
} catch (error) {
  process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
  process.exitCode = 1;
}
