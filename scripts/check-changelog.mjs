import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import { validateChangelog } from "../packages/changelog/src/index.js";
import {
  changeCommitsMissingFragments,
  commitsInRange,
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
// fix commits; pushes to main only warn, because release notes list such
// commits under "Other changes" instead of blocking the release.
const base = resolveCommit(process.env.OPENPOST_CHANGELOG_BASE);
const head = resolveCommit(process.env.OPENPOST_CHANGELOG_HEAD);
if (base && head) {
  const missing = changeCommitsMissingFragments(commitsInRange(base, head));
  if (missing.length > 0) {
    const report = [
      "feat and fix commits need a changes/<issue>.md fragment (see changes/README.md),",
      "or a `Changelog: none` trailer when users are not affected:",
      ...missing.map((commit) => `  ${commit.hash.slice(0, 12)} ${commit.subject}`),
    ].join("\n");
    if (process.env.OPENPOST_CHANGELOG_ENFORCE === "1") errors.push(report);
    else process.stderr.write(`changelog: warning: ${report}\n`);
  }
}

if (errors.length > 0) {
  process.stderr.write("changelog: consistency check failed\n");
  for (const error of errors) process.stderr.write(`- ${error}\n`);
  process.exitCode = 1;
} else {
  process.stdout.write("changelog: release record and fragments are valid\n");
}
