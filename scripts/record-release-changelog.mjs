#!/usr/bin/env bun

import { execFileSync } from "node:child_process";
import { existsSync, readFileSync, unlinkSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";

import { prepareReleaseChangelog, validateChangelog } from "../packages/changelog/src/index.js";
import { publishedStableReleaseTag } from "./published-release-tag.mjs";
import {
  changelogFragmentEntries,
  mergeFragmentGroupsIntoChangelog,
  parseChangelogFragment,
} from "./changelog-fragments.mjs";

const stableVersionPattern = /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/u;
const tag = String(process.argv[2] ?? "").trim();
const recordDate = process.argv[3] || new Date().toISOString().slice(0, 10);
const normalized = tag.replace(/^v/u, "");

function fail(message) {
  process.stderr.write(`record-release-changelog: ${message}\n`);
  process.exit(1);
}

if (!stableVersionPattern.test(normalized)) {
  fail(`expected a stable release tag, received ${JSON.stringify(process.argv[2])}`);
}
if (!/^\d{4}-\d{2}-\d{2}$/u.test(recordDate)) {
  fail(`expected a record date in YYYY-MM-DD form, received ${JSON.stringify(recordDate)}`);
}

function git(args) {
  try {
    return execFileSync("git", args, { encoding: "utf8" });
  } catch (error) {
    fail(`git ${args.join(" ")} failed (${String(error.message).split("\n")[0]})`);
  }
}

// The tag pins exactly which fragments belong to this release. Fragments
// added to main after the tag stay in changes/ and [Unreleased]; only the
// fragments present at the tag move into the dated section.
const tagRevision = git(["rev-parse", "--verify", `refs/tags/${tag}`]).trim();
if (!tagRevision) fail(`unknown tag ${JSON.stringify(tag)}`);

const tagTree = git(["ls-tree", "-r", "--name-only", tag, "--", "changes"])
  .split("\n")
  .map((line) => line.trim())
  .filter((name) => name !== "changes/README.md" && /^changes\/.+\.md$/u.test(name))
  .map((name) => name.slice("changes/".length))
  .sort();

const byGroup = new Map();
for (const entry of tagTree) {
  const content = git(["show", `${tag}:changes/${entry}`]);
  let groups;
  try {
    groups = parseChangelogFragment(entry, content);
  } catch (error) {
    fail(error.message);
  }
  for (const [group, items] of groups) {
    const merged = byGroup.get(group) ?? [];
    merged.push(...items);
    byGroup.set(group, merged);
  }
}

const tagChangelog = git(["show", `${tag}:CHANGELOG.md`]);

const merged = mergeFragmentGroupsIntoChangelog(tagChangelog, byGroup);
let publishedTag = "";
try {
  publishedTag = publishedStableReleaseTag({ excludeTag: tag });
} catch (error) {
  process.stderr.write(
    `record-release-changelog: continuing without carry-forward (${error.message})\n`,
  );
}

let prepared;
try {
  prepared = prepareReleaseChangelog(merged, tag, recordDate, { publishedTag });
} catch (error) {
  fail(error.message);
}

// Extract the raw dated section body so the recorded CHANGELOG carries the
// same items the published release notes were built from.
const header = `## [${normalized}] - ${recordDate}`;
const preparedLines = prepared.split("\n");
const headerIndex = preparedLines.findIndex((line) => line.trim() === header);
if (headerIndex < 0) fail(`prepared changelog has no ${header} section`);
let sectionEnd = preparedLines.length;
for (let index = headerIndex + 1; index < preparedLines.length; index += 1) {
  if (/^## \[/u.test(preparedLines[index].trim())) {
    sectionEnd = index;
    break;
  }
}
const body = preparedLines
  .slice(headerIndex + 1, sectionEnd)
  .join("\n")
  .trim();
if (!body) fail(`prepared changelog section [${normalized}] has no entries`);

const changelogPath = resolve("CHANGELOG.md");
const current = readFileSync(changelogPath, "utf8");
if (new RegExp(`^## \\[${normalized}\\](?: - .+)?$`, "mu").test(current)) {
  // Idempotent reruns (for example after a rebase) keep the recorded
  // section and sweep any consumed fragments left behind.
  let swept = 0;
  for (const entry of tagTree) {
    const file = resolve("changes", entry);
    if (existsSync(file)) {
      unlinkSync(file);
      swept += 1;
    }
  }
  process.stdout.write(`changelog: ${tag} is already recorded; swept ${swept} fragment(s)\n`);
  process.exit(0);
}

const marker = "## [Unreleased]";
const markerIndex = current.indexOf(marker);
if (markerIndex < 0) fail("CHANGELOG.md is missing [Unreleased]");
const bodyStart = markerIndex + marker.length;
const nextOffset = current.slice(bodyStart).search(/\n## \[/u);
const insertAt = nextOffset < 0 ? current.length : bodyStart + nextOffset;
const unreleasedBody = current.slice(bodyStart, insertAt).trim();
const rest = current.slice(insertAt).replace(/^\n+/u, "").trimEnd();

let result = `${current.slice(0, bodyStart)}\n\n`;
if (unreleasedBody) result += `${unreleasedBody}\n\n`;
result += `## [${normalized}] - ${recordDate}\n\n${body}\n`;
if (rest) result += `\n${rest}\n`;

const errors = validateChangelog(result);
const remaining = changelogFragmentEntries(resolve("changes")).filter(
  (entry) => !tagTree.includes(entry),
);
for (const entry of remaining) {
  try {
    parseChangelogFragment(entry, readFileSync(resolve("changes", entry), "utf8"));
  } catch (error) {
    errors.push(error.message);
  }
}
if (errors.length > 0) {
  fail(`recorded changelog is invalid: ${errors.join("; ")}`);
}

writeFileSync(changelogPath, result);
let removed = 0;
for (const entry of tagTree) {
  const file = resolve("changes", entry);
  if (existsSync(file)) {
    unlinkSync(file);
    removed += 1;
  }
}
process.stdout.write(
  `changelog: recorded ${tag} at ${tagRevision.slice(0, 12)} for ${recordDate} (${removed}/${tagTree.length} fragment(s) consumed)\n`,
);
