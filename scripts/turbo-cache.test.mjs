import assert from "node:assert/strict";
import { mkdir, mkdtemp, readFile, rm, stat, utimes, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import * as turboCache from "./turbo-cache.mjs";
import {
  formatPruneResult,
  pruneTurboCache,
  removeLegacyTurboCache,
  tryTurboCacheMaintenance,
  withTurboCacheLease,
  withTurboCacheLock,
  withTurboCacheMaintenance,
} from "./turbo-cache.mjs";

test("Turbo uses one bounded user cache across repository worktrees", () => {
  assert.equal(turboCache.defaultTurboCacheMaxMiB, 2048);
  assert.equal(
    turboCache.resolveTurboCacheDirectory({
      environment: { XDG_CACHE_HOME: "/var/cache/alice" },
      homeDirectory: "/home/alice",
      platform: "linux",
      repositoryRoot: "/work/openpost-feature",
    }),
    "/var/cache/alice/openpost/turbo",
  );
  assert.equal(
    turboCache.resolveTurboCacheDirectory({
      environment: { OPENPOST_TURBO_CACHE_DIR: "../shared-turbo" },
      homeDirectory: "/home/alice",
      platform: "linux",
      repositoryRoot: "/work/openpost-feature",
    }),
    "/work/shared-turbo",
  );
});

test("root Turbo commands use the bounded shared cache", () => {
  assert.deepEqual(
    turboCache.withTurboCacheDirectory(
      ["bunx", "turbo", "run", "build", "--filter", "@openpost/web"],
      "/var/cache/alice/openpost/turbo",
    ),
    [
      "bunx",
      "turbo",
      "run",
      "build",
      "--filter",
      "@openpost/web",
      "--cache-dir",
      "/var/cache/alice/openpost/turbo",
    ],
  );
  assert.deepEqual(turboCache.withTurboCacheDirectory(["go", "test", "./..."], "/cache"), [
    "go",
    "test",
    "./...",
  ]);
});

test("legacy per-worktree Turbo caches are removed once", async (t) => {
  const directory = await mkdtemp(path.join(os.tmpdir(), "openpost-turbo-cache-legacy-"));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const legacy = path.join(directory, ".turbo", "cache");
  await mkdir(legacy, { recursive: true });
  await writeFile(path.join(legacy, "entry.tar.zst"), "old", { flush: true });

  assert.equal(await removeLegacyTurboCache(legacy), true);
  await assert.rejects(stat(legacy), /ENOENT/u);
  assert.equal(await removeLegacyTurboCache(legacy), false);
});

function allocatedBytes(file) {
  return Number.isSafeInteger(file.blocks) && file.blocks > 0 ? file.blocks * 512 : file.size;
}

async function pathBytes(pathname) {
  return allocatedBytes(await stat(pathname));
}

async function entryBytes(directory, hash) {
  return (
    (await pathBytes(path.join(directory, `${hash}.tar.zst`))) +
    (await pathBytes(path.join(directory, `${hash}-manifest.json`))) +
    (await pathBytes(path.join(directory, `${hash}-meta.json`)))
  );
}

async function writeEntry(directory, hash, bytes, modifiedAt) {
  const files = [
    [`${hash}.tar.zst`, bytes],
    [`${hash}-manifest.json`, 32],
    [`${hash}-meta.json`, 32],
  ];
  for (const [name, size] of files) {
    const pathname = path.join(directory, name);
    await writeFile(pathname, Buffer.alloc(size));
    await utimes(pathname, modifiedAt, modifiedAt);
  }
}

test("Turbo cache pruning retains only the newest complete entries within the byte limit", async (t) => {
  const directory = await mkdtemp(path.join(os.tmpdir(), "openpost-turbo-cache-"));
  t.after(() => rm(directory, { recursive: true, force: true }));
  await writeEntry(directory, "1111111111111111", 700, new Date("2026-08-12T12:00:00Z"));
  await writeEntry(directory, "2222222222222222", 700, new Date("2026-08-13T12:00:00Z"));
  await writeEntry(directory, "3333333333333333", 700, new Date("2026-08-14T12:00:00Z"));
  const directoryBytes = await pathBytes(directory);
  const oldestBytes = await entryBytes(directory, "1111111111111111");
  const retainedBytes =
    (await entryBytes(directory, "2222222222222222")) +
    (await entryBytes(directory, "3333333333333333"));

  const result = await pruneTurboCache({
    directory,
    maxBytes: directoryBytes + retainedBytes,
  });

  assert.equal(result.beforeBytes, directoryBytes + retainedBytes + oldestBytes);
  assert.equal(result.afterBytes, directoryBytes + retainedBytes);
  assert.equal(result.removedEntries, 1);
  await assert.rejects(stat(path.join(directory, "1111111111111111.tar.zst")), /ENOENT/u);
  assert.equal((await stat(path.join(directory, "2222222222222222.tar.zst"))).size, 700);
  assert.equal((await stat(path.join(directory, "3333333333333333.tar.zst"))).size, 700);
});

test("Turbo cache pruning removes an entry that cannot fit under the hard limit", async (t) => {
  const directory = await mkdtemp(path.join(os.tmpdir(), "openpost-turbo-cache-"));
  t.after(() => rm(directory, { recursive: true, force: true }));
  await writeEntry(directory, "aaaaaaaaaaaaaaaa", 2000, new Date("2026-08-14T12:00:00Z"));
  const directoryBytes = await pathBytes(directory);

  const result = await pruneTurboCache({ directory, maxBytes: directoryBytes });

  assert.equal(result.afterBytes, directoryBytes);
  assert.equal(result.removedEntries, 1);
});

test("Turbo cache pruning preserves unknown files and accounts for their size", async (t) => {
  const directory = await mkdtemp(path.join(os.tmpdir(), "openpost-turbo-cache-"));
  t.after(() => rm(directory, { recursive: true, force: true }));
  await writeFile(path.join(directory, "README"), Buffer.alloc(800));
  await writeEntry(directory, "bbbbbbbbbbbbbbbb", 300, new Date("2026-08-14T12:00:00Z"));
  const fixedBytes =
    (await pathBytes(directory)) + (await pathBytes(path.join(directory, "README")));

  const result = await pruneTurboCache({ directory, maxBytes: fixedBytes });

  assert.equal((await readFile(path.join(directory, "README"))).length, 800);
  assert.equal(result.afterBytes, fixedBytes);
  assert.equal(result.removedEntries, 1);
});

test("Turbo cache pruning removes incomplete recognized entries even below the size limit", async (t) => {
  const directory = await mkdtemp(path.join(os.tmpdir(), "openpost-turbo-cache-"));
  t.after(() => rm(directory, { recursive: true, force: true }));
  await writeFile(path.join(directory, "cccccccccccccccc-manifest.json"), Buffer.alloc(32));
  const directoryBytes = await pathBytes(directory);
  const manifestBytes = await pathBytes(path.join(directory, "cccccccccccccccc-manifest.json"));

  const result = await pruneTurboCache({
    directory,
    maxBytes: directoryBytes + manifestBytes,
  });

  assert.equal(result.afterBytes, directoryBytes);
  assert.equal(result.removedEntries, 1);
  await assert.rejects(stat(path.join(directory, "cccccccccccccccc-manifest.json")), /ENOENT/u);
});

test("Turbo cache locking serializes cache maintenance and root task work", async (t) => {
  const directory = await mkdtemp(path.join(os.tmpdir(), "openpost-turbo-cache-lock-"));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const cacheDirectory = path.join(directory, "cache");
  const order = [];
  let markEntered;
  let releaseFirst;
  const entered = new Promise((resolve) => {
    markEntered = resolve;
  });
  const hold = new Promise((resolve) => {
    releaseFirst = resolve;
  });

  const first = withTurboCacheLock({ directory: cacheDirectory }, async () => {
    order.push("first:start");
    markEntered();
    await hold;
    order.push("first:end");
  });
  await entered;
  const second = withTurboCacheLock({ directory: cacheDirectory }, async () => {
    order.push("second:start");
    order.push("second:end");
  });
  await new Promise((resolve) => setTimeout(resolve, 25));
  assert.deepEqual(order, ["first:start"]);
  releaseFirst();
  await Promise.all([first, second]);

  assert.deepEqual(order, ["first:start", "first:end", "second:start", "second:end"]);
});

test("shared Turbo tasks overlap while cache maintenance waits", async (t) => {
  const directory = await mkdtemp(path.join(os.tmpdir(), "openpost-turbo-cache-leases-"));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const cacheDirectory = path.join(directory, "cache");
  const order = [];
  let releaseTasks;
  const holdTasks = new Promise((resolve) => {
    releaseTasks = resolve;
  });
  let markStarted;
  const bothStarted = new Promise((resolve) => {
    markStarted = resolve;
  });
  let started = 0;
  const task = (name) =>
    withTurboCacheLease({ directory: cacheDirectory }, async () => {
      order.push(`${name}:start`);
      started += 1;
      if (started === 2) markStarted();
      await holdTasks;
      order.push(`${name}:end`);
    });

  const first = task("first");
  const second = task("second");
  await bothStarted;
  const maintenance = withTurboCacheMaintenance({ directory: cacheDirectory }, async () => {
    order.push("maintenance");
  });
  await new Promise((resolve) => setTimeout(resolve, 25));
  assert.deepEqual(order.toSorted(), ["first:start", "second:start"]);
  releaseTasks();
  await Promise.all([first, second, maintenance]);
  assert.equal(order.at(-1), "maintenance");
  assert.deepEqual(order.slice(0, -1).toSorted(), [
    "first:end",
    "first:start",
    "second:end",
    "second:start",
  ]);
});

test("automatic Turbo cache maintenance skips work while another task is active", async (t) => {
  const directory = await mkdtemp(path.join(os.tmpdir(), "openpost-turbo-cache-try-"));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const cacheDirectory = path.join(directory, "cache");
  let releaseTask;
  const holdTask = new Promise((resolve) => {
    releaseTask = resolve;
  });
  let markStarted;
  const started = new Promise((resolve) => {
    markStarted = resolve;
  });
  const task = withTurboCacheLease({ directory: cacheDirectory }, async () => {
    markStarted();
    await holdTask;
  });

  await started;
  let maintenanceRuns = 0;
  assert.equal(
    await tryTurboCacheMaintenance({ directory: cacheDirectory }, async () => {
      maintenanceRuns += 1;
    }),
    false,
  );
  assert.equal(maintenanceRuns, 0);

  releaseTask();
  await task;
  assert.equal(
    await tryTurboCacheMaintenance({ directory: cacheDirectory }, async () => {
      maintenanceRuns += 1;
    }),
    true,
  );
  assert.equal(maintenanceRuns, 1);
});

test("automatic Turbo cache maintenance does not wait for another maintenance lock", async (t) => {
  const directory = await mkdtemp(path.join(os.tmpdir(), "openpost-turbo-cache-busy-"));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const cacheDirectory = path.join(directory, "cache");
  let releaseLock;
  const holdLock = new Promise((resolve) => {
    releaseLock = resolve;
  });
  let markLocked;
  const locked = new Promise((resolve) => {
    markLocked = resolve;
  });
  const maintenance = withTurboCacheLock({ directory: cacheDirectory }, async () => {
    markLocked();
    await holdLock;
  });
  await locked;

  const startedAt = performance.now();
  assert.equal(await tryTurboCacheMaintenance({ directory: cacheDirectory }, () => {}), false);
  assert.ok(performance.now() - startedAt < 100);

  releaseLock();
  await maintenance;
});
