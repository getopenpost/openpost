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
