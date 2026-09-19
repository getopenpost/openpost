import assert from "node:assert/strict";
import { mkdtemp, mkdir, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import { isQueryAdapter, lineAt, sourceFiles } from "./check-query-shared.mjs";

async function fixture() {
  const root = await mkdtemp(path.join(os.tmpdir(), "check-query-shared-"));
  await mkdir(path.join(root, "nested", ".hidden"), { recursive: true });
  await writeFile(path.join(root, "a.ts"), "const a = 1;\n");
  await writeFile(path.join(root, "b.svelte"), "<p>hi</p>\n");
  await writeFile(path.join(root, "c.mjs"), "export {};\n");
  await writeFile(path.join(root, "nested", "d.tsx"), "export {};\n");
  await writeFile(path.join(root, "nested", ".hidden", "e.ts"), "export {};\n");
  return root;
}

test("sourceFiles walks supported extensions and skips dot directories", async () => {
  const root = await fixture();
  const found = sourceFiles(root)
    .map((file) => path.relative(root, file))
    .sort();
  assert.deepEqual(found, ["a.ts", "b.svelte", path.join("nested", "d.tsx")]);
});

test("sourceFiles honors extension and directory overrides", async () => {
  const root = await fixture();
  await mkdir(path.join(root, "node_modules"), { recursive: true });
  await writeFile(path.join(root, "node_modules", "dep.svelte"), "<p>x</p>\n");
  const svelteOnly = sourceFiles(root, {
    extensions: new Set([".svelte"]),
    skipDirectoryNames: ["node_modules"],
  })
    .map((file) => path.relative(root, file))
    .sort();
  assert.deepEqual(svelteOnly, ["b.svelte"]);
});

test("lineAt reports 1-based line numbers", () => {
  assert.equal(lineAt("a\nb\nc\n", 0), 1);
  assert.equal(lineAt("a\nb\nc\n", 2), 2);
  assert.equal(lineAt("a\nb\nc\n", 4), 3);
});

test("isQueryAdapter matches adapter paths and skips tests", () => {
  assert.equal(isQueryAdapter("apps/web/src/lib/query/accounts.ts"), true);
  assert.equal(isQueryAdapter("apps/mobile/src/lib/query-api.ts"), true);
  assert.equal(isQueryAdapter("apps/web/src/lib/query/accounts.test.ts"), false);
  assert.equal(isQueryAdapter("apps/web/src/lib/stores/auth.ts"), false);
});
