const sectionPattern = /^## \[([^\]]+)\](?: - (.+))?$/u;
const groupPattern = /^### (.+)$/u;
const itemPattern = /^-\s+(.+)$/u;

export function parseChangelog(markdown) {
  const sections = [];
  let section;
  let group;

  for (const rawLine of String(markdown).split(/\r?\n/u)) {
    const line = rawLine.trim();
    const sectionMatch = sectionPattern.exec(line);
    if (sectionMatch) {
      section = {
        label: sectionMatch[1],
        date: sectionMatch[2] ?? "",
        intro: [],
        groups: [],
      };
      sections.push(section);
      group = undefined;
      continue;
    }
    if (!section) continue;

    const groupMatch = groupPattern.exec(line);
    if (groupMatch) {
      group = { title: groupMatch[1], items: [] };
      section.groups.push(group);
      continue;
    }

    const itemMatch = itemPattern.exec(line);
    if (itemMatch && group) {
      group.items.push(itemMatch[1]);
      continue;
    }

    if (line && !line.startsWith("#") && !group) {
      section.intro.push(line);
    }
  }

  return sections;
}

export function validateChangelog(markdown) {
  const sections = parseChangelog(markdown);
  const errors = [];
  if (sections.length === 0) {
    return ["No changelog sections were found."];
  }
  if (sections[0].label !== "Unreleased") {
    errors.push("The first changelog section must be [Unreleased].");
  }

  const labels = new Set();
  for (const section of sections) {
    if (labels.has(section.label)) {
      errors.push(`Duplicate changelog section [${section.label}].`);
    }
    labels.add(section.label);
    for (const group of section.groups) {
      if (group.items.length === 0) {
        errors.push(`Changelog section [${section.label}] has an empty ${group.title} group.`);
      }
    }
  }
  return errors;
}

function mergePendingBodyIntoReleaseBody(releaseBody, pending) {
  const pendingSection = parseChangelog(`## [Unreleased]\n\n${pending}\n`)[0];
  const lines = releaseBody.trim().split(/\r?\n/u);

  for (const group of pendingSection?.groups ?? []) {
    const items = group.items.map((item) => `- ${item}`);
    const header = `### ${group.title}`;
    const headerIndex = lines.findIndex((line) => line.trim() === header);
    if (headerIndex < 0) {
      if (lines.length > 0 && lines.at(-1) !== "") lines.push("");
      lines.push(header, "", ...items);
      continue;
    }
    const insertAt = lines[headerIndex + 1]?.trim() === "" ? headerIndex + 2 : headerIndex + 1;
    lines.splice(insertAt, 0, ...items);
  }

  return lines.join("\n").trim();
}

const stableVersionPattern = /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/u;

function compareStableVersions(left, right) {
  const leftParts = stableVersionPattern.exec(String(left).trim())?.slice(1).map(Number);
  const rightParts = stableVersionPattern.exec(String(right).trim())?.slice(1).map(Number);
  if (!leftParts || !rightParts) return null;
  for (let index = 0; index < leftParts.length; index += 1) {
    if (leftParts[index] !== rightParts[index]) {
      return Math.sign(leftParts[index] - rightParts[index]);
    }
  }
  return 0;
}

