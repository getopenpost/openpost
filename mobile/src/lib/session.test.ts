import { expect, test } from "bun:test";

import { loadSessionState, type SessionLoaders } from "./session";

test("restores the selected workspace before a signed-in session becomes ready", async () => {
  let workspaceId: string | null = null;
  const loaders: SessionLoaders = {
    loadServer: async () => undefined,
    loadToken: async () => undefined,
    loadWorkspaceId: async () => {
      workspaceId = "workspace-1";
    },
    getServer: () => ({ baseUrl: "https://app.openpo.st" }),
    getToken: () => "token",
    getWorkspaceId: () => workspaceId,
  };

  const session = await loadSessionState(loaders);

  expect(session).toEqual({
    serverReady: true,
    signedIn: true,
    workspaceId: "workspace-1",
  });
});
