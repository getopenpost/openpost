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
const commitReferencePattern = /\b[0-9a-f]{7,40}\b/gu;
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

function git(args, cwd) {
  const result = spawnSync("git", args, { cwd, encoding: "utf8" });
  if (result.status !== 0) {
    throw new Error(`git ${args.join(" ")} failed: ${result.stderr.trim()}`);
  }
  return result.stdout;
}

// Maps each commit that a merge on the first-parent line brought in to that
// merge, so the commits of one merged pull request share its fragments.
function mergedChanges(base, head, cwd) {
  const changes = new Map();
  const merges = git(["rev-list", "--first-parent", "--merges", `${base}..${head}`], cwd);
  for (const merge of merges.split("\n").filter(Boolean)) {
    const commits = git(["rev-list", "--no-merges", `${merge}^1..${merge}`], cwd);
    for (const commit of commits.split("\n").filter(Boolean)) changes.set(commit, merge);
  }
  return changes;
}

// Lists the non-merge commits in base..head with the paths each one added or
// modified, and the change (a direct commit, or the merge that brought it in)
// it belongs to. Deleted paths are left out: removing a fragment documents
// nothing.
export function commitsInRange(base, head, { cwd } = {}) {
  const output = git(
    [
      "log",
      "--no-merges",
      "--no-renames",
      "--name-status",
      `--format=${recordSeparator}%H${fieldSeparator}%s${fieldSeparator}%b${fieldSeparator}`,
      `${base}..${head}`,
    ],
    cwd,
  );
  const merged = mergedChanges(base, head, cwd);
  return output
    .split(recordSeparator)
    .filter((record) => record.trim())
    .map((record) => {
      const [hash, subject, body, changes] = record.split(fieldSeparator);
      const files = changes.split("\n").flatMap((line) => {
        const [status, file] = line.trim().split("\t");
        return file && status !== "D" ? [file] : [];
      });
      return { hash, subject, body, files, change: merged.get(hash) ?? hash };
    });
}

// A pull request is covered when any of its commits writes a fragment, because
// contributors often add the fragment in its own commit.
export function pullRequestCommitsMissingFragments(commits) {
  if (commits.some(writesFragment)) return [];
  return commits.filter(requiresFragment);
}

// A commit on main is covered by a fragment written in its change (the commit
// itself or the pull request merged with it), by a fragment named after an
// issue in its subject (`<issue>.md`), or by a commit that writes a fragment
// and names the same issue or the commit's hash.
export function releaseCommitsMissingFragments(commits, fragmentNames) {
  const coveredIssues = new Set(
    fragmentNames.map((name) => issueFragmentPattern.exec(name)?.[1]).filter(Boolean),
  );
  const coveredChanges = new Set();
  const commitReferences = [];
  for (const commit of commits.filter(writesFragment)) {
    coveredChanges.add(commit.change);
    for (const issue of issueReferences(commit)) coveredIssues.add(issue);
    commitReferences.push(...`${commit.subject}\n${commit.body}`.matchAll(commitReferencePattern));
  }
  return commits.filter(
    (commit) =>
      requiresFragment(commit) &&
      !coveredChanges.has(commit.change) &&
      !issueReferences(commit).some((issue) => coveredIssues.has(issue)) &&
      !commitReferences.some(([reference]) => commit.hash.startsWith(reference)),
  );
}