export function prepareReleaseChangelog(markdown, tag, releaseDate, options = {}) {
  const normalizedTag = String(tag).trim().replace(/^v/u, "");
  if (!/^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/u.test(normalizedTag)) {
    throw new Error(`expected a stable release tag, received ${JSON.stringify(tag)}`);
  }
  if (!/^\d{4}-\d{2}-\d{2}$/u.test(releaseDate)) {
    throw new Error(
      `expected a release date in YYYY-MM-DD form, received ${JSON.stringify(releaseDate)}`,
    );
  }

  const startMarker = "## [Unreleased]";
  const start = markdown.indexOf(startMarker);
  if (start < 0) throw new Error("CHANGELOG.md is missing [Unreleased]");
  const bodyStart = start + startMarker.length;
  const nextSectionOffset = markdown.slice(bodyStart).search(/\n## \[/u);
  const bodyEnd = nextSectionOffset < 0 ? markdown.length : bodyStart + nextSectionOffset;
  const unreleasedBody = markdown.slice(bodyStart, bodyEnd).trim();
  const unreleased = parseChangelog(`${startMarker}\n\n${unreleasedBody}\n`)[0];
  const itemCount =
    unreleased?.groups.reduce((total, current) => total + current.items.length, 0) ?? 0;

  const afterUnreleased = markdown.slice(bodyEnd).replace(/^\n+/u, "");
  // A failed candidate never publishes its GitHub release, so its dated
  // section never ships even though it sits above the last shipped one.
  // Fold every section newer than the latest published release into the
  // replacement release instead of orphaning it.
  const publishedTag = String(options?.publishedTag ?? "")
    .trim()
    .replace(/^v/u, "");
  const keptLines = [];
  const carriedSections = [];
  const targetLines = [];
  let carriedCount = 0;
  let carriedCurrent = null;
  let inTarget = false;
  for (const rawLine of afterUnreleased.split("\n")) {
    const headerMatch = sectionPattern.exec(rawLine.trim());
    if (headerMatch) {
      if (carriedCurrent) {
        carriedSections.push(carriedCurrent.join("\n"));
        carriedCurrent = null;
      }
      inTarget = headerMatch[1] === normalizedTag;
      if (inTarget) continue;
      if (publishedTag !== "" && (compareStableVersions(headerMatch[1], publishedTag) ?? 0) > 0) {
        carriedCount += 1;
        carriedCurrent = [];
        continue;
      }
      keptLines.push(rawLine);
      continue;
    }
    if (carriedCurrent) carriedCurrent.push(rawLine);
    else if (inTarget) targetLines.push(rawLine);
    else keptLines.push(rawLine);
  }
  if (carriedCurrent) carriedSections.push(carriedCurrent.join("\n"));
  if (carriedCount > 0) {
    const carriedHasItems =
      parseChangelog(`## [Unreleased]\n\n${carriedSections.join("\n\n")}\n`).find(
        (section) => section.label === "Unreleased",
      )?.groups.reduce((total, group) => total + group.items.length, 0) ?? 0;
    // Fold stacked orphans one at a time so repeated ### groups merge
    // their items instead of duplicating headers. Each older orphan is the
    // pending body merged into the accumulated newer entries.
    let carriedBody = "";
    for (const section of carriedSections.map((part) => part.trim()).filter(Boolean)) {
      carriedBody = carriedBody ? mergePendingBodyIntoReleaseBody(section, carriedBody) : section;
    }
    carriedBody = carriedBody.trim();
    const pendingBody = carriedBody
      ? mergePendingBodyIntoReleaseBody(carriedBody, unreleasedBody)
      : unreleasedBody;
    const targetBody = targetLines.join("\n").trim();
    let finalBody = pendingBody;
    if (targetBody) {
      finalBody = pendingBody ? mergePendingBodyIntoReleaseBody(targetBody, pendingBody) : targetBody;
    }
    if (!finalBody) {
      if (itemCount === 0 && carriedHasItems === 0) {
        throw new Error("CHANGELOG.md [Unreleased] has no entries to release");
      }
      return markdown;
    }
    const before = markdown.slice(0, start);
    const shippedRest = keptLines.join("\n").replace(/^\n+/u, "").trimEnd();
    const tail = shippedRest ? `\n\n${shippedRest}` : "";
    return `${before}${startMarker}\n\n## [${normalizedTag}] - ${releaseDate}\n\n${finalBody}${tail}\n`;
  }
  const nextSection = sectionPattern.exec(afterUnreleased.split(/\r?\n/u, 1)[0] ?? "");
  if (nextSection?.[1] === normalizedTag) {
    if (itemCount === 0) return markdown;
    const headerEnd = afterUnreleased.indexOf("\n");
    const releaseBodyStart = headerEnd < 0 ? afterUnreleased.length : headerEnd + 1;
    const followingSectionOffset = afterUnreleased.slice(releaseBodyStart).search(/\n## \[/u);
    const releaseBodyEnd =
      followingSectionOffset < 0
        ? afterUnreleased.length
        : releaseBodyStart + followingSectionOffset;
    const releaseBody = afterUnreleased.slice(releaseBodyStart, releaseBodyEnd);
    const followingSections = afterUnreleased.slice(releaseBodyEnd).replace(/^\n+/u, "").trimEnd();
    const mergedBody = mergePendingBodyIntoReleaseBody(releaseBody, unreleasedBody);
    const tail = followingSections ? `\n\n${followingSections}` : "";
    return `${markdown.slice(0, start)}${startMarker}\n\n## [${normalizedTag}] - ${releaseDate}\n\n${mergedBody}${tail}\n`;
  }

  if (itemCount === 0) {
    throw new Error("CHANGELOG.md [Unreleased] has no entries to release");
  }

  const before = markdown.slice(0, start);
  return `${before}${startMarker}\n\n## [${normalizedTag}] - ${releaseDate}\n\n${unreleasedBody}\n\n${afterUnreleased}`;
}

export function releaseNotesForTag(markdown, tag) {
  const normalizedTag = String(tag).trim().replace(/^v/u, "");
  const section = parseChangelog(markdown).find((candidate) => candidate.label === normalizedTag);
  if (!section) {
    throw new Error(`CHANGELOG.md has no [${normalizedTag}] section`);
  }
  const lines = [];
  for (const group of section.groups) {
    if (group.items.length === 0) continue;
    lines.push(`## ${group.title}`, "");
    for (const item of group.items) lines.push(`- ${item}`);
    lines.push("");
  }
  return lines.join("\n").trimEnd();
}
