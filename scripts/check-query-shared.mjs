import { readdirSync } from "node:fs";
import { extname, resolve } from "node:path";

export const sourceExtensions = new Set([".svelte", ".ts", ".tsx"]);
export const webQueryAdapterPrefix = "apps/web/src/lib/query/";
export const mobileQueryAdapters = new Set([
  "apps/mobile/src/lib/app-bootstrap.ts",
  "apps/mobile/src/lib/query-api.ts",
]);

export function sourceFiles(directory, options = {}) {
  const extensions = options.extensions ?? sourceExtensions;
  const skipDirectoryNames = options.skipDirectoryNames ?? [];
  const childOptions = { extensions, skipDirectoryNames };
  const files = [];
  for (const entry of readdirSync(directory, { withFileTypes: true })) {
    const path = resolve(directory, entry.name);
    if (entry.isDirectory()) {
      if (entry.name.startsWith(".") || skipDirectoryNames.includes(entry.name)) continue;
      files.push(...sourceFiles(path, childOptions));
      continue;
    }
    if (entry.isFile() && extensions.has(extname(entry.name))) files.push(path);
  }
  return files;
}

export function lineAt(source, index) {
  return source.slice(0, index).split("\n").length;
}

export function isQueryAdapter(repoPath) {
  const isTest = /\.test\.[jt]sx?$/u.test(repoPath);
  return (
    !isTest && (repoPath.startsWith(webQueryAdapterPrefix) || mobileQueryAdapters.has(repoPath))
  );
}
