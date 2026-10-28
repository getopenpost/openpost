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
const reviewedArtifacts = {
  // Re-reviewed after GIF/Floating UI additions and workspace version bumps;
  // legacy Zod consumers, their dependency scopes and the editor boundary are unchanged.
  "bun.lock": "564377ec6aef7bcd0c8f59f784653972d367ca6dc90a3259fa5bd3b54f47342d",
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
