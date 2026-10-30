import assert from "node:assert/strict";
import test from "node:test";
import { spawnSync } from "node:child_process";
import { balanceAppFiles, appShardFiles } from "./app-e2e-shards.mjs";
import { localJobCommand } from "./release-failures.mjs";

test("balances expensive files while assigning every file exactly once", () => {
  const files = ["a.spec.ts", "b.spec.ts", "c.spec.ts", "d.spec.ts"];
  const shards = balanceAppFiles(
    files,
    { "a.spec.ts": 9, "b.spec.ts": 7, "c.spec.ts": 3, "d.spec.ts": 1 },
    2,
  );
  assert.deepEqual(shards, [
    ["a.spec.ts", "d.spec.ts"],
    ["b.spec.ts", "c.spec.ts"],
  ]);
  assert.deepEqual(shards.flat().sort(), files);
  assert.deepEqual(
    balanceAppFiles(
      [...files].reverse(),
      { "a.spec.ts": 9, "b.spec.ts": 7, "c.spec.ts": 3, "d.spec.ts": 1 },
      2,
    ),
    shards,
  );
});

test("new files run with a median weight and stale timing entries cannot select files", () => {
  const files = ["new.spec.ts", "a.spec.ts", "b.spec.ts"];
  const shards = balanceAppFiles(
    files,
    { "a.spec.ts": 10, "b.spec.ts": 2, "deleted.spec.ts": 999 },
    2,
  );
  assert.deepEqual(shards, [["a.spec.ts"], ["b.spec.ts", "new.spec.ts"]]);
  assert.throws(() => balanceAppFiles(files, { "a.spec.ts": -1 }, 2), /duration/);
  assert.throws(() => balanceAppFiles([files[0], files[0]], {}, 2), /duplicate/);
});

test("real core shards cover the discovered inventory without overlaps", () => {
  const shards = Array.from({ length: 6 }, (_, i) => appShardFiles(`${i + 1}/6`));
  const inventory = appShardFiles("1/1");
  assert.deepEqual(shards.flat().sort(), inventory);
  assert.equal(new Set(shards.flat()).size, inventory.length);
  assert.ok(inventory.length > 100);
  assert.ok(inventory.every((file) => !file.endsWith("tool-draft-handoff.spec.ts")));
  assert.throws(() => appShardFiles("0/6"), /shard/);
  assert.throws(() => appShardFiles("1/0"), /shard/);
});

test(
  "Playwright executes exactly the full core inventory across CI and reproduction shards",
  { timeout: 120_000 },
  () => {
    const root = new URL("../", import.meta.url);
    function inventory(shard) {
      const result = spawnSync(
        "node",
        [
          "node_modules/@playwright/test/cli.js",
          "test",
          "--config",
          "tests/app/playwright.config.ts",
          "--list",
          "--reporter=json",
        ],
        {
          cwd: root,
          env: { ...process.env, OPENPOST_APP_E2E_SUITE: "core", OPENPOST_APP_E2E_SHARD: shard },
          encoding: "utf8",
          timeout: 15_000,
          maxBuffer: 12 * 1024 * 1024,
        },
      );
      assert.equal(result.status, 0, result.stderr || String(result.error));
      const report = JSON.parse(result.stdout);
      assert.deepEqual(report.errors, []);
      const identities = [];
      const files = new Set();
      function visit(suites) {
        for (const suite of suites) {
          for (const spec of suite.specs ?? []) {
            files.add(spec.file);
            for (const entry of spec.tests)
              identities.push(JSON.stringify([spec.id, entry.projectName]));
          }
          visit(suite.suites ?? []);
        }
      }
      visit(report.suites);
      if (shard) assert.deepEqual([...files].sort(), appShardFiles(shard));
      return identities;
    }
    const full = inventory("");
    const selected = Array.from({ length: 6 }, (_, index) => {
      const shard = `${index + 1}/6`;
      const command = localJobCommand(`Application browser suite (${shard})`);
      assert.ok(command.includes(`OPENPOST_APP_E2E_SUITE=core OPENPOST_APP_E2E_SHARD=${shard}`));
      return inventory(shard);
    }).flat();
    assert.ok(full.length > 100);
    assert.equal(new Set(selected).size, selected.length);
    assert.deepEqual(selected.sort(), full.sort());
  },
);
