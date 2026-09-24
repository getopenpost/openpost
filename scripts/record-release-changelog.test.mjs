import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import {
  chmodSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const scriptPath = fileURLToPath(new URL("./record-release-changelog.mjs", import.meta.url));

function setupRepo() {
  const root = mkdtempSync(path.join(tmpdir(), "openpost-record-changelog-"));
  const bin = path.join(root, "bin");
  mkdirSync(path.join(root, "changes"), { recursive: true });
  mkdirSync(bin, { recursive: true });
  const gh = path.join(bin, "gh");
  writeFileSync(
    gh,
    '#!/bin/sh\nprintf \'[[{"tag_name":"v1.0.0","draft":false,"prerelease":false,"published_at":"2026-01-01T00:00:00Z"}]]\\n\'\n',
  );
  chmodSync(gh, 0o755);
  const env = { ...process.env, PATH: `${bin}:${process.env.PATH}` };
  const git = (args) => {
    const result = spawnSync("git", args, { cwd: root, encoding: "utf8", env });
    assert.equal(result.status, 0, result.stderr);
    return result.stdout.trim();
  };
  git(["init"]);
  git(["config", "user.email", "record-test@openpost.local"]);
  git(["config", "user.name", "OpenPost Record Test"]);
  return { root, env, git };
}

function record(root, env, args) {
  return spawnSync(process.execPath, [scriptPath, ...args], {
    cwd: root,
    encoding: "utf8",
    env,
  });
}

test("recording consumes only tag-pinned fragments and keeps post-tag work", () => {
  const { root, env, git } = setupRepo();
  try {
    writeFileSync(
      path.join(root, "CHANGELOG.md"),
      "# Changelog\n\n## [Unreleased]\n\n## [1.0.0] - 2026-01-01\n\n### Fixed\n\n- Old fix.\n",
    );
    git(["add", "."]);
    git(["commit", "-m", "chore: base"]);
    writeFileSync(path.join(root, "changes", "a.md"), "### Fixed\n\n- Tagged fix.\n");
    git(["add", "."]);
    git(["commit", "-m", "fix: tagged work"]);
    git(["tag", "v1.0.1"]);
    // Main advances after the tag: this fragment belongs to the next
    // release, not the one being recorded.
    writeFileSync(path.join(root, "changes", "b.md"), "### Added\n\n- Post-tag work.\n");
    git(["add", "."]);
    git(["commit", "-m", "feat: post-tag work"]);

    const result = record(root, env, ["v1.0.1", "2026-02-02"]);
    assert.equal(result.status, 0, result.stderr);
    assert.match(result.stdout, /recorded v1\.0\.1/u);

    const changelog = readFileSync(path.join(root, "CHANGELOG.md"), "utf8");
    assert.equal(
      changelog,
      [
        "# Changelog",
        "",
        "## [Unreleased]",
        "",
        "## [1.0.1] - 2026-02-02",
        "",
        "### Fixed",
        "",
        "- Tagged fix.",
        "",
        "## [1.0.0] - 2026-01-01",
        "",
        "### Fixed",
        "",
        "- Old fix.",
        "",
      ].join("\n"),
    );
    assert.ok(!existsSync(path.join(root, "changes", "a.md")));
    assert.equal(
      readFileSync(path.join(root, "changes", "b.md"), "utf8"),
      "### Added\n\n- Post-tag work.\n",
    );

    // Reruns are idempotent: the section stays single and nothing changes.
    const rerun = record(root, env, ["v1.0.1", "2026-02-02"]);
    assert.equal(rerun.status, 0, rerun.stderr);
    assert.match(rerun.stdout, /already recorded/u);
    assert.equal(readFileSync(path.join(root, "CHANGELOG.md"), "utf8"), changelog);
    assert.equal(changelog.match(/^## \[1\.0\.1\]/gmu)?.length, 1);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("recording merges direct Unreleased edits with tag fragments", () => {
  const { root, env, git } = setupRepo();
  try {
    writeFileSync(
      path.join(root, "CHANGELOG.md"),
      "# Changelog\n\n## [Unreleased]\n\n### Fixed\n\n- Direct edit.\n\n## [1.0.0] - 2026-01-01\n",
    );
    writeFileSync(path.join(root, "changes", "a.md"), "### Fixed\n\n- Tagged fix.\n");
    git(["add", "."]);
    git(["commit", "-m", "fix: tagged work"]);
    git(["tag", "v1.0.1"]);

    const result = record(root, env, ["v1.0.1", "2026-02-02"]);
    assert.equal(result.status, 0, result.stderr);
    const changelog = readFileSync(path.join(root, "CHANGELOG.md"), "utf8");
    assert.match(changelog, /^## \[1\.0\.1\] - 2026-02-02$/mu);
    const section = changelog.slice(
      changelog.indexOf("## [1.0.1]"),
      changelog.indexOf("## [1.0.0]"),
    );
    assert.match(section, /- Tagged fix\./u);
    assert.match(section, /- Direct edit\./u);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("recording rejects unknown tags and empty releases", () => {
  const { root, env, git } = setupRepo();
  try {
    writeFileSync(
      path.join(root, "CHANGELOG.md"),
      "# Changelog\n\n## [Unreleased]\n\n## [1.0.0] - 2026-01-01\n",
    );
    git(["add", "."]);
    git(["commit", "-m", "chore: base"]);

    const unknown = record(root, env, ["v9.9.9", "2026-02-02"]);
    assert.notEqual(unknown.status, 0);

    git(["tag", "v1.0.1"]);
    const empty = record(root, env, ["v1.0.1", "2026-02-02"]);
    assert.notEqual(empty.status, 0);
    assert.match(empty.stderr, /no entries/u);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
