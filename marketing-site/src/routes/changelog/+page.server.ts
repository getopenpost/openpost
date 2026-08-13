import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { parseChangelog } from "@openpost/changelog";
import type { PageServerLoad } from "./$types";

async function readCanonicalChangelog() {
  const candidates = [
    resolve(process.cwd(), "CHANGELOG.md"),
    resolve(process.cwd(), "..", "CHANGELOG.md"),
  ];
  for (const candidate of candidates) {
    try {
      return await readFile(candidate, "utf8");
    } catch {
      // Build commands can run from the repository root or the package root.
    }
  }
  throw new Error("Could not find the repository CHANGELOG.md");
}

export const prerender = true;

export const load = (async () => {
  const sections = parseChangelog(await readCanonicalChangelog())
    .filter((section) => section.groups.some((group) => group.items.length > 0))
    .slice(0, 4)
    .map((section) => ({
      label: section.label,
      date: section.date,
      intro: section.intro,
      groups: section.groups
        .filter((group) => group.items.length > 0)
        .map((group) => ({
          title: group.title,
          items: group.items.slice(0, 5),
          remaining: Math.max(0, group.items.length - 5),
        })),
    }));

  return { sections };
}) satisfies PageServerLoad;
