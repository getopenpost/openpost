import { expect, test } from "bun:test";
import { spawnSync } from "node:child_process";
import { copyFileSync, mkdtempSync, mkdirSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("../", import.meta.url));
const script = path.join(root, "scripts/check-security-admissions.mjs");

test("security admission rejects changed dependencies, editor configuration and shared helper APIs", () => {
  const fixture = mkdtempSync(path.join(tmpdir(), "openpost-security-admissions-"));
  const worker = "apps/web/src/lib/image-editor/background-removal.worker.ts";
  const run = () => spawnSync(process.execPath, [script], { cwd: fixture }).status;
  try {
    for (const directory of [path.dirname(worker), "apps/marketing/src", "packages/shared/src"]) {
      mkdirSync(path.join(fixture, directory), { recursive: true });
    }
    copyFileSync(path.join(root, "bun.lock"), path.join(fixture, "bun.lock"));
    copyFileSync(path.join(root, worker), path.join(fixture, worker));
    expect(run()).toBe(0);
    writeFileSync(path.join(fixture, "bun.lock"), '{"packages":{"zod":["zod@4.4.3"]}}');
    expect(run()).toBe(1);
    copyFileSync(path.join(root, "bun.lock"), path.join(fixture, "bun.lock"));
    writeFileSync(path.join(fixture, worker), "removeBackground(image, event.data.configuration)");
    expect(run()).toBe(1);
    copyFileSync(path.join(root, worker), path.join(fixture, worker));
    const helper = path.join(fixture, "packages/shared/src/imported-helper.mjs");
    for (const api of [
      "import { enhance } from '$app/forms'",
      "setHeaders({})",
      "use:enhance",
      "import { schema } from '@n8n/config'",
      "import deepmerge from 'deepmerge'",
      "const merge = require('deepmerge/dist/cjs.js')",
    ]) {
      writeFileSync(helper, api);
      expect(run()).toBe(1);
    }
    writeFileSync(helper, "export const value = 1;");
    expect(run()).toBe(0);
  } finally {
    rmSync(fixture, { recursive: true, force: true });
  }
});
