import { execFileSync } from "node:child_process";
import { readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { prepareReleaseChangelog } from "../packages/changelog/src/index.js";

const tag = process.argv[2];
const releaseDate = process.argv[3] || new Date().toISOString().slice(0, 10);
if (!tag) {
  process.stderr.write("usage: bun scripts/prepare-release-changelog.mjs <tag> [YYYY-MM-DD]\n");
  process.exit(1);
}

// Merge fragments from changes/ into CHANGELOG.md before preparing the release.
const mergeScriptPath = fileURLToPath(new URL("./merge-changelog-fragments.mjs", import.meta.url));
execFileSync("bun", [mergeScriptPath], { stdio: "inherit" });

const changelogPath = resolve("CHANGELOG.md");
const current = readFileSync(changelogPath, "utf8");
const prepared = prepareReleaseChangelog(current, tag, releaseDate);
writeFileSync(changelogPath, prepared);
process.stdout.write(`changelog: prepared ${tag} for ${releaseDate}\n`);
