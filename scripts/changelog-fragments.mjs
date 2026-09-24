import { readdirSync } from "node:fs";

const fragmentPattern = /^.+\.md$/u;
const groupPattern = /^### (.+)$/u;
const itemPattern = /^-\s+(.+)$/u;

export function changelogFragmentEntries(changesDirectory) {
  return readdirSync(changesDirectory)
    .filter((name) => name !== "README.md" && fragmentPattern.test(name))
    .sort();
}

export function parseChangelogFragment(entry, content) {
  const groups = new Map();
  let currentGroup = null;
  let currentItems = null;
  let currentGroupItemCount = 0;

  for (const rawLine of content.split(/\r?\n/u)) {
    const line = rawLine.trim();
    if (!line) continue;

    const groupMatch = groupPattern.exec(line);
    if (groupMatch) {
      if (currentGroup !== null && currentGroupItemCount === 0) {
        throw new Error(`changelog fragment ${entry} has an empty ${currentGroup} group`);
      }
      currentGroup = groupMatch[1];
      currentItems = groups.get(currentGroup) ?? [];
      groups.set(currentGroup, currentItems);
      currentGroupItemCount = 0;
      continue;
    }

    const itemMatch = itemPattern.exec(line);
    if (itemMatch && currentItems) {
      currentItems.push(itemMatch[1]);
      currentGroupItemCount += 1;
      continue;
    }

    throw new Error(`changelog fragment ${entry} must contain only ### groups and bullet items`);
  }

  if (currentGroup !== null && currentGroupItemCount === 0) {
    throw new Error(`changelog fragment ${entry} has an empty ${currentGroup} group`);
  }
  if (groups.size === 0) {
    throw new Error(`changelog fragment ${entry} has no grouped items`);
  }
  return groups;
}

// Merge parsed fragment groups into the [Unreleased] section of a changelog
// without touching the filesystem. Fragment items land before pre-existing
// Unreleased items in their group; brand-new groups append after the body.
// Both the release-notes builder and the post-publish recorder use this so
// the published notes and the recorded CHANGELOG section always agree.
export function mergeFragmentGroupsIntoChangelog(changelog, byGroup) {
  const source = String(changelog);
  const marker = "## [Unreleased]";
  const markerIndex = source.indexOf(marker);
  if (markerIndex < 0) {
    throw new Error("CHANGELOG.md is missing [Unreleased]");
  }
  const bodyStart = markerIndex + marker.length;
  const tail = source.slice(bodyStart);
  const nextSectionOffset = tail.search(/\n## \[/u);
  const bodyEnd = nextSectionOffset < 0 ? source.length : bodyStart + nextSectionOffset;
  const before = source.slice(0, bodyStart);
  const after = source.slice(bodyEnd);

  const lines = source.slice(bodyStart, bodyEnd).split("\n");
  const headerAt = new Map();
  lines.forEach((line, index) => {
    const match = /^### (.+)$/u.exec(line.trim());
    if (match && !headerAt.has(match[1])) headerAt.set(match[1], index);
  });

  const insertions = [];
  const appends = [];
  for (const [group, items] of byGroup) {
    if (items.length === 0) continue;
    const at = headerAt.get(group);
    if (at === undefined) appends.push({ group, items });
    else insertions.push({ at, items });
  }
  insertions.sort((left, right) => right.at - left.at);
  for (const { at, items } of insertions) {
    const block = items.map((item) => `- ${item}`);
    const contentStart = at + 1 < lines.length && lines[at + 1].trim() === "" ? at + 2 : at + 1;
    lines.splice(contentStart, 0, ...block);
  }

  let body = lines.join("\n");
  if (appends.length > 0) {
    const block = appends
      .map(({ group, items }) => `### ${group}\n\n${items.map((item) => `- ${item}`).join("\n")}`)
      .join("\n\n");
    body = body.trim().length > 0 ? `${body.trimEnd()}\n\n${block}\n` : `\n\n${block}\n`;
  }
  return `${before}${body}${after}`;
}
