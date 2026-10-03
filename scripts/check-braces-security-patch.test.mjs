import { expect, test } from "bun:test";
import { cpSync, mkdtempSync, mkdirSync, appendFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const check = fileURLToPath(new URL("./check-braces-security-patch.mjs", import.meta.url));

test("security admission accepts the installed patch and rejects changed artifacts", () => {
  const fixture = mkdtempSync(path.join(tmpdir(), "openpost-braces-admission-"));
  try {
    mkdirSync(path.join(fixture, "node_modules"));
    const installed = path.join(fixture, "node_modules/braces");
    cpSync(fileURLToPath(new URL("../node_modules/braces", import.meta.url)), installed, {
      recursive: true,
    });
    const run = () => Bun.spawnSync([process.execPath, check], { cwd: fixture });
    expect(run().exitCode).toBe(0);
    const nested = path.join(fixture, "node_modules/parent/node_modules/braces");
    cpSync(installed, nested, { recursive: true });
    expect(run().exitCode).toBe(0);
    appendFileSync(path.join(nested, "lib/parse.js"), "\n// Changed artifact\n");
    const rejected = run();
    expect(rejected.exitCode).not.toBe(0);
    expect(rejected.stderr.toString()).toContain("Unverified Braces security artifact");
  } finally {
    rmSync(fixture, { recursive: true, force: true });
  }
});
