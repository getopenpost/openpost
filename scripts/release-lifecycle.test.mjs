import assert from "node:assert/strict";
import test from "node:test";
import { requireConventionalCommitMessage, selectWorkflowRun } from "./release-lifecycle.mjs";

test("local preparation and workflow selection share lifecycle decisions", () => {
  assert.equal(
    requireConventionalCommitMessage("feat(release): deepen lifecycle\n\nBody"),
    "feat(release): deepen lifecycle",
  );
  assert.throws(() => requireConventionalCommitMessage("release work"), /Conventional Commit/u);
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
