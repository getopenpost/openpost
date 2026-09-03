import { describe, expect, test } from "bun:test";

import { createNativeThemeActivationStore } from "./activation-store";
import { createBuiltinThemeContract } from "./builtins";

describe("native theme activation store", () => {
  test("clears the old workspace theme before publishing a workspace transition", () => {
    const store = createNativeThemeActivationStore();
    const sessionScope = store.bindSession("server-1:session-1");
    const first = createBuiltinThemeContract({
      familyId: "studio",
      identity: "studio@1",
      workspaceId: "workspace-1",
    });
    const second = createBuiltinThemeContract({
      familyId: "notebook",
      identity: "notebook@1",
      workspaceId: "workspace-2",
    });

    expect(store.stage(first, null, sessionScope)).toBe(true);
    expect(store.get().contract).toBe(first);

    store.beginWorkspaceTransition("workspace-2");

    expect(store.get()).toEqual({
      contract: null,
      pendingWorkspaceId: "workspace-2",
      resources: null,
      sessionScope,
    });
    expect(store.stage(first, null, sessionScope)).toBe(false);
    store.cancelWorkspaceTransition("workspace-2");
    expect(store.get().contract).toBe(first);

    store.beginWorkspaceTransition("workspace-2");
    expect(store.stage(second, null, sessionScope)).toBe(true);
    expect(store.get()).toMatchObject({
      contract: second,
      pendingWorkspaceId: null,
      resources: null,
      sessionScope,
    });
  });

  test("does not stage a resource-backed contract with a partial resource set", () => {
    const store = createNativeThemeActivationStore();
    const sessionScope = store.bindSession("server-1:session-1");
    const base = createBuiltinThemeContract({
      familyId: "studio",
      identity: "studio@2",
      workspaceId: "workspace-1",
    });
    const contract = {
      ...base,
      resources: {
        identity: "studio@2:resources:asset-1",
        fonts: [],
        assets: [
          {
            id: "asset-1",
            slot: "background-texture" as const,
            sourceUrl: "/api/v1/theme-assets/asset-1/content?workspace_id=workspace-1",
            mimeType: "image/png" as const,
          },
        ],
      },
    };

    expect(store.stage(contract, null, sessionScope)).toBe(false);
    expect(
      store.stage(
        contract,
        {
          contractIdentity: contract.identity,
          resourceIdentity: contract.resources.identity,
          workspaceId: contract.workspaceId,
          fonts: {},
          assets: {},
        },
        sessionScope,
      ),
    ).toBe(false);
    expect(store.get().contract).toBeNull();
  });

  test("rejects a late theme response from an earlier signed-in session", () => {
    const store = createNativeThemeActivationStore();
    const oldScope = store.bindSession("server-1:session-1");
    const contract = createBuiltinThemeContract({
      familyId: "studio",
      identity: "studio@3",
      workspaceId: "workspace-1",
    });

    const currentScope = store.bindSession("server-1:session-2");

    expect(currentScope).not.toBe(oldScope);
    expect(store.stage(contract, null, oldScope)).toBe(false);
    expect(store.get().contract).toBeNull();
    expect(store.isCurrentSession("server-1:session-2")).toBe(true);
  });
});
