import { spawnSync } from "node:child_process";

// Conventional feat and fix commits describe product changes, so they need a
// changes/ fragment. Scopes listed here only touch the build, tests or release
// machinery and never reach users; any other change can opt out with a
// `Changelog: none` trailer.
const exemptScopes = new Set([
  "build",
  "ci",
  "deps",
  "docs",
  "e2e",
  "marketing",
  "release",
  "tasks",
  "test",
  "tests",
]);
const releaseSubjectPattern = /^(feat|fix)(?:\(([^)]+)\))?!?:\s*(.+)$/u;
const optOutTrailerPattern = /^changelog:\s*none\s*$/imu;
const fragmentPathPattern = /^changes\/(.+\.md)$/u;
const issueReferencePattern = /\(#(\d+)\)/gu;
const zeroRevisionPattern = /^0+$/u;

const recordSeparator = "\u001e";
const fieldSeparator = "\u001f";

const otherChangesGroup = "Other changes";

function releaseSubject(subject) {
  const match = releaseSubjectPattern.exec(subject.trim());
  if (!match) return null;
  return { scope: match[2]?.trim() ?? "", description: match[3].trim() };
}

function requiresFragment(commit) {
  const subject = releaseSubject(commit.subject);
  if (!subject) return false;
  if (subject.scope && exemptScopes.has(subject.scope.toLowerCase())) return false;
  return !optOutTrailerPattern.test(commit.body);
}

function addedFragments(commit) {
  return commit.files.flatMap((file) => {
    const match = fragmentPathPattern.exec(file);
    return match && match[1] !== "README.md" ? [match[1]] : [];
  });
}

function issueReferences(subject) {
  return [...subject.matchAll(issueReferencePattern)].map((match) => match[1]);
}

function defaultGit(args) {
  const result = spawnSync("git", args, { encoding: "utf8" });
  return result.status === 0 ? result.stdout : null;
}

// Resolves a revision to a commit, or returns null when the checkout does not
// contain it (shallow clones, unknown tags, or the all-zero push base).
export function resolveCommit(revision, git = defaultGit) {
  const value = String(revision ?? "").trim();
  if (!value || zeroRevisionPattern.test(value)) return null;
  return git(["rev-parse", "--verify", "--quiet", `${value}^{commit}`])?.trim() || null;
}

// Lists the non-merge commits in base..head with their subject, body and the
// files each one touched.
export function commitsInRange(base, head, git = defaultGit) {
  const output = git([
    "log",
    "--no-merges",
    "--name-only",
    `--format=${recordSeparator}%H${fieldSeparator}%s${fieldSeparator}%b${fieldSeparator}`,
    `${base}..${head}`,
  ]);
  if (output === null) throw new Error(`could not list commits in ${base}..${head}`);
  return output
    .split(recordSeparator)
    .filter((record) => record.trim())
    .map((record) => {
      const [hash, subject, body, files] = record.split(fieldSeparator);
      return {
        hash,
        subject,
        body,
        files: files
          .split("\n")
          .map((file) => file.trim())
          .filter(Boolean),
      };
    });
}

// A change (pull request or push) is covered when any of its commits adds or
// edits a fragment: contributors often write the fragment in its own commit.
export function changeCommitsMissingFragments(commits) {
  if (commits.some((commit) => addedFragments(commit).length > 0)) return [];
  return commits.filter(requiresFragment);
}

// Within a release, each squashed commit stands alone. A commit is covered by
// a fragment it touched, by a fragment named after one of its issues, or by a
// fragment commit in the same release that references the same issue.
function releaseCommitsMissingFragments(commits, fragmentNames) {
  const coveredIssues = new Set(
    [...fragmentNames].map((name) => /^(\d+)\.md$/u.exec(name)?.[1]).filter(Boolean),
  );
  for (const commit of commits) {
    if (addedFragments(commit).length === 0) continue;
    for (const issue of issueReferences(commit.subject)) coveredIssues.add(issue);
  }
  return commits.filter(
    (commit) =>
      requiresFragment(commit) &&
      addedFragments(commit).length === 0 &&
      !issueReferences(commit.subject).some((issue) => coveredIssues.has(issue)),
  );
}

function releaseNoteItem(commit) {
  const { scope, description } = releaseSubject(commit.subject);
  return scope ? `**${scope}:** ${description}` : description;
}

// Release notes and the recorded CHANGELOG list feat and fix commits that
// shipped without a fragment, oldest first, so a forgotten fragment never
// drops a change from the published history. Both callers pass the same
// published tag and release revision, which keeps their output identical.
export function addCommitsMissingFragments(byGroup, options) {
  const { publishedTag, release, fragmentNames, warn, git = defaultGit } = options;
  if (!publishedTag) return byGroup;
  const base = resolveCommit(publishedTag, git);
  const head = resolveCommit(release, git);
  if (!base || !head) {
    warn(
      `skipping commits without fragments: ${base ? release : publishedTag} is not in this checkout`,
    );
    return byGroup;
  }
  const missing = releaseCommitsMissingFragments(commitsInRange(base, head, git), fragmentNames);
  if (missing.length === 0) return byGroup;
  const items = byGroup.get(otherChangesGroup) ?? [];
  items.push(...missing.toReversed().map(releaseNoteItem));
  byGroup.set(otherChangesGroup, items);
  return byGroup;
}
