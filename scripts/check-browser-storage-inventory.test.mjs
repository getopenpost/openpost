import assert from "node:assert/strict";
import test from "node:test";

import {
  checkBrowserStorageInventory,
  collectGlobalBindings,
  extractBrowserStorageIdentifiers,
  findUndocumentedIdentifiers,
} from "./check-browser-storage-inventory.mjs";

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
      source: `import { DB_NAME as DATABASE } from "./a"; indexedDB.open(DATABASE, 1);`,
    },
    { file: "c.ts", source: `export const STORAGE_KEY = "one";` },
    { file: "d.ts", source: `export const STORAGE_KEY = "two";` },
  ];
  const globals = collectGlobalBindings(sources);
  assert.equal(globals.get("DB_NAME").identifier, "openpost-db");
  assert.equal(globals.has("STORAGE_KEY"), false);
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
    discoveries.map(
      ({ identifier_kind, identifier }) => `${identifier_kind}:${identifier}`,
    ),
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
    undocumented.map(({ identifier }) => identifier),
    ["openpost:unknown"],
  );
});

test("repository check reports a newly introduced undocumented key", () => {
  const { undocumented } = checkBrowserStorageInventory(
    [
      {
        file: "feature.ts",
        source: `localStorage.setItem("openpost:new-feature", "on");`,
      },
    ],
    [],
  );
  assert.equal(undocumented.length, 1);
  assert.equal(undocumented[0].identifier, "openpost:new-feature");
});
