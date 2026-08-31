import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import { validateChangelog } from "../packages/changelog/src/index.js";
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

if (errors.length > 0) {
  process.stderr.write("changelog: consistency check failed\n");
  for (const error of errors) process.stderr.write(`- ${error}\n`);
  process.exitCode = 1;
} else {
  process.stdout.write("changelog: release record and fragments are valid\n");
}
