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
        errors.push(
          `Changelog section [${section.label}] has an empty ${group.title} group.`,
        );
      }
    }
  }
  return errors;
}

export function prepareReleaseChangelog(markdown, tag, releaseDate) {
  const normalizedTag = String(tag).trim().replace(/^v/u, "");
  if (!/^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/u.test(normalizedTag)) {
    throw new Error(
      `expected a stable release tag, received ${JSON.stringify(tag)}`,
    );
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
  const bodyEnd =
    nextSectionOffset < 0 ? markdown.length : bodyStart + nextSectionOffset;
  const unreleasedBody = markdown.slice(bodyStart, bodyEnd).trim();
  const unreleased = parseChangelog(`${startMarker}\n\n${unreleasedBody}\n`)[0];
  const itemCount =
    unreleased?.groups.reduce(
      (total, current) => total + current.items.length,
      0,
    ) ?? 0;
  if (itemCount === 0) {
    throw new Error("CHANGELOG.md [Unreleased] has no entries to release");
  }

  const before = markdown.slice(0, start);
  const after = markdown.slice(bodyEnd).replace(/^\n+/u, "");
  return `${before}${startMarker}\n\n## [${normalizedTag}] - ${releaseDate}\n\n${unreleasedBody}\n\n${after}`;
}

export function releaseNotesForTag(markdown, tag) {
  const normalizedTag = String(tag).trim().replace(/^v/u, "");
  const section = parseChangelog(markdown).find(
    (candidate) => candidate.label === normalizedTag,
  );
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
