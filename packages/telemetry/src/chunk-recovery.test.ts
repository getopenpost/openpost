import { describe, expect, it, vi } from "vitest";
import {
  createChunkRecovery,
  extractFirstPartyAssetPath,
  isChunkLoadError,
  isUnsupportedBrowserError,
  type ChunkRecoveryBudget,
  type ManualRecoveryInfo,
} from "./chunk-recovery";

const staleMessage =
  "Failed to fetch dynamically imported module: https://marketing.openpo.st/_app/immutable/chunks/old.js?x=1#frag";
const firefoxStaleMessage =
  "error loading dynamically imported module: https://openpo.st/_app/immutable/chunks/C_lq0IyJ.js";

function fakeRuntime(overrides: Record<string, unknown> = {}) {
  const budget: { current: ChunkRecoveryBudget | null; writes: ChunkRecoveryBudget[] } = {
    current: null,
    writes: [],
  };
  const state = {
    reloads: [] as number[],
    manuals: [] as ManualRecoveryInfo[],
    statusByPath: new Map<string, number | null>(),
    throwOnStorage: false,
    online: true,
    budget,
  };
  const runtime = {
    online: () => state.online,
    fetchAssetStatus: async (pathname: string) => state.statusByPath.get(pathname) ?? null,
    loadBudget: () => {
      if (state.throwOnStorage) throw new Error("Storage unavailable");
      return state.budget.current;
    },
    saveBudget: (next: ChunkRecoveryBudget) => {
      if (state.throwOnStorage) throw new Error("Storage unavailable");
      state.budget.current = next;
      state.budget.writes.push(next);
    },
    scheduleReload: (delayMs: number) => {
      state.reloads.push(delayMs);
    },
    notifyManual: (info: ManualRecoveryInfo) => {
      state.manuals.push(info);
    },
    ...overrides,
  };
  return { runtime, state };
}

describe("chunk failure classification", () => {
  it("matches stale import messages without treating them as deployment proof", () => {
    expect(isChunkLoadError(new Error(staleMessage))).toBe(true);
    expect(isChunkLoadError("Importing a module script failed")).toBe(true);
    expect(isChunkLoadError(new Error("Failed to fetch /_app/immutable/chunk.js"))).toBe(true);
    expect(isChunkLoadError(new Error("Failed to load url /_app/immutable/nodes/2.js"))).toBe(true);
    // Firefox wording for the same stale-deployment failure.
    expect(isChunkLoadError(new Error(firefoxStaleMessage))).toBe(true);
    expect(isChunkLoadError(new Error(" ordinary TypeError "))).toBe(false);
  });

  it("never routes unsupported-browser syntax failures to recovery", () => {
    const lookbehind = new SyntaxError("Invalid regular expression: invalid group specifier name");
    expect(isUnsupportedBrowserError(lookbehind)).toBe(true);
    expect(isUnsupportedBrowserError(new TypeError(staleMessage))).toBe(false);
  });

  it("keeps only a first-party immutable asset pathname and strips queries", () => {
    expect(extractFirstPartyAssetPath(staleMessage)).toBe("/_app/immutable/chunks/old.js");
    expect(extractFirstPartyAssetPath(firefoxStaleMessage)).toBe(
      "/_app/immutable/chunks/C_lq0IyJ.js",
    );
    expect(extractFirstPartyAssetPath("Failed to fetch dynamically imported module")).toBe(null);
    expect(
      extractFirstPartyAssetPath(
        "Failed to fetch https://cdn.evil.test/evil.js with /_app/immutable/ nearby",
      ),
    ).toBe(null);
    expect(extractFirstPartyAssetPath("Failed to fetch /_app/immutable/chunk.css")).toBe(
      "/_app/immutable/chunk.css",
    );
  });
});

