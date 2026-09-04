import assert from "node:assert/strict";
import { execFileSync, spawnSync } from "node:child_process";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const scriptPath = fileURLToPath(new URL("./merge-changelog-fragments.mjs", import.meta.url));
const checkScriptPath = fileURLToPath(new URL("./check-changelog.mjs", import.meta.url));
const prepareScriptPath = fileURLToPath(
  new URL("./prepare-release-changelog.mjs", import.meta.url),
);

test("keeps the fragment instructions out of release notes", async (t) => {
  const root = await mkdtemp(path.join(os.tmpdir(), "openpost-changelog-fragments-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  await mkdir(path.join(root, "changes"));
  await Promise.all([
    writeFile(
      path.join(root, "CHANGELOG.md"),
      "# Changelog\n\n## [Unreleased]\n\n### Fixed\n\n- Kept the existing item.\n\n## [1.0.0]\n",
    ),
    writeFile(
      path.join(root, "changes", "README.md"),
      "# Changes fragments\n\n### Fixed\n- Describe the user-visible fix.\n",
    ),
    writeFile(
      path.join(root, "changes", "123.md"),
      "### Fixed\n\n- Fixed the real issue.\n\n### Changed\n\n- Changed the real workflow.\n",
    ),
  ]);

  execFileSync(process.execPath, [scriptPath], { cwd: root });

  const [changelog, instructions] = await Promise.all([
    readFile(path.join(root, "CHANGELOG.md"), "utf8"),
    readFile(path.join(root, "changes", "README.md"), "utf8"),
  ]);
  assert.match(changelog, /Fixed the real issue\./u);
  assert.match(changelog, /### Fixed\n\n- Fixed the real issue\./u);
  assert.match(changelog, /### Changed\n\n- Changed the real workflow\./u);
  assert.doesNotMatch(changelog, /Describe the user-visible fix\./u);
  assert.match(instructions, /Describe the user-visible fix\./u);
  await assert.rejects(readFile(path.join(root, "changes", "123.md")), /ENOENT/u);
});
