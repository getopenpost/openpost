import assert from "node:assert/strict";
import test from "node:test";

import {
  parseChangelog,
  prepareReleaseChangelog,
  releaseNotesForTag,
  validateChangelog,
} from "./index.js";

const sample = `# Changelog

## [Unreleased]

### Changed

- Shared one control system.

## [1.2.3] - 2026-07-27

### Fixed

- Repaired the release.
`;

test("parses release sections and groups", () => {
  assert.deepEqual(parseChangelog(sample), [
    {
      label: "Unreleased",
      date: "",
      intro: [],
      groups: [{ title: "Changed", items: ["Shared one control system."] }],
    },
    {
      label: "1.2.3",
      date: "2026-07-27",
      intro: [],
      groups: [{ title: "Fixed", items: ["Repaired the release."] }],
    },
  ]);
  assert.deepEqual(validateChangelog(sample), []);
});

test("moves Unreleased into the target version", () => {
  const prepared = prepareReleaseChangelog(sample, "v1.2.4", "2026-07-28");
  assert.match(prepared, /## \[Unreleased\]\n\n## \[1\.2\.4\] - 2026-07-28/u);
  assert.match(prepared, /## \[1\.2\.3\] - 2026-07-27/u);
  assert.equal(
    releaseNotesForTag(prepared, "v1.2.4"),
    "## Changed\n\n- Shared one control system.",
  );
});

test("merges late fragments into an already prepared version", () => {
  const prepared = prepareReleaseChangelog(sample, "v1.2.4", "2026-07-28");
  const withLateChanges = prepared.replace(
    "## [Unreleased]",
    `## [Unreleased]

### Changed

- Kept linked edits together.

### Added

- Published the Android app.`,
  );
  const updated = prepareReleaseChangelog(withLateChanges, "v1.2.4", "2026-07-28");

  assert.equal(updated.match(/^## \[1\.2\.4\]/gmu)?.length, 1);
  assert.deepEqual(validateChangelog(updated), []);
  assert.equal(
    releaseNotesForTag(updated, "v1.2.4"),
    [
      "## Changed",
      "",
      "- Kept linked edits together.",
      "- Shared one control system.",
      "",
      "## Added",
      "",
      "- Published the Android app.",
    ].join("\n"),
  );
  assert.equal(prepareReleaseChangelog(updated, "v1.2.4", "2026-07-28"), updated);
  assert.doesNotMatch(updated, /\n\n$/u);
});

test("rejects empty and malformed release preparation", () => {
  assert.throws(
    () =>
      prepareReleaseChangelog(
        "# Changelog\n\n## [Unreleased]\n\n## [1.2.3] - 2026-07-27\n",
        "v1.2.4",
        "2026-07-28",
      ),
    /has no entries/u,
  );
  assert.throws(
    () => prepareReleaseChangelog(sample, "latest", "2026-07-28"),
    /stable release tag/u,
  );
});

test("carries a dated unshipped failed-candidate section into the replacement release", () => {
  // Real-world shape: prepare always stamps a date, so a failed candidate
  // looks shipped even though its GitHub release was never published.
  const withFailedCandidate = [
    "# Changelog",
    "",
    "## [Unreleased]",
    "",
    "## [6.0.0] - 2026-09-21",
    "",
    "### Changed",
    "",
    "- Big v6 change.",
    "",
    "### Removed",
    "",
    "- Dropped legacy reads.",
    "",
    "## [5.2.2] - 2026-09-20",
    "",
    "### Fixed",
    "",
    "- Old fix.",
    "",
  ].join("\n");
  const carried = prepareReleaseChangelog(withFailedCandidate, "v6.0.1", "2026-09-21", {
    publishedTag: "v5.2.2",
  });
  assert.doesNotMatch(carried, /^## \[6\.0\.0\]/mu);
  assert.match(carried, /^## \[6\.0\.1\] - 2026-09-21$/mu);
  assert.equal(
    releaseNotesForTag(carried, "v6.0.1"),
    ["## Changed", "", "- Big v6 change.", "", "## Removed", "", "- Dropped legacy reads."].join(
      "\n",
    ),
  );
  assert.deepEqual(validateChangelog(carried), []);
  assert.equal(
    prepareReleaseChangelog(carried, "v6.0.1", "2026-09-21", { publishedTag: "v5.2.2" }),
    carried,
  );
});

test("merges Unreleased fixes with a dated unshipped failed-candidate section", () => {
  const withFailedCandidate = [
    "# Changelog",
    "",
    "## [Unreleased]",
    "",
    "### Fixed",
    "",
    "- New patch fix.",
    "",
    "## [6.0.0] - 2026-09-21",
    "",
    "### Changed",
    "",
    "- Big v6 change.",
    "",
    "### Fixed",
    "",
    "- V6 fix.",
    "",
    "## [5.2.2] - 2026-09-20",
    "",
    "### Fixed",
    "",
    "- Old fix.",
    "",
  ].join("\n");
  const carried = prepareReleaseChangelog(withFailedCandidate, "v6.0.1", "2026-09-21", {
    publishedTag: "v5.2.2",
  });
  assert.doesNotMatch(carried, /^## \[6\.0\.0\]/mu);
  assert.equal(
    releaseNotesForTag(carried, "v6.0.1"),
    [
      "## Changed",
      "",
      "- Big v6 change.",
      "",
      "## Fixed",
      "",
      "- New patch fix.",
      "- V6 fix.",
    ].join("\n"),
  );
  assert.deepEqual(validateChangelog(carried), []);
});

test("leaves already-shipped sections alone", () => {
  const shipped = [
    "# Changelog",
    "",
    "## [Unreleased]",
    "",
    "### Fixed",
    "",
    "- New patch fix.",
    "",
    "## [6.0.0] - 2026-09-21",
    "",
    "### Changed",
    "",
    "- Big v6 change.",
    "",
    "## [5.2.2] - 2026-09-20",
    "",
    "### Fixed",
    "",
    "- Old fix.",
    "",
  ].join("\n");
  const prepared = prepareReleaseChangelog(shipped, "v6.0.1", "2026-09-21", {
    publishedTag: "v6.0.0",
  });
  assert.match(prepared, /^## \[6\.0\.0\] - 2026-09-21$/mu);
  assert.equal(releaseNotesForTag(prepared, "v6.0.1"), "## Fixed\n\n- New patch fix.");
  assert.deepEqual(validateChangelog(prepared), []);
});

test("merges stacked unshipped sections without duplicating groups", () => {
  const stacked = [
    "# Changelog",
    "",
    "## [Unreleased]",
    "",
    "## [6.0.0] - 2026-09-21",
    "",
    "### Fixed",
    "",
    "- V6 fix.",
    "",
    "## [5.1.1] - 2026-09-19",
    "",
    "### Fixed",
    "",
    "- Old browser fix.",
    "",
    "## [5.1.0] - 2026-09-19",
    "",
    "### Fixed",
    "",
    "- Older fix.",
    "",
  ].join("\n");
  const carried = prepareReleaseChangelog(stacked, "v6.0.1", "2026-09-21", {
    publishedTag: "v5.1.0",
  });
  assert.doesNotMatch(carried, /^## \[6\.0\.0\]/mu);
  assert.doesNotMatch(carried, /^## \[5\.1\.1\]/mu);
  assert.match(carried, /^## \[5\.1\.0\] - 2026-09-19$/mu);
  assert.equal(
    releaseNotesForTag(carried, "v6.0.1"),
    ["## Fixed", "", "- V6 fix.", "- Old browser fix."].join("\n"),
  );
  assert.deepEqual(validateChangelog(carried), []);
});
