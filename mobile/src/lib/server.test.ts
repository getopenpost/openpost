import { beforeEach, describe, expect, mock, test } from "bun:test";

const values = new Map<string, string>();

mock.module("expo-secure-store", () => ({
  getItemAsync: async (key: string) => values.get(key) ?? null,
  setItemAsync: async (key: string, value: string) => {
    values.set(key, value);
  },
  deleteItemAsync: async (key: string) => {
    values.delete(key);
  },
}));

const { HOSTED_URL, LEGACY_HOSTED_URL, loadServer, setServer } = await import("./server");

describe("server persistence", () => {
  beforeEach(() => values.clear());

  test("migrates only the exact former Hosted URL", async () => {
    await setServer(LEGACY_HOSTED_URL);

    expect(await loadServer()).toEqual({ baseUrl: HOSTED_URL, isHosted: true });
    expect(values.get("openpost.server.baseUrl")).toBe(HOSTED_URL);
  });

  test("preserves self-hosted servers", async () => {
    await setServer("https://social.example.com");

    expect(await loadServer()).toEqual({
      baseUrl: "https://social.example.com",
      isHosted: false,
    });
    expect(values.get("openpost.server.baseUrl")).toBe("https://social.example.com");
  });
});
