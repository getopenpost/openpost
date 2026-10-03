#!/usr/bin/env bun
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";

const args = process.argv.slice(2);
const rootIndex = args.indexOf("--root");
const scope = rootIndex < 0 ? "root" : path.basename(args[rootIndex + 1]);
const artifact = path.resolve("test-results/fallow", `${scope}.json`);
const child = Bun.spawn(["bunx", "fallow", ...args, "--format", "json", "--quiet"], {
  stdout: "pipe",
  stderr: "inherit",
});
const [output, code] = await Promise.all([new Response(child.stdout).text(), child.exited]);
await mkdir(path.dirname(artifact), { recursive: true });
await writeFile(artifact, output);
console.log(`Full Fallow audit: ${artifact}`);
if (code !== 0 && code !== 1) process.exit(code || 2);
let audit;
try {
  audit = JSON.parse(output);
} catch {
  console.error("Fallow returned invalid JSON.");
  process.exit(2);
}
const attribution = audit.attribution;
if (
  audit.kind !== "audit" ||
  audit.schema_version !== 11 ||
  attribution?.gate !== "new-only" ||
  !Number.isSafeInteger(audit.dead_code?.total_issues) ||
  audit.dead_code.total_issues < 0 ||
  audit.summary?.dead_code_issues !== audit.dead_code.total_issues ||
  !Number.isSafeInteger(attribution.dead_code_introduced) ||
  attribution.dead_code_introduced < 0 ||
  !Number.isSafeInteger(attribution.dead_code_inherited) ||
  attribution.dead_code_inherited < 0
) {
  console.error("Fallow audit schema or new-only attribution is missing or unsupported.");
  process.exit(2);
}
console.log(JSON.stringify({ summary: audit.summary, attribution }, null, 2));
// Health is reported separately. Only Fallow's own introduced dead-code
// attribution determines this gate; inherited debt retains its original status.
process.exit(attribution.dead_code_introduced > 0 ? 1 : 0);
