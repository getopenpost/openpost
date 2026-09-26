import { createRequire } from "node:module";
import { dirname, join } from "node:path";
import { normalizePath } from "vite";
import { viteStaticCopy } from "vite-plugin-static-copy";

const require = createRequire(import.meta.url);
const manifestPath = require.resolve("pdfjs-dist/package.json");
const { version } = require(manifestPath) as { version: string };
const root = dirname(manifestPath);

// PDF.js appends resource filenames itself, so preserve them instead of hashing
// individual files. The versioned directory keeps deployments cache-safe.
export function pdfPreviewAssets() {
  return viteStaticCopy({
    targets: [
      ...["cmaps", "standard_fonts", "wasm"].map((directory) => ({
        src: normalizePath(join(root, directory, "*")),
        dest: `pdfjs/${version}/${directory}`,
        rename: { stripBase: true as const },
      })),
      {
        src: normalizePath(join(root, "LICENSE")),
        dest: `pdfjs/${version}`,
        rename: { stripBase: true },
      },
    ],
  });
}
