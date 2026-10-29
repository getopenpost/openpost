import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

// Bun can leave cached registry and file: dependencies unlinked. Check every
// declared build dependency so new imports do not require a second CI list.
export function missingMobileDependencies(directory) {
  const manifest = JSON.parse(readFileSync(path.join(directory, "package.json"), "utf8"));
  return Object.keys({ ...manifest.dependencies, ...manifest.devDependencies }).filter(
    (name) => !existsSync(path.join(directory, "node_modules", name, "package.json")),
  );
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  try {
    const missing = missingMobileDependencies(process.cwd());
    if (missing.length) throw new Error(`Unlinked mobile dependencies: ${missing.join(", ")}`);
  } catch (error) {
    console.error(error.message);
    process.exitCode = 1;
  }
}
