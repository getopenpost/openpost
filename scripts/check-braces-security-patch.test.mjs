import { expect, test } from "bun:test";
import { cpSync, mkdtempSync, mkdirSync, appendFileSync, rmSync, symlinkSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const check = fileURLToPath(new URL("./check-braces-security-patch.mjs", import.meta.url));

async function runCheck(cwd) {
  const child = Bun.spawn([process.execPath, check], {
    cwd,
    stdout: "pipe",
    stderr: "pipe",
    signal: AbortSignal.timeout(2000),
  });
  const [exitCode, stdout, stderr] = await Promise.all([
    child.exited,
    new Response(child.stdout).text(),
    new Response(child.stderr).text(),
  ]);
  return { exitCode, stdout, stderr };
}

test("security admission accepts the installed patch and rejects changed artifacts", async () => {
  const fixture = mkdtempSync(path.join(tmpdir(), "openpost-braces-admission-"));
  try {
    mkdirSync(path.join(fixture, "node_modules"));
    const installed = path.join(fixture, "node_modules/braces");
    cpSync(fileURLToPath(new URL("../node_modules/braces", import.meta.url)), installed, {
      recursive: true,
    });
    const run = () => runCheck(fixture);
    expect((await run()).exitCode).toBe(0);
    const nested = path.join(fixture, "node_modules/parent/node_modules/braces");
    cpSync(installed, nested, { recursive: true });
    expect((await run()).exitCode).toBe(0);
    appendFileSync(path.join(nested, "lib/parse.js"), "\n// Changed artifact\n");
    const rejected = await run();
    expect(rejected.exitCode).not.toBe(0);
    expect(rejected.stderr).toContain("Unverified Braces security artifact");
  } finally {
    rmSync(fixture, { recursive: true, force: true });
  }
});

test("security admission handles workspace cycles and symlinked Braces in the Bun store", async () => {
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
    const result = await runCheck(fixture);
    expect(result.exitCode, result.stderr).toBe(0);
    appendFileSync(path.join(external, "lib/parse.js"), "\n// Changed linked artifact\n");
    const rejected = await runCheck(fixture);
    expect(rejected.exitCode).not.toBe(0);
    expect(rejected.stderr).toContain("Unverified Braces security artifact");
  } finally {
    rmSync(fixture, { recursive: true, force: true });
  }
});
