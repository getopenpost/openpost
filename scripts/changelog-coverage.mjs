import { spawnSync } from "node:child_process";

// Conventional feat and fix commits describe product changes, so they need a
// changes/ fragment. Scopes listed here only touch the build, tests or release
// machinery and never reach users; any other commit can opt out with a
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
const releaseSubjectPattern = /^(?:feat|fix)(?:\(([^)]+)\))?!?:/u;
const optOutTrailerPattern = /^changelog:\s*none\s*$/imu;
const fragmentPathPattern = /^changes\/(?!README\.md$)[^/]+\.md$/u;
const issueFragmentPattern = /^(\d+)\.md$/u;
const issueReferencePattern = /#(\d+)\b/gu;
const zeroRevisionPattern = /^0+$/u;

const recordSeparator = "\u001e";
const fieldSeparator = "\u001f";

function requiresFragment(commit) {
  const match = releaseSubjectPattern.exec(commit.subject.trim());
  if (!match) return false;
  const scope = match[1]?.trim().toLowerCase();
  if (scope && exemptScopes.has(scope)) return false;
  return !optOutTrailerPattern.test(commit.body);
}

function writesFragment(commit) {
  return commit.files.some((file) => fragmentPathPattern.test(file));
}

function issueReferences(commit) {
  return [...commit.subject.matchAll(issueReferencePattern)].map((match) => match[1]);
}

// Resolves a revision to a commit, or returns null when the checkout does not
// contain it (shallow clones, unknown revisions, or the all-zero push base).
export function resolveCommit(revision, { cwd } = {}) {
  const value = String(revision ?? "").trim();
  if (!value || zeroRevisionPattern.test(value)) return null;
  const result = spawnSync("git", ["rev-parse", "--verify", "--quiet", `${value}^{commit}`], {
    cwd,
    encoding: "utf8",
  });
  return result.status === 0 ? result.stdout.trim() : null;
}

// Lists the non-merge commits in base..head with the paths each one added or
// modified. Deleted paths are left out: removing a fragment documents nothing.
export function commitsInRange(base, head, { cwd } = {}) {
  const result = spawnSync(
    "git",
    [
      "log",
      "--no-merges",
      "--no-renames",
      "--name-status",
      `--format=${recordSeparator}%H${fieldSeparator}%s${fieldSeparator}%b${fieldSeparator}`,
      `${base}..${head}`,
    ],
    { cwd, encoding: "utf8" },
  );
  if (result.status !== 0) {
    throw new Error(`could not list commits in ${base}..${head}: ${result.stderr.trim()}`);
  }
  return result.stdout
    .split(recordSeparator)
    .filter((record) => record.trim())
    .map((record) => {
      const [hash, subject, body, changes] = record.split(fieldSeparator);
      const files = changes.split("\n").flatMap((line) => {
        const [status, file] = line.trim().split("\t");
        return file && status !== "D" ? [file] : [];
      });
      return { hash, subject, body, files };
    });
}

// A pull request is covered when any of its commits writes a fragment, because
// contributors often add the fragment in its own commit.
export function pullRequestCommitsMissingFragments(commits) {
  if (commits.some(writesFragment)) return [];
  return commits.filter(requiresFragment);
}

// Commits on main stand alone. A commit is covered by a fragment it wrote, by a
// fragment named after an issue in its subject (`<issue>.md`), or by another
// commit in the range that wrote a fragment and names the same issue.
export function releaseCommitsMissingFragments(commits, fragmentNames) {
  const coveredIssues = new Set(
    fragmentNames.map((name) => issueFragmentPattern.exec(name)?.[1]).filter(Boolean),
  );
  for (const commit of commits.filter(writesFragment)) {
    for (const issue of issueReferences(commit)) coveredIssues.add(issue);
  }
  return commits.filter(
    (commit) =>
      requiresFragment(commit) &&
      !writesFragment(commit) &&
      !issueReferences(commit).some((issue) => coveredIssues.has(issue)),
  );
}
