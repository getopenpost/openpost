import { expect, test } from "bun:test";
import { cpSync, mkdtempSync, mkdirSync, appendFileSync, rmSync, symlinkSync } from "node:fs";
import { spawnSync } from "node:child_process";
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

test("security admission handles workspace cycles and symlinked Braces in the Bun store", () => {
  const fixture = mkdtempSync(path.join(tmpdir(), "openpost-braces-cycle-"));
  try {
    const installed = path.join(fixture, "node_modules/.bun/braces@3.0.3/node_modules/braces");
    cpSync(fileURLToPath(new URL("../node_modules/braces", import.meta.url)), installed, {
      recursive: true,
    });
    symlinkSync(".bun/braces@3.0.3/node_modules/braces", path.join(fixture, "node_modules/braces"));
    mkdirSync(path.join(fixture, "node_modules/@openpost"));
    symlinkSync(fixture, path.join(fixture, "node_modules/@openpost/web"));
    const external = path.join(fixture, "artifacts/braces");
    cpSync(installed, external, { recursive: true });
    mkdirSync(path.join(fixture, "node_modules/linked/node_modules"), { recursive: true });
    symlinkSync(external, path.join(fixture, "node_modules/linked/node_modules/braces"));
    const result = spawnSync(process.execPath, [check], {
      cwd: fixture,
      timeout: 2000,
      encoding: "utf8",
    });
    expect(result.error).toBeUndefined();
    expect(result.status, result.stderr).toBe(0);
    appendFileSync(path.join(external, "lib/parse.js"), "\n// Changed linked artifact\n");
    const rejected = spawnSync(process.execPath, [check], {
      cwd: fixture,
      timeout: 2000,
      encoding: "utf8",
    });
    expect(rejected.error).toBeUndefined();
    expect(rejected.status).not.toBe(0);
    expect(rejected.stderr).toContain("Unverified Braces security artifact");
  } finally {
    rmSync(fixture, { recursive: true, force: true });
  }
});
