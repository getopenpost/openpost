import assert from "node:assert/strict";
import test from "node:test";
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from "node:fs";
import path from "node:path";
import { tmpdir } from "node:os";
import { missingMobileDependencies } from "./check-mobile-install.mjs";

test("mobile install detects each missing registry, workspace and development dependency", (t) => {
  const root = mkdtempSync(path.join(tmpdir(), "mobile-install-"));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const names = ["@tanstack/react-query", "@openpost/query-catalog", "typescript"];
  writeFileSync(
    path.join(root, "package.json"),
    JSON.stringify({
      dependencies: {
        [names[0]]: "1.0.0",
        [names[1]]: "file:../../packages/query-catalog",
      },
      devDependencies: { typescript: "1.0.0" },
    }),
  );
  for (const name of names) {
    const directory = path.join(root, "node_modules", name);
    mkdirSync(directory, { recursive: true });
    writeFileSync(path.join(directory, "package.json"), "{}");
  }
  assert.deepEqual(missingMobileDependencies(root), []);
  for (const name of names) {
    const file = path.join(root, "node_modules", name, "package.json");
    rmSync(file);
    assert.deepEqual(missingMobileDependencies(root), [name]);
    writeFileSync(file, "{}");
  }
});
