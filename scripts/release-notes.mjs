import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import { releaseNotesForTag } from "../packages/changelog/src/index.js";

const tag = process.argv[2];
if (!tag) {
  process.stderr.write("usage: bun scripts/release-notes.mjs <tag>\n");
  process.exit(1);
}

process.stdout.write(
  `${releaseNotesForTag(readFileSync(resolve("CHANGELOG.md"), "utf8"), tag)}\n`,
);
