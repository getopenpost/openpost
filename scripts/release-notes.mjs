import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import { prepareReleaseChangelog, releaseNotesForTag } from "../packages/changelog/src/index.js";
import { publishedStableReleaseTag } from "./published-release-tag.mjs";
import {
  changelogFragmentEntries,
  mergeFragmentGroupsIntoChangelog,
  parseChangelogFragment,
} from "./changelog-fragments.mjs";

const tag = process.argv[2];
if (!tag) {
  process.stderr.write("usage: bun scripts/release-notes.mjs <tag>\n");
  process.exit(1);
}

// Release notes build from the tagged working tree, never from a prepared
// CHANGELOG section: fragments in changes/ merge into [Unreleased]
// in memory, so tagging needs no changelog commit. The post-publish
// recorder reuses the same merge, which keeps the published notes and the
// recorded CHANGELOG section identical.
const changelogPath = resolve("CHANGELOG.md");
const changesDirectory = resolve("changes");
const current = readFileSync(changelogPath, "utf8");

const byGroup = new Map();
for (const entry of changelogFragmentEntries(changesDirectory)) {
  const groups = parseChangelogFragment(
    entry,
    readFileSync(resolve(changesDirectory, entry), "utf8"),
  );
  for (const [group, items] of groups) {
    const merged = byGroup.get(group) ?? [];
    merged.push(...items);
    byGroup.set(group, merged);
  }
}

const merged = mergeFragmentGroupsIntoChangelog(current, byGroup);
const releaseDate = new Date().toISOString().slice(0, 10);
let publishedTag = "";
try {
  publishedTag = publishedStableReleaseTag({ excludeTag: tag });
} catch (error) {
  process.stderr.write(
    `release-notes: could not determine the latest published release (${error.message}); continuing without carry-forward\n`,
  );
}
const prepared = prepareReleaseChangelog(merged, tag, releaseDate, { publishedTag });
process.stdout.write(`${releaseNotesForTag(prepared, tag)}\n`);
