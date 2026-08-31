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

test("release preparation rejects malformed fragments without deleting them", async (t) => {
  const root = await mkdtemp(path.join(os.tmpdir(), "openpost-changelog-fragments-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  await mkdir(path.join(root, "changes"));
  const changelog = "# Changelog\n\n## [Unreleased]\n\n## [1.0.0] - 2026-08-01\n";
  await Promise.all([
    writeFile(path.join(root, "CHANGELOG.md"), changelog),
    writeFile(path.join(root, "changes", "123.md"), "### Fixed\n\n- Fixed one issue.\n"),
    writeFile(
      path.join(root, "changes", "124.md"),
      "fix: this format would previously be discarded\n",
    ),
  ]);

  const result = spawnSync(process.execPath, [prepareScriptPath, "v1.0.1", "2026-08-28"], {
    cwd: root,
    encoding: "utf8",
  });

  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /124\.md must contain only ### groups and bullet items/u);
  assert.equal(await readFile(path.join(root, "CHANGELOG.md"), "utf8"), changelog);
  assert.match(await readFile(path.join(root, "changes", "123.md"), "utf8"), /Fixed one/u);
  assert.match(await readFile(path.join(root, "changes", "124.md"), "utf8"), /discarded/u);
});

test("the routine changelog check rejects malformed pending fragments", async (t) => {
  const root = await mkdtemp(path.join(os.tmpdir(), "openpost-changelog-fragments-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  await mkdir(path.join(root, "changes"));
  await Promise.all([
    writeFile(
      path.join(root, "CHANGELOG.md"),
      "# Changelog\n\n## [Unreleased]\n\n## [1.0.0] - 2026-08-01\n",
    ),
    writeFile(path.join(root, "changes", "123.md"), "---\ntype: fixed\n---\n\nBad format.\n"),
  ]);

  const result = spawnSync(process.execPath, [checkScriptPath], {
    cwd: root,
    encoding: "utf8",
  });

  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /123\.md must contain only ### groups and bullet items/u);
  assert.match(await readFile(path.join(root, "changes", "123.md"), "utf8"), /Bad format/u);
});
