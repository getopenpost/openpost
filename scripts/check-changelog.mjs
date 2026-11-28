import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import { validateChangelog } from "../packages/changelog/src/index.js";
import {
  commitsInRange,
  pullRequestCommitsMissingFragments,
  resolveCommit,
} from "./changelog-coverage.mjs";
import { changelogFragmentEntries, parseChangelogFragment } from "./changelog-fragments.mjs";

const changelogPath = resolve("CHANGELOG.md");
const changesDirectory = resolve("changes");
const errors = validateChangelog(readFileSync(changelogPath, "utf8"));
for (const entry of changelogFragmentEntries(changesDirectory)) {
  try {
    parseChangelogFragment(entry, readFileSync(resolve(changesDirectory, entry), "utf8"));
  } catch (error) {
    errors.push(error.message);
  }
}

// CI passes the changed range. Pull requests must add a fragment for feat and
// fix commits; pushes to main only warn, and `release ship` lists any commit
// that still lacks one before tagging.
const enforce = process.env.OPENPOST_CHANGELOG_ENFORCE === "1";
const base = resolveCommit(process.env.OPENPOST_CHANGELOG_BASE);
const head = resolveCommit(process.env.OPENPOST_CHANGELOG_HEAD);
if (base && head) {
  const missing = pullRequestCommitsMissingFragments(commitsInRange(base, head));
  if (missing.length > 0) {
    const report = [
      "feat and fix commits need a changes/<issue>.md fragment (see changes/README.md),",
      "or a `Changelog: none` trailer when users are not affected:",
      ...missing.map((commit) => `  ${commit.hash.slice(0, 12)} ${commit.subject}`),
    ].join("\n");
    if (enforce) errors.push(report);
    else process.stderr.write(`changelog: warning: ${report}\n`);
  }
} else if (enforce) {
  errors.push("cannot check fragments: OPENPOST_CHANGELOG_BASE..HEAD is not in this checkout");
}

if (errors.length > 0) {
  process.stderr.write("changelog: consistency check failed\n");
  for (const error of errors) process.stderr.write(`- ${error}\n`);
  process.exitCode = 1;
} else {
  process.stdout.write("changelog: release record and fragments are valid\n");
}
