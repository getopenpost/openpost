import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const env = {
  ...process.env,
  GOCACHE:
    process.env.GOCACHE || path.join(root, ".devenv", "state", "go-build"),
};

// Only compare generated files that are committed. The docs copies are ignored
// build artifacts, so they are expected to be absent in a clean checkout.
const generatedPaths = [
  "frontend/openapi.json",
  "frontend/src/lib/api/types.d.ts",
  "docs-site/reference/cli.md",
];
const before = await generatedHashes();

run("bun", ["scripts/sync-docs-openapi.mjs"]);
run("bun", ["run", "--filter", "@openpost/web", "generate:types"]);
const after = await generatedHashes();
const changed = generatedPaths.filter(
  (file) => before.get(file) !== after.get(file),
);
if (changed.length > 0) {
  console.error(`Generated contracts were stale: ${changed.join(", ")}`);
  run("git", ["diff", "--exit-code", "--", ...changed]);
  process.exit(1);
}

console.log("Generated API, TypeScript, docs, and CLI contracts are current.");

async function generatedHashes() {
  const entries = await Promise.all(
    generatedPaths.map(async (file) => {
      try {
        const contents = await readFile(path.join(root, file));
        return [file, createHash("sha256").update(contents).digest("hex")];
      } catch (error) {
        if (error?.code === "ENOENT") return [file, null];
        throw error;
      }
    }),
  );
  return new Map(entries);
}

function run(command, args) {
  const result = spawnSync(command, args, { cwd: root, env, stdio: "inherit" });
  if (result.status !== 0) {
    process.exit(result.status ?? 1);
  }
}
