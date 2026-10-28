import assert from "node:assert/strict";
import test from "node:test";
import { spawnSync } from "node:child_process";
import { copyFileSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

import {
  checkBrowserStorageInventory,
  extractBrowserStorageIdentifiers,
  findUndocumentedIdentifiers,
} from "./check-browser-storage-inventory.mjs";

test("the CLI checks the current source layout without an obsolete Pages functions directory", () => {
  const root = mkdtempSync(path.join(tmpdir(), "openpost-storage-layout-"));
  try {
    for (const directory of [
      "scripts",
      "apps/web/src",
      "apps/marketing/src",
      "apps/docs/app",
      "apps/docs/components",
      "apps/docs/lib",
      "apps/server/internal",
      "packages/legal-policy/src",
    ]) {
      mkdirSync(path.join(root, directory), { recursive: true });
    }
    copyFileSync(
      "scripts/check-browser-storage-inventory.mjs",
      path.join(root, "scripts/check-browser-storage-inventory.mjs"),
    );
    writeFileSync(
      path.join(root, "packages/legal-policy/src/privacy-inventory.json"),
      JSON.stringify({ browser_storage: [] }),
    );
    for (const app of ["web", "marketing"])
      writeFileSync(path.join(root, `apps/${app}/vite.config.ts`), "");
    const run = () =>
      spawnSync("bun", ["scripts/check-browser-storage-inventory.mjs"], {
        cwd: root,
        encoding: "utf8",
      });
    const clean = run();
    assert.equal(clean.status, 0, clean.stdout + clean.stderr);
    writeFileSync(
      path.join(root, "apps/marketing/src/storage.ts"),
      'localStorage.setItem("unlisted-key", "value");',
    );
    const dirty = run();
    assert.equal(dirty.status, 1, "undocumented storage must still fail the check");
    assert.match(
      dirty.stderr,
      /apps\/marketing\/src\/storage\.ts:1 localStorage exact "unlisted-key"/u,
    );
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("extracts exact and prefix identifiers from supported browser APIs", () => {
  const source = `
    const LOCAL_KEY = "openpost:exact";
    const PREFIX = "openpost:handoff:";
    const DB_NAME = "openpost-db";
    const ROOT = "openpost-root";
    const CACHE = "openpost-cache";
    function handoffKey() { return \`\${PREFIX}\${crypto.randomUUID()}\`; }
    localStorage.setItem(LOCAL_KEY, "1");
    sessionStorage.getItem(handoffKey());
    indexedDB.open(DB_NAME, 1);
    database.createObjectStore("records");
    caches.open(CACHE);
    root.getDirectoryHandle(ROOT, { create: true });
    document.cookie = \`sidebar:state=\${open}; path=/\`;
  `;
  const discoveries = extractBrowserStorageIdentifiers(source);
  assert.deepEqual(
    discoveries
      .map(({ technology, identifier_kind, identifier }) =>
        [technology, identifier_kind, identifier].join(":"),
      )
      .sort(),
    [
      "Cache Storage:exact:openpost-cache",
      "IndexedDB:exact:openpost-db",
      "IndexedDB:exact:records",
      "OPFS:exact:openpost-root",
      "cookie:exact:sidebar:state",
      "localStorage:exact:openpost:exact",
      "sessionStorage:prefix:openpost:handoff:",
    ],
  );
});

test("extracts a Go cookie name from a grouped constant", () => {
  const source = `
    const (
      bindingCookieName = "openpost_binding"
    )
    func bindingCookie() *http.Cookie {
      return &http.Cookie{Name: bindingCookieName, HttpOnly: true}
    }
  `;
  assert.deepEqual(
    extractBrowserStorageIdentifiers(source).map(
      ({ technology, identifier_kind, identifier }) =>
        `${technology}:${identifier_kind}:${identifier}`,
    ),
    ["cookie:exact:openpost_binding"],
  );
});

test("resolves a unique imported constant but not an ambiguous shared name", () => {
  const sources = [
    { file: "a.ts", source: `export const DB_NAME = "openpost-db";` },
    {
      file: "b.ts",
      source: `import { DB_NAME as DATABASE } from "./a"; import { STORAGE_KEY } from "./c"; indexedDB.open(DATABASE, 1); localStorage.getItem(STORAGE_KEY);`,
    },
    { file: "c.ts", source: `export const STORAGE_KEY = "one";` },
    { file: "d.ts", source: `export const STORAGE_KEY = "two";` },
  ];
  assert.deepEqual(
    checkBrowserStorageInventory(sources, []).discoveries.map(
      ({ technology, identifier }) => `${technology}:${identifier}`,
    ),
    ["IndexedDB:openpost-db"],
  );
});

test("does not treat an unrelated exported literal as a local function binding", () => {
  const sources = [
    { file: "unrelated.ts", source: `export const token = "wrong";` },
    {
      file: "handoff.ts",
      source: `
        const PREFIX = "openpost:handoff:";
        function key() { return \`\${PREFIX}\${token}\`; }
        sessionStorage.setItem(key(), "1");
      `,
    },
  ];
  const { discoveries } = checkBrowserStorageInventory(sources, []);
  assert.deepEqual(
    discoveries.map(({ identifier_kind, identifier }) => `${identifier_kind}:${identifier}`),
    ["prefix:openpost:handoff:"],
  );
});

test("an exact or matching prefix inventory row covers only its technology", () => {
  const discoveries = [
    {
      file: "a.ts",
      line: 1,
      technology: "localStorage",
      identifier_kind: "exact",
      identifier: "openpost:known",
    },
    {
      file: "a.ts",
      line: 2,
      technology: "sessionStorage",
      identifier_kind: "prefix",
      identifier: "openpost:handoff:",
    },
    {
      file: "a.ts",
      line: 3,
      technology: "localStorage",
      identifier_kind: "exact",
      identifier: "openpost:unknown",
    },
  ];
  discoveries.push(
    {
      file: "a.ts",
      line: 4,
      technology: "sessionStorage",
      identifier_kind: "exact",
      identifier: "openpost:known",
    },
    {
      file: "a.ts",
      line: 5,
      technology: "localStorage",
      identifier_kind: "exact",
      identifier: "openpost:handoff:token",
    },
  );
  const undocumented = findUndocumentedIdentifiers(discoveries, [
    {
      technology: "localStorage",
      identifier_kind: "exact",
      identifier: "openpost:known",
    },
    {
      technology: "sessionStorage",
      identifier_kind: "prefix",
      identifier: "openpost:handoff:",
    },
  ]);
  assert.deepEqual(
    undocumented.map(({ technology, identifier }) => [technology, identifier]),
    [
      ["localStorage", "openpost:unknown"],
      ["sessionStorage", "openpost:known"],
      ["localStorage", "openpost:handoff:token"],
    ],
  );
});
