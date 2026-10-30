import { readFileSync, readdirSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const testDirectory = fileURLToPath(new URL("../tests/app/", import.meta.url));

// Timings influence assignment only. The current filesystem owns the inventory,
// so new tests always run and deleted tests never return through stale weights.
export function balanceAppFiles(files, durations, count) {
  if (!Number.isInteger(count) || count < 1 || count > files.length)
    throw new Error("Invalid application shard count");
  if (new Set(files).size !== files.length) throw new Error("duplicate application test file");
  const measured = files.map((file) => durations[file]).filter((value) => value !== undefined);
  if (measured.some((value) => !Number.isFinite(value) || value < 0))
    throw new Error("Invalid application test duration");
  measured.sort((a, b) => a - b);
  const middle = Math.floor(measured.length / 2);
  const fallback = measured.length
    ? (measured[middle] + measured[Math.ceil(measured.length / 2) - 1]) / 2
    : 1;
  const weight = (file) => Math.max(1, durations[file] ?? fallback);
  const buckets = Array.from({ length: count }, () => ({ files: [], duration: 0 }));
  for (const file of [...files].sort(
    (a, b) => weight(b) - weight(a) || (a < b ? -1 : a > b ? 1 : 0),
  )) {
    const bucket = buckets.reduce((a, b) => (a.duration <= b.duration ? a : b));
    bucket.files.push(file);
    bucket.duration += weight(file);
  }
  return buckets.map((bucket) => bucket.files.sort());
}

export function appShardFiles(shard) {
  if (!/^[1-9]\d*\/[1-9]\d*$/.test(shard)) throw new Error("Invalid application shard");
  const [index, count] = shard.split("/").map(Number);
  if (index > count) throw new Error("Invalid application shard index");
  const files = readdirSync(testDirectory, { recursive: true })
    .map((file) => file.split(path.sep).join("/"))
    .filter((file) => file.endsWith(".spec.ts") && file !== "tool-draft-handoff.spec.ts");
  const { durationsMs } = JSON.parse(
    readFileSync(new URL("./app-e2e-durations.json", import.meta.url), "utf8"),
  );
  return balanceAppFiles(files, durationsMs, count)[index - 1];
}
