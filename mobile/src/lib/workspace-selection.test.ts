import { expect, test } from "bun:test";

import { automaticWorkspaceId } from "./workspace-selection";

test("automatic workspace selection runs only once after a persistence failure", () => {
  const input = {
    storedWorkspaceId: "workspace-1",
    switching: false,
    selectionPending: false,
    workspaces: [{ id: "workspace-1" }],
  };

  expect(automaticWorkspaceId({ ...input, automaticSelectionAttempted: false })).toBe(
    "workspace-1",
  );
  expect(automaticWorkspaceId({ ...input, automaticSelectionAttempted: true })).toBeNull();
});
