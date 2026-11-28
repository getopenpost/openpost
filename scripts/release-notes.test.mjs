import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { chmodSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const scriptPath = fileURLToPath(new URL("./release-notes.mjs", import.meta.url));

function fakeGitHubBin(directory) {
  const bin = path.join(directory, "bin");
  mkdirSync(bin, { recursive: true });
  const gh = path.join(bin, "gh");
  writeFileSync(
    gh,
    '#!/bin/sh\nprintf \'[[{"tag_name":"v1.0.0","draft":false,"prerelease":false,"published_at":"2026-01-01T00:00:00Z"}]]\\n\'\n',
  );
  chmodSync(gh, 0o755);
  return `${bin}:${process.env.PATH}`;
}

test("release notes merge fragments with Unreleased without a prepared section", () => {
  const root = mkdtempSync(path.join(tmpdir(), "openpost-release-notes-"));
  try {
    mkdirSync(path.join(root, "changes"), { recursive: true });
    writeFileSync(
      path.join(root, "CHANGELOG.md"),
      "# Changelog\n\n## [Unreleased]\n\n### Fixed\n\n- Kept the existing item.\n\n## [1.0.0] - 2026-01-01\n\n### Fixed\n\n- Old fix.\n",
    );
    writeFileSync(
      path.join(root, "changes", "README.md"),
      "# Changes fragments\n\n### Fixed\n- Describe the user-visible fix.\n",
    );
    writeFileSync(
      path.join(root, "changes", "123.md"),
      "### Fixed\n\n- Fixed the real issue.\n\n### Changed\n\n- Changed the real workflow.\n",
    );

    const notes = execFileSync(process.execPath, [scriptPath, "v1.0.1"], {
      cwd: root,
      encoding: "utf8",
      env: { ...process.env, PATH: fakeGitHubBin(root) },
    });
    assert.equal(
      notes.trim(),
      [
        "## Fixed",
        "",
        "- Fixed the real issue.",
        "- Kept the existing item.",
        "",
        "## Changed",
        "",
        "- Changed the real workflow.",
      ].join("\n"),
    );
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("release notes fail closed when there is nothing to release", () => {
  const root = mkdtempSync(path.join(tmpdir(), "openpost-release-notes-empty-"));
  try {
    mkdirSync(path.join(root, "changes"), { recursive: true });
    writeFileSync(
      path.join(root, "CHANGELOG.md"),
      "# Changelog\n\n## [Unreleased]\n\n## [1.0.0] - 2026-01-01\n",
    );
    assert.throws(
      () =>
        execFileSync(process.execPath, [scriptPath, "v1.0.1"], {
          cwd: root,
          encoding: "utf8",
          stdio: ["ignore", "pipe", "pipe"],
          env: { ...process.env, PATH: fakeGitHubBin(root) },
        }),
      /has no entries/u,
    );
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("release notes list feat and fix commits that shipped without a fragment", () => {
  const root = mkdtempSync(path.join(tmpdir(), "openpost-release-notes-commits-"));
  const git = (args) => execFileSync("git", args, { cwd: root, encoding: "utf8" }).trim();
  const commit = (message, files) => {
    for (const [name, content] of Object.entries(files)) {
      writeFileSync(path.join(root, name), content);
    }
    git(["add", "--all"]);
    git(["commit", "-m", message]);
  };
  try {
    git(["init"]);
    git(["config", "user.email", "release-notes-test@openpost.local"]);
    git(["config", "user.name", "OpenPost Release Notes Test"]);
    // Fixture history must not depend on the developer's signing setup.
    git(["config", "commit.gpgsign", "false"]);
    git(["config", "tag.gpgsign", "false"]);
    mkdirSync(path.join(root, "changes"), { recursive: true });
    commit("chore: base", {
      "CHANGELOG.md": "# Changelog\n\n## [Unreleased]\n\n## [1.0.0] - 2026-01-01\n",
      "changes/README.md": "# Changes fragments\n",
    });
    git(["tag", "v1.0.0"]);
    commit("fix(platform): skip refused portfolio edges (#524)", { "platform.txt": "1\n" });
    commit("feat: add a draft counter", { "composer.txt": "1\n" });
    // Covered three ways: its own fragment, an issue-named fragment, and a
    // later fragment commit for the same issue.
    commit("fix(api): keep retries bounded", {
      "api.txt": "1\n",
      "changes/api-retries.md": "### Fixed\n\n- Retries stay bounded.\n",
    });
    commit("fix(media): reject empty uploads (#7)", { "media.txt": "1\n" });
    commit("docs: note the upload rule", {
      "changes/7.md": "### Fixed\n\n- Empty uploads fail.\n",
    });
    commit("fix(bluesky): retry gallery storage (#9)", { "bluesky.txt": "1\n" });
    commit("docs(bluesky): describe galleries (#9)", {
      "changes/bluesky-gallery.md": "### Added\n\n- Bluesky galleries.\n",
    });
    // Exempt scope and opt-out trailer.
    commit("fix(ci): pin the scanner", { "ci.txt": "1\n" });
    commit("fix(server): clear lint\n\nChangelog: none", { "server.txt": "1\n" });
    git(["tag", "v1.0.1"]);

    const notes = execFileSync(process.execPath, [scriptPath, "v1.0.1"], {
      cwd: root,
      encoding: "utf8",
      env: { ...process.env, PATH: fakeGitHubBin(root) },
    });
    assert.equal(
      notes.trim(),
      [
        "## Fixed",
        "",
        "- Empty uploads fail.",
        "- Retries stay bounded.",
        "",
        "## Added",
        "",
        "- Bluesky galleries.",
        "",
        "## Other changes",
        "",
        "- **platform:** skip refused portfolio edges (#524)",
        "- add a draft counter",
      ].join("\n"),
    );
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
