import assert from "node:assert/strict";
import test from "node:test";

import { expectedReleaseAssets } from "./release-assets.mjs";
import {
  releasePhases,
  requireConventionalCommitMessage,
  selectWorkflowRun,
  validateReleasePhase,
  validateReleaseTransition,
} from "./release-lifecycle.mjs";

const notes = "Release notes\n";

function release({
  draft = true,
  assets = expectedReleaseAssets,
  id = 42,
} = {}) {
  return {
    id,
    tag_name: "v4.0.0",
    name: "v4.0.0",
    draft,
    prerelease: false,
    body: notes,
    assets: assets.map((name) => ({ name, state: "uploaded", size: 1 })),
  };
}

test("release phases own draft completeness and publication invariants", () => {
  const incomplete = release({ assets: expectedReleaseAssets.slice(0, -1) });
  assert.deepEqual(
    validateReleasePhase(incomplete, {
      phase: releasePhases.draft,
      tag: "v4.0.0",
      notes,
    }),
    [],
  );
  assert.match(
    validateReleasePhase(incomplete, {
      phase: releasePhases.completeDraft,
      tag: "v4.0.0",
      notes,
    }).join("; "),
    /missing release asset/u,
  );
  assert.deepEqual(
    validateReleasePhase(release({ draft: false }), {
      phase: releasePhases.published,
      tag: "v4.0.0",
      notes,
    }),
    [],
  );
});

test("publication is one identity-preserving transition from a complete draft", () => {
  const before = release();
  const after = release({ draft: false });
  assert.deepEqual(
    validateReleaseTransition(before, after, {
      from: releasePhases.completeDraft,
      to: releasePhases.published,
      tag: "v4.0.0",
      notes,
    }),
    [],
  );
  assert.match(
    validateReleaseTransition(before, release({ draft: false, id: 43 }), {
      from: releasePhases.completeDraft,
      to: releasePhases.published,
      tag: "v4.0.0",
      notes,
    }).join("; "),
    /identity changed/u,
  );
});

test("local preparation and workflow selection share lifecycle decisions", () => {
  assert.equal(
    requireConventionalCommitMessage("feat(release): deepen lifecycle\n\nBody"),
    "feat(release): deepen lifecycle",
  );
  assert.throws(
    () => requireConventionalCommitMessage("release work"),
    /Conventional Commit/u,
  );
  assert.deepEqual(
    selectWorkflowRun(
      [
        {
          databaseId: 12,
          attempt: 2,
          headBranch: "main",
          status: "queued",
          conclusion: null,
        },
      ],
      { workflow: "CI", branch: "main", revision: "abc" },
    ),
    { id: "12", attempt: 2 },
  );
  assert.throws(
    () =>
      selectWorkflowRun(
        [
          {
            databaseId: 12,
            attempt: 2,
            headBranch: "main",
            status: "completed",
            conclusion: "failure",
          },
        ],
        { workflow: "CI", branch: "main", revision: "abc" },
      ),
    /CI failed for abc/u,
  );
});