describe("bounded chunk recovery", () => {
  it("makes one recovery decision when one failure arrives through every source", async () => {
    const { runtime, state } = fakeRuntime();
    state.statusByPath.set("/_app/immutable/chunks/old.js", 404);
    const controller = createChunkRecovery(runtime);
    const error = new TypeError(staleMessage);

    const [first, second, third] = await Promise.all([
      controller.recover(error),
      controller.recover(error),
      controller.recover(new TypeError(staleMessage)),
    ]);

    expect(first.kind).toBe("reloaded");
    expect(second.kind).toBe("reloaded");
    expect(third.kind).toBe("reloaded");
    expect(state.reloads).toHaveLength(1);
    expect(state.budget.current).toEqual({
      total: 1,
      perAsset: { "/_app/immutable/chunks/old.js": 1 },
    });
  });

  it("reloads once per failing asset and stays bounded overall", async () => {
    // Each simulated document gets its own controller but shares the
    // persisted budget, mirroring real reloads across documents.
    const shared: { current: ChunkRecoveryBudget | null } = { current: null };
    const statuses = new Map([
      ["/_app/immutable/chunks/a.js", 404],
      ["/_app/immutable/chunks/b.js", 404],
    ]);
    const document = () => {
      const { runtime, state } = fakeRuntime({
        loadBudget: () => shared.current,
        saveBudget: (next: ChunkRecoveryBudget) => {
          shared.current = next;
        },
      });
      state.statusByPath = statuses;
      return { controller: createChunkRecovery(runtime), state };
    };

    const first = document();
    expect(
      (
        await first.controller.recover(
          new TypeError("Failed to fetch dynamically imported module: /_app/immutable/chunks/a.js"),
        )
      ).kind,
    ).toBe("reloaded");
    // Same document, same failure: single-flight, not a second reload.
    expect(
      (
        await first.controller.recover(
          new TypeError("Failed to fetch dynamically imported module: /_app/immutable/chunks/a.js"),
        )
      ).kind,
    ).toBe("reloaded");
    expect(first.state.reloads).toHaveLength(1);

    // Next document, same asset: the pair budget is spent, so recovery
    // becomes an explicit retry. Eligibility never resets with time.
    const second = document();
    const repeat = await second.controller.recover(
      new TypeError("Failed to fetch dynamically imported module: /_app/immutable/chunks/a.js"),
    );
    expect(repeat.kind).toBe("manual");
    expect(repeat).toMatchObject({ reason: "budget-exhausted" });

    const third = document();
    expect(
      (
        await third.controller.recover(
          new TypeError("Failed to fetch dynamically imported module: /_app/immutable/chunks/b.js"),
        )
      ).kind,
    ).toBe("reloaded");
    expect(shared.current).toEqual({
      total: 2,
      perAsset: {
        "/_app/immutable/chunks/a.js": 1,
        "/_app/immutable/chunks/b.js": 1,
      },
    });
  });

  it("shows manual recovery instead of reloading when storage is unavailable", async () => {
    const { runtime, state } = fakeRuntime();
    state.throwOnStorage = true;
    state.statusByPath.set("/_app/immutable/chunks/old.js", 404);
    const controller = createChunkRecovery(runtime);

    const decision = await controller.recover(new TypeError(staleMessage));
    expect(decision.kind).toBe("manual");
    expect(decision).toMatchObject({ reason: "unpersistable" });
    expect(state.reloads).toHaveLength(0);
    expect(state.manuals).toHaveLength(1);
  });

  it("keeps offline, same-build, and unclassified failures visible without reloading", async () => {
    const offline = fakeRuntime();
    offline.state.statusByPath.set("/_app/immutable/chunks/old.js", 404);
    offline.state.online = false;
    const offlineDecision = await createChunkRecovery(offline.runtime).recover(
      new TypeError(staleMessage),
    );
    expect(offlineDecision).toMatchObject({ kind: "manual", reason: "offline" });

    const sameBuild = fakeRuntime({
      runningBuild: "abc",
      fetchCurrentBuild: async () => "abc",
    });
    const sameBuildDecision = await createChunkRecovery(sameBuild.runtime).recover(
      new TypeError("Failed to fetch dynamically imported module"),
    );
    expect(sameBuildDecision).toMatchObject({ kind: "manual", reason: "same-build" });

    const unclassified = fakeRuntime();
    const unclassifiedDecision = await createChunkRecovery(unclassified.runtime).recover(
      new TypeError("Failed to fetch dynamically imported module"),
    );
    expect(unclassifiedDecision).toMatchObject({ kind: "manual", reason: "unclassified" });

    expect(offline.state.reloads).toHaveLength(0);
    expect(sameBuild.state.reloads).toHaveLength(0);
    expect(unclassified.state.reloads).toHaveLength(0);
  });

  it("reloads on a verified build change and protects dirty editors", async () => {
    const mismatched = fakeRuntime({
      runningBuild: "build-a",
      fetchCurrentBuild: async () => "build-b",
    });
    const reload = await createChunkRecovery(mismatched.runtime).recover(
      new TypeError("Failed to fetch dynamically imported module"),
    );
    expect(reload.kind).toBe("reloaded");
    expect(mismatched.state.reloads).toHaveLength(1);

    const dirty = fakeRuntime({
      canAutoReload: () => false,
      fetchCurrentBuild: async () => {
        throw new Error("must not probe when manual");
      },
    });
    dirty.state.statusByPath.set("/_app/immutable/chunks/old.js", 404);
    const gated = await createChunkRecovery(dirty.runtime).recover(new TypeError(staleMessage));
    expect(gated).toMatchObject({ kind: "manual", reason: "manual-policy" });
    expect(dirty.state.reloads).toHaveLength(0);
  });

  it("treats a missing asset as deployment skew and an unprobed failure as unknown", async () => {
    const gone = fakeRuntime();
    gone.state.statusByPath.set("/_app/immutable/chunks/old.js", 404);
    expect(
      (await createChunkRecovery(gone.runtime).recover(new TypeError(staleMessage))).kind,
    ).toBe("reloaded");

    const unknown = fakeRuntime();
    unknown.state.statusByPath.set("/_app/immutable/chunks/old.js", null);
    const decision = await createChunkRecovery(unknown.runtime).recover(
      new TypeError(staleMessage),
    );
    expect(decision).toMatchObject({ kind: "manual", reason: "probe-failed" });
    expect(unknown.state.reloads).toHaveLength(0);
  });

  it("reloads URL-less failures once per running build after a verified deployment change", async () => {
    const urlLess = () => new TypeError("Importing a module script failed.");
    const shared: { current: ChunkRecoveryBudget | null } = { current: null };
    const document = (runningBuild: string) => {
      const { runtime, state } = fakeRuntime({
        runningBuild,
        checkForUpdate: async () => true,
        loadBudget: () => shared.current,
        saveBudget: (next: ChunkRecoveryBudget) => {
          shared.current = next;
        },
      });
      return { controller: createChunkRecovery(runtime), state };
    };

    expect((await document("rev-a").controller.recover(urlLess())).kind).toBe("reloaded");
    // Same running build, same evidence: the pair budget is spent.
    const repeat = await document("rev-a").controller.recover(urlLess());
    expect(repeat.kind).toBe("manual");
    expect(repeat).toMatchObject({ reason: "budget-exhausted" });
    // A later running build that goes stale gets its own single attempt.
    expect((await document("rev-b").controller.recover(urlLess())).kind).toBe("reloaded");
    expect(shared.current).toEqual({
      total: 2,
      perAsset: { "stale-update:rev-a": 1, "stale-update:rev-b": 1 },
    });
  });

  it("keeps the explicit retry when the deployment check reports no change", async () => {
    const checkForUpdate = vi.fn(async () => false);
    const { runtime, state } = fakeRuntime({ checkForUpdate });
    const decision = await createChunkRecovery(runtime).recover(
      new TypeError("Importing a module script failed."),
    );
    expect(decision).toMatchObject({ kind: "manual", reason: "same-build" });
    expect(checkForUpdate).toHaveBeenCalledOnce();
    expect(state.reloads).toHaveLength(0);
  });

  it("stays unclassified when the deployment check itself fails", async () => {
    for (const checkForUpdate of [
      async () => null,
      async () => Promise.reject(new Error("offline")),
    ]) {
      const { runtime, state } = fakeRuntime({ checkForUpdate });
      const decision = await createChunkRecovery(runtime).recover(
        new TypeError("Importing a module script failed."),
      );
      expect(decision).toMatchObject({ kind: "manual", reason: "unclassified" });
      expect(state.reloads).toHaveLength(0);
    }
  });

  it("never consults the deployment check when an asset probe applies", async () => {
    const checkForUpdate = vi.fn(async () => true);
    const { runtime, state } = fakeRuntime({ checkForUpdate });
    state.statusByPath.set("/_app/immutable/chunks/old.js", 404);
    const decision = await createChunkRecovery(runtime).recover(new TypeError(staleMessage));
    expect(decision.kind).toBe("reloaded");
    expect(checkForUpdate).not.toHaveBeenCalled();
  });

  it("ignores lookbehind syntax failures instead of reloading the same bytes", async () => {
    const { runtime, state } = fakeRuntime();
    const decision = await createChunkRecovery(runtime).recover(
      new SyntaxError("Invalid regular expression: invalid group specifier name"),
    );
    expect(decision).toMatchObject({ kind: "ignored", reason: "unsupported-browser" });
    expect(state.reloads).toHaveLength(0);
    expect(state.manuals).toHaveLength(0);
  });

  it("never cancels the preload event, so rejected imports stay rejected", async () => {
    const target = new EventTarget();
    const previousWindow = (globalThis as { window?: unknown }).window;
    (globalThis as { window?: unknown }).window = target;
    try {
      const { runtime, state } = fakeRuntime();
      state.statusByPath.set("/_app/immutable/chunks/old.js", 404);
      const dispose = createChunkRecovery(runtime).install();
      const event = new Event("vite:preloadError", { cancelable: true });
      (event as Event & { payload?: unknown }).payload = new TypeError(staleMessage);
      const preventDefault = vi.spyOn(event, "preventDefault");
      target.dispatchEvent(event);
      await vi.waitFor(() => expect(state.reloads).toHaveLength(1));
      // Recovery proceeds separately while the rejection stays intact for
      // SvelteKit's error boundary.
      expect(preventDefault).not.toHaveBeenCalled();
      expect(event.defaultPrevented).toBe(false);
      dispose();
    } finally {
      if (previousWindow === undefined) delete (globalThis as { window?: unknown }).window;
      else (globalThis as { window?: unknown }).window = previousWindow;
    }
  });
});
