import assert from "node:assert/strict";
import test from "node:test";

import { selectAttemptArtifact } from "./ci-artifacts.mjs";

test("selects the newest successful artifact attempt after partial reruns", () => {
  assert.equal(
    selectAttemptArtifact(
      [
        { name: "image-digest-revision-1", expired: false },
        { name: "frontend-public-revision-3", expired: false },
        { name: "image-digest-revision-2", expired: true },
      ],
      "image-digest-revision-",
    ),
    "image-digest-revision-1",
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
          { name: "image-digest-revision-0", expired: false },
          { name: "image-digest-revision-1", expired: true },
        ],
        "image-digest-revision-",
      ),
    /no current artifact/u,
  );
  assert.throws(
    () =>
      selectAttemptArtifact(
        [
          { name: "image-digest-revision-3", expired: false },
          { name: "image-digest-revision-3", expired: false },
        ],
        "image-digest-revision-",
      ),
    /not uniquely identified/u,
  );
});
