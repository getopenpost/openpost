import assert from "node:assert/strict";
import test from "node:test";

import { selectAttemptArtifact } from "./ci-artifacts.mjs";

test("selects the newest successful artifact attempt after partial reruns", () => {
  assert.equal(
    selectAttemptArtifact(
      [
        { name: "release-manifest-revision-1", expired: false },
        { name: "frontend-public-revision-3", expired: false },
        { name: "release-manifest-revision-2", expired: true },
      ],
      "release-manifest-revision-",
    ),
    "release-manifest-revision-1",
  );
  assert.equal(
    selectAttemptArtifact(
      [
        { name: "frontend-public-revision-1", expired: false },
        { name: "frontend-public-revision-3", expired: false },
      ],
      "frontend-public-revision-",
    ),
    "frontend-public-revision-3",
  );
});

test("rejects missing, malformed, expired, or ambiguous latest artifacts", () => {
  assert.throws(
    () =>
      selectAttemptArtifact(
        [
          { name: "release-manifest-revision-0", expired: false },
          { name: "release-manifest-revision-1", expired: true },
        ],
        "release-manifest-revision-",
      ),
    /no current artifact/u,
  );
  assert.throws(
    () =>
      selectAttemptArtifact(
        [
          { name: "release-manifest-revision-3", expired: false },
          { name: "release-manifest-revision-3", expired: false },
        ],
        "release-manifest-revision-",
      ),
    /not uniquely identified/u,
  );
});
