import { describe, expect, test } from "bun:test";

import { createThemePreferenceStore } from "./preference-store";

describe("ThemePreferenceStore", () => {
  test("restores a valid device preference and notifies subscribers", async () => {
    const writes: string[] = [];
    const store = createThemePreferenceStore({
      get: async () => "dark",
      set: async (value) => {
        writes.push(value);
      },
    });
    let notifications = 0;
    store.subscribe(() => {
      notifications += 1;
    });

    expect(await store.load()).toBe("dark");
    expect(store.get()).toBe("dark");
    expect(notifications).toBe(1);
    expect(writes).toEqual([]);
  });

  test("uses system when persisted state is missing, invalid, or unavailable", async () => {
    for (const read of [
      async () => null,
      async () => "sepia",
      async () => {
        throw new Error("secure storage unavailable");
      },
    ]) {
      const store = createThemePreferenceStore({
        get: read,
        set: async () => {},
      });
      expect(await store.load()).toBe("system");
      expect(store.get()).toBe("system");
    }
  });

  test("publishes a saved preference only after secure persistence succeeds", async () => {
    const store = createThemePreferenceStore({
      get: async () => "light",
      set: async () => {
        throw new Error("device locked");
      },
    });
    await store.load();
    let notifications = 0;
    store.subscribe(() => {
      notifications += 1;
    });

    await expect(store.save("dark")).rejects.toThrow("device locked");
    expect(store.get()).toBe("light");
    expect(notifications).toBe(0);
  });

  test("stores system as an explicit preference", async () => {
    const writes: string[] = [];
    const store = createThemePreferenceStore({
      get: async () => "dark",
      set: async (value) => {
        writes.push(value);
      },
    });
    await store.load();

    await store.save("system");

    expect(writes).toEqual(["system"]);
    expect(store.get()).toBe("system");
  });
});
