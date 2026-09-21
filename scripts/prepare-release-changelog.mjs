import { execFileSync } from "node:child_process";
import { readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { prepareReleaseChangelog } from "../packages/changelog/src/index.js";
import { publishedStableReleaseTag } from "./published-release-tag.mjs";

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
// Sections newer than the latest published GitHub release never shipped:
// their candidate pipeline failed before the draft could be published and
// announced. Carry those entries into this release so the announcement for
// the release that finally succeeds includes them.
// The lookup needs `gh` and network access, which release preparation
// guarantees (it already queries published releases for mobile identity).
// Standalone and offline runs fall back to the legacy behavior instead of
// failing the preparation.
let publishedTag;
try {
  publishedTag = publishedStableReleaseTag({ excludeTag: tag });
} catch (error) {
  process.stderr.write(
    `changelog: could not determine the latest published release (${error.message}); continuing without carry-forward\n`,
  );
}
const prepared = prepareReleaseChangelog(current, tag, releaseDate, { publishedTag });
writeFileSync(changelogPath, prepared);
process.stdout.write(`changelog: prepared ${tag} for ${releaseDate}\n`);
