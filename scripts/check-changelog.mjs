import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import { validateChangelog } from "../packages/changelog/src/index.js";

const changelogPath = resolve("CHANGELOG.md");
const errors = validateChangelog(readFileSync(changelogPath, "utf8"));

if (errors.length > 0) {
  process.stderr.write("changelog: consistency check failed\n");
  for (const error of errors) process.stderr.write(`- ${error}\n`);
  process.exitCode = 1;
} else {
  process.stdout.write(
    "changelog: CHANGELOG.md is the valid canonical release record\n",
  );
}
