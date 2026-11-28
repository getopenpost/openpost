import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";

import { commitsInRange, releaseCommitsMissingFragments } from "./changelog-coverage.mjs";

test("release coverage lists feat and fix commits that no fragment covers", () => {
  const root = mkdtempSync(path.join(tmpdir(), "openpost-changelog-coverage-"));
  const git = (args) => {
    const result = spawnSync("git", args, { cwd: root, encoding: "utf8" });
    assert.equal(result.status, 0, result.stderr);
    return result.stdout.trim();
  };
  const commit = (message, files = {}) => {
    for (const [name, content] of Object.entries(files)) {
      writeFileSync(path.join(root, name), content);
    }
    git(["add", "--all"]);
    git(["commit", "--allow-empty", "-m", message]);
  };
  try {
    git(["init"]);
    git(["config", "user.email", "changelog-coverage-test@openpost.local"]);
    git(["config", "user.name", "OpenPost Changelog Coverage Test"]);
    // Fixture history must not depend on the developer's signing setup.
    git(["config", "commit.gpgsign", "false"]);
    git(["config", "tag.gpgsign", "false"]);
    mkdirSync(path.join(root, "changes"));
    commit("chore: base", {
      "changes/README.md": "# Changes fragments\n",
      "changes/shipped.md": "### Fixed\n\n- Already released.\n",
    });
    git(["tag", "v1.0.0"]);

    commit("fix(platform): skip refused portfolio edges (#524)", { "platform.txt": "1\n" });
    commit("feat: add a draft counter", { "composer.txt": "1\n" });
    // Covered by its own fragment.
    commit("fix(api): keep retries bounded", {
      "api.txt": "1\n",
      "changes/api-retries.md": "### Fixed\n\n- Retries stay bounded.\n",
    });
    // Covered by a fragment named after its issue.
    commit("fix(media): reject empty uploads (#7)", {
      "media.txt": "1\n",
      "changes/7.md": "### Fixed\n\n- Empty uploads fail.\n",
    });
    commit("fix(composer): keep empty uploads out of drafts (#7)", { "drafts.txt": "1\n" });
    // Covered by a later fragment commit for the same issue.
    commit("fix(bluesky): retry gallery storage (#9)", { "bluesky.txt": "1\n" });
    commit("docs: add the gallery fragment for #9", {
      "changes/bluesky-gallery.md": "### Added\n\n- Bluesky galleries.\n",
    });
    // Removing a released fragment covers nothing.
    git(["rm", "--quiet", "changes/shipped.md"]);
    commit("fix(web): drop the shipped note");
    // Exempt scope and opt-out trailer.
    commit("fix(ci): pin the scanner", { "ci.txt": "1\n" });
    commit("fix(server): clear lint\n\nChangelog: none", { "server.txt": "1\n" });

    const missing = releaseCommitsMissingFragments(
      commitsInRange("v1.0.0", "HEAD", { cwd: root }),
      ["7.md", "api-retries.md", "bluesky-gallery.md"],
    );
    assert.deepEqual(
      missing.map((entry) => entry.subject),
      [
        "fix(web): drop the shipped note",
        "feat: add a draft counter",
        "fix(platform): skip refused portfolio edges (#524)",
      ],
    );
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
