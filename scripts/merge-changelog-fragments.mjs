import { readFileSync, unlinkSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";

import { changelogFragmentEntries, parseChangelogFragment } from "./changelog-fragments.mjs";

const changesDir = resolve("changes");
const changelogPath = resolve("CHANGELOG.md");

const entries = changelogFragmentEntries(changesDir);
if (entries.length === 0) {
  process.stdout.write("changelog: no fragments to merge\n");
  process.exit(0);
}

const parsedFragments = entries.map((entry) => [
  entry,
  parseChangelogFragment(entry, readFileSync(resolve(changesDir, entry), "utf8")),
]);
const byGroup = new Map();
for (const [, groups] of parsedFragments) {
  for (const [group, fragmentItems] of groups) {
    const items = byGroup.get(group) ?? [];
    items.push(...fragmentItems);
    byGroup.set(group, items);
  }
}

const changelog = readFileSync(changelogPath, "utf8");
const marker = "## [Unreleased]";
const markerIndex = changelog.indexOf(marker);
if (markerIndex < 0) {
  process.stderr.write("changelog: CHANGELOG.md is missing [Unreleased]\n");
  process.exit(1);
}

const bodyStart = markerIndex + marker.length;
const nextSection = changelog.slice(bodyStart).search(/\n## \[/u);
const bodyEnd = nextSection < 0 ? changelog.length : bodyStart + nextSection;
const unreleased = changelog.slice(bodyStart, bodyEnd);

const groupHeaderPattern = /^### (.+)$/gmu;
const existingGroups = new Map();
let match;
while ((match = groupHeaderPattern.exec(unreleased)) !== null) {
  existingGroups.set(match[1], match.index + bodyStart);
}

const insertionPoints = [];
for (const [group, items] of byGroup) {
  const existing = existingGroups.get(group);
  if (existing !== undefined) {
    insertionPoints.push({ offset: existing, group, items });
  } else {
    insertionPoints.push({ offset: bodyEnd, group, items });
  }
}

insertionPoints.sort((a, b) => b.offset - a.offset);

let result = changelog;
const newGroups = [];
for (const { offset, group, items } of insertionPoints) {
  if (!existingGroups.has(group)) {
    newGroups.push({ offset, group, items });
    continue;
  }
  const block = items.map((item) => `- ${item}`).join("\n") + "\n";
  const lineEnd = result.indexOf("\n", offset);
  const contentStart = lineEnd < 0 ? result.length : lineEnd + 1;
  const hasBlankLine = result.startsWith("\n", contentStart);
  const insertAt = hasBlankLine ? contentStart + 1 : contentStart;
  result = result.slice(0, insertAt) + (hasBlankLine ? "" : "\n") + block + result.slice(insertAt);
}

if (newGroups.length > 0) {
  newGroups.sort((a, b) => a.offset - b.offset);
  const newBlock =
    "\n" +
    newGroups
      .map(({ group, items }) => `### ${group}\n\n${items.map((item) => `- ${item}`).join("\n")}`)
      .join("\n\n") +
    "\n";
  result = result.slice(0, bodyEnd) + newBlock + result.slice(bodyEnd);
}

writeFileSync(changelogPath, result);
for (const entry of entries) unlinkSync(resolve(changesDir, entry));
process.stdout.write(`changelog: merged ${entries.length} fragment(s)\n`);
