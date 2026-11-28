import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const scriptPath = fileURLToPath(new URL("./check-changelog.mjs", import.meta.url));

function setupRepo() {
  const root = mkdtempSync(path.join(tmpdir(), "openpost-check-changelog-"));
  const git = (args) => {
    const result = spawnSync("git", args, { cwd: root, encoding: "utf8" });
    assert.equal(result.status, 0, result.stderr);
    return result.stdout.trim();
  };
  git(["init"]);
  git(["config", "user.email", "changelog-test@openpost.local"]);
  git(["config", "user.name", "OpenPost Changelog Test"]);
  // Fixture history must not depend on the developer's signing setup.
  git(["config", "commit.gpgsign", "false"]);
  mkdirSync(path.join(root, "changes"));
  writeFileSync(
    path.join(root, "CHANGELOG.md"),
    "# Changelog\n\n## [Unreleased]\n\n## [1.0.0] - 2026-01-01\n\n### Fixed\n\n- Old fix.\n",
  );
  writeFileSync(path.join(root, "changes", "README.md"), "# Changes fragments\n");
  git(["add", "."]);
  git(["commit", "-m", "chore: base"]);
  const commit = (message, files = {}) => {
    for (const [name, content] of Object.entries(files)) {
      writeFileSync(path.join(root, name), content);
    }
    git(["add", "--all"]);
    git(["commit", "--allow-empty", "-m", message]);
    return git(["rev-parse", "HEAD"]);
  };
  return { root, git, commit, base: git(["rev-parse", "HEAD"]) };
}

function check(root, env) {
  return spawnSync(process.execPath, [scriptPath], {
    cwd: root,
    encoding: "utf8",
    env: { ...process.env, ...env },
  });
}

test("pull requests with feat or fix commits must add a fragment", () => {
  const { root, commit, base } = setupRepo();
  try {
    commit("fix(api): keep retries bounded", { "api.txt": "one\n" });
    const head = commit("chore: tidy", { "api.txt": "two\n" });
    const range = { OPENPOST_CHANGELOG_BASE: base, OPENPOST_CHANGELOG_HEAD: head };

    const enforced = check(root, { ...range, OPENPOST_CHANGELOG_ENFORCE: "1" });
    assert.equal(enforced.status, 1, enforced.stdout);
    assert.match(enforced.stderr, /fix\(api\): keep retries bounded/u);
    assert.doesNotMatch(enforced.stderr, /chore: tidy/u);

    // Main pushes report the same commits without failing the gate.
    const warned = check(root, { ...range, OPENPOST_CHANGELOG_ENFORCE: "0" });
    assert.equal(warned.status, 0, warned.stderr);
    assert.match(warned.stderr, /warning: .*\n.*\n {2}[0-9a-f]{12} fix\(api\)/u);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("a fragment anywhere in the pull request covers its commits", () => {
  const { root, commit, base } = setupRepo();
  try {
    commit("feat(composer): add a draft counter", { "composer.txt": "one\n" });
    const head = commit("docs: describe the draft counter", {
      "changes/41.md": "### Added\n\n- Drafts show a character counter.\n",
    });

    const result = check(root, {
      OPENPOST_CHANGELOG_BASE: base,
      OPENPOST_CHANGELOG_HEAD: head,
      OPENPOST_CHANGELOG_ENFORCE: "1",
    });
    assert.equal(result.status, 0, result.stderr);
    assert.doesNotMatch(result.stderr, /warning/u);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("internal scopes, the opt-out trailer and fragment removals", () => {
  const { root, git, commit } = setupRepo();
  try {
    const base = commit("chore: add a note", { "changes/old.md": "### Fixed\n\n- Old note.\n" });
    commit("fix(ci): pin the scanner download", { "ci.txt": "one\n" });
    commit("fix(server): clear new lint findings\n\nChangelog: none", { "server.txt": "one\n" });
    // Neither the README nor removing a fragment documents a change.
    commit("fix(web): keep locales out of builds", {
      "changes/README.md": "# Changes fragments\n\nUpdated.\n",
    });
    git(["rm", "--quiet", "changes/old.md"]);
    const head = commit("fix(media): drop the stale note");

    const result = check(root, {
      OPENPOST_CHANGELOG_BASE: base,
      OPENPOST_CHANGELOG_HEAD: head,
      OPENPOST_CHANGELOG_ENFORCE: "1",
    });
    assert.equal(result.status, 1, result.stdout);
    assert.match(result.stderr, /fix\(web\): keep locales out of builds/u);
    assert.match(result.stderr, /fix\(media\): drop the stale note/u);
    assert.doesNotMatch(result.stderr, /fix\(ci\)|fix\(server\)/u);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("pushes skip an unusable range and pull requests fail closed", () => {
  const { root, commit } = setupRepo();
  try {
    const head = commit("fix(api): keep retries bounded", { "api.txt": "one\n" });
    // A new branch push reports an all-zero before revision.
    const range = { OPENPOST_CHANGELOG_BASE: "0".repeat(40), OPENPOST_CHANGELOG_HEAD: head };

    const pushed = check(root, { ...range, OPENPOST_CHANGELOG_ENFORCE: "0" });
    assert.equal(pushed.status, 0, pushed.stderr);
    assert.match(pushed.stdout, /fragments are valid/u);

    const pullRequest = check(root, { ...range, OPENPOST_CHANGELOG_ENFORCE: "1" });
    assert.equal(pullRequest.status, 1, pullRequest.stdout);
    assert.match(pullRequest.stderr, /not in this checkout/u);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
