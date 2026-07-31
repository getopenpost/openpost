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
