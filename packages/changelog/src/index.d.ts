export interface ChangelogGroup {
  title: string;
  items: string[];
}

export interface ChangelogSection {
  label: string;
  date: string;
  intro: string[];
  groups: ChangelogGroup[];
}

export function parseChangelog(markdown: string): ChangelogSection[];
export function validateChangelog(markdown: string): string[];
export function compareStableVersions(left: string, right: string): number | null;
export function prepareReleaseChangelog(
  markdown: string,
  tag: string,
  releaseDate: string,
  options?: { publishedTag?: string },
): string;
export function releaseNotesForTag(markdown: string, tag: string): string;
