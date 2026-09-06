import { copyFile, mkdir } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const source = path.join(root, "apps/web", "openapi.json");
const targets = [
  path.join(root, "apps/docs", ".generated", "openapi.json"),
  path.join(root, "apps/docs", "public", "openapi.json"),
];

for (const target of targets) {
  await mkdir(path.dirname(target), { recursive: true });
  await copyFile(source, target);
  console.log(`Synced OpenAPI spec -> ${path.relative(root, target)}`);
}
