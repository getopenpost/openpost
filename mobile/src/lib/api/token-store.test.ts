import { beforeEach, describe, expect, mock, test } from "bun:test";

const values = new Map<string, string>();
let rejectedSetKey: string | null = null;
let rejectedDeleteKey: string | null = null;

mock.module("expo-secure-store", () => ({
  getItemAsync: async (key: string) => values.get(key) ?? null,
  setItemAsync: async (key: string, value: string) => {
    if (key === rejectedSetKey) throw new Error("secure storage unavailable");
    values.set(key, value);
  },
  deleteItemAsync: async (key: string) => {
    if (key === rejectedDeleteKey) throw new Error("secure storage unavailable");
    values.delete(key);
  },
}));

const { clearToken, getToken, getWorkspaceId, saveToken, saveWorkspaceId } =
  await import("./token-store");

describe("workspace persistence", () => {
  beforeEach(async () => {
    values.clear();
    rejectedSetKey = null;
    rejectedDeleteKey = null;
    await saveToken("token-1");
    await saveWorkspaceId("workspace-1");
  });

  test("keeps the current workspace when secure persistence fails", async () => {
    rejectedSetKey = "openpost.workspace.id";

    await expect(saveWorkspaceId("workspace-2")).rejects.toThrow("secure storage unavailable");

    expect(getWorkspaceId()).toBe("workspace-1");
    expect(values.get("openpost.workspace.id")).toBe("workspace-1");
  });

  test("keeps the current in-memory session when a replacement token cannot persist", async () => {
    rejectedSetKey = "openpost.auth.token";

    await expect(saveToken("token-2")).rejects.toThrow("secure storage unavailable");

    expect(getToken()).toBe("token-1");
    expect(getWorkspaceId()).toBe("workspace-1");
    expect(values.get("openpost.auth.token")).toBe("token-1");
    expect(values.has("openpost.workspace.id")).toBe(false);
  });

  test("clears the live session even when secure deletion fails", async () => {
    rejectedDeleteKey = "openpost.auth.token";

    await clearToken();

    expect(getToken()).toBeNull();
    expect(getWorkspaceId()).toBeNull();
    expect(values.has("openpost.workspace.id")).toBe(false);
  });
});
