import { afterEach, expect, mock, test } from "bun:test";
import { act, createElement, useLayoutEffect } from "react";
import { create, type ReactTestRenderer } from "react-test-renderer";

const reads: {
  key: string;
  resolve: (value: string | null) => void;
  reject: () => void;
}[] = [];
const writes: [string, string][] = [];
let failWrites = false;
mock.module("expo-secure-store", () => ({
  getItemAsync: (key: string) =>
    new Promise<string | null>((resolve, reject) => {
      reads.push({
        key,
        resolve,
        reject: () => reject(new Error("Storage unavailable")),
      });
    }),
  setItemAsync: async (key: string, value: string) => {
    writes.push([key, value]);
    if (failWrites) throw new Error("Storage unavailable");
  },
}));
const { useRememberedView } = await import("./use-remembered-view");
const allowedValues = ["drafts", "calendar", "queue"] as const;
type View = (typeof allowedValues)[number];
let renderer: ReactTestRenderer | undefined;
let view: ReturnType<typeof useRememberedView<View>>;
Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });

function Probe({
  storageKey,
  onPersistError,
}: {
  storageKey: string;
  onPersistError?: () => void;
}) {
  const remembered = useRememberedView({ allowedValues, key: storageKey, onPersistError });
  useLayoutEffect(() => {
    view = remembered;
  });
  return null;
}
async function render(key: string, onPersistError?: () => void) {
  await act(async () => {
    const element = createElement(Probe, { storageKey: key, onPersistError });
    if (renderer) renderer.update(element);
    else renderer = create(element);
  });
}
async function load(value: string | null, index = reads.length - 1) {
  await act(async () => reads[index].resolve(value));
}
afterEach(async () => {
  await act(async () => renderer?.unmount());
  renderer = undefined;
  reads.length = 0;
  writes.length = 0;
  failWrites = false;
});

for (const stored of [null, "retired-view"]) {
  test(`switching from saved Calendar to ${stored === null ? "unset" : "invalid"} Workspace resets Drafts`, async () => {
    await render("posts-view-a");
    await load("calendar");
    expect(view.value).toBe("calendar");
    await render("posts-view-b");
    expect(view.value).toBe("drafts");
    expect(view.ready).toBe(false);
    await load(stored);
    expect(view.value).toBe("drafts");
    expect(view.ready).toBe(true);
  });
}

test("a new Workspace cannot persist until its own read completes", async () => {
  await render("posts-view-a");
  await load("calendar");
  await render("posts-view-b");
  await act(async () => view.select("queue"));
  expect(writes).toEqual([]);
  await load("drafts");
  await act(async () => view.select("calendar"));
  expect(writes).toEqual([["posts-view-b", "calendar"]]);
  expect(view.value).toBe("calendar");
});

test("out-of-order reads cannot overwrite the current Workspace", async () => {
  await render("posts-view-a");
  await render("posts-view-b");
  await load("queue", 1);
  await load("calendar", 0);
  expect(view.value).toBe("queue");
  expect(view.ready).toBe(true);
});

test("an old read cannot unlock writes while the current Workspace is loading", async () => {
  await render("posts-view-a");
  await render("posts-view-b");
  await load("calendar", 0);
  expect(view.value).toBe("drafts");
  expect(view.ready).toBe(false);
  await act(async () => view.select("queue"));
  expect(writes).toEqual([]);
});

test("a failed current read resets to Drafts and permits subsequent selections", async () => {
  await render("posts-view-a");
  await load("calendar");
  await render("posts-view-b");
  await act(async () => reads[1].reject());
  expect(view.value).toBe("drafts");
  expect(view.ready).toBe(true);
  await act(async () => view.select("queue"));
  expect(writes).toEqual([["posts-view-b", "queue"]]);
});

test("select stays stable when the selected value changes", async () => {
  await render("posts-view-a");
  await load("drafts");
  const select = view.select;
  await act(async () => select("calendar"));
  expect(view.select).toBe(select);
});

test("returning to a Workspace reloads its saved view without accepting its abandoned read", async () => {
  await render("posts-view-a");
  await render("posts-view-b");
  await load("calendar", 1);
  await render("posts-view-a");
  expect(view.value).toBe("drafts");
  expect(view.ready).toBe(false);
  await load("calendar", 0);
  expect(view.ready).toBe(false);
  await load("queue", 2);
  expect(view.value).toBe("queue");
  expect(view.ready).toBe(true);
});

test("a previous Workspace selection callback cannot replace the current view", async () => {
  await render("posts-view-a");
  await load("drafts");
  const oldSelect = view.select;
  await render("posts-view-b");
  await load("calendar");
  await act(async () => oldSelect("queue"));
  expect(view.value).toBe("calendar");
  expect(view.ready).toBe(true);
});

test("a callback from an abandoned Workspace visit cannot write during a later visit", async () => {
  await render("posts-view-a");
  await load("drafts");
  const abandonedSelect = view.select;
  await render("posts-view-b");
  await load("calendar");
  await render("posts-view-a");
  await act(async () => abandonedSelect("queue"));
  expect(view.value).toBe("drafts");
  expect(view.ready).toBe(false);
  expect(writes).toEqual([]);
  await load("calendar");
  expect(view.value).toBe("calendar");
});

test("a failed persistence reports the error without undoing the current selection", async () => {
  let failures = 0;
  await render("posts-view-a", () => {
    failures += 1;
  });
  await load("drafts");
  failWrites = true;
  await act(async () => view.select("queue"));
  expect(failures).toBe(1);
  expect(view.value).toBe("queue");
  expect(view.ready).toBe(true);
  expect(writes).toEqual([["posts-view-a", "queue"]]);
});
