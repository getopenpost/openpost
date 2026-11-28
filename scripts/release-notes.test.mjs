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
