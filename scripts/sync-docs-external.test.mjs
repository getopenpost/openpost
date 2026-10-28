import { spawnSync } from "node:child_process";
import {
  mkdtempSync,
  mkdirSync,
  copyFileSync,
  writeFileSync,
  readFileSync,
  rmSync,
  existsSync,
} from "node:fs";
import os from "node:os";
import path from "node:path";
import { expect, test } from "bun:test";

test("the CLI preserves the committed snapshot offline and refreshes only on request", () => {
  const fixture = mkdtempSync(path.join(os.tmpdir(), "openpost-external-docs-"));
  try {
    mkdirSync(path.join(fixture, "scripts"));
    mkdirSync(path.join(fixture, "docs/reference"), { recursive: true });
    copyFileSync(
      new URL("./sync-docs-external.mjs", import.meta.url),
      path.join(fixture, "scripts/sync-docs-external.mjs"),
    );
    const output = path.join(fixture, "docs/reference/nix-module.md");
    const preload = path.join(fixture, "network.ts");
    const attempted = path.join(fixture, "network-attempted");
    writeFileSync(output, "Committed snapshot\n");
    writeFileSync(
      preload,
      `import { writeFileSync } from "node:fs"; globalThis.fetch = async () => { writeFileSync(${JSON.stringify(attempted)}, "attempted"); throw new Error("network blocked"); };`,
    );
    const run = (...args) =>
      spawnSync("bun", ["--preload", preload, "scripts/sync-docs-external.mjs", ...args], {
        cwd: fixture,
        encoding: "utf8",
        env: { ...process.env, OPENPOST_NIX_MODULE_PATH: "" },
      });
    const offline = run();
    expect(offline.status).toBe(0);
    expect(readFileSync(output, "utf8")).toBe("Committed snapshot\n");
    expect(existsSync(attempted)).toBe(false);
    const failed = run("--refresh");
    expect(failed.status).not.toBe(0);
    expect(existsSync(attempted)).toBe(true);
    expect(readFileSync(output, "utf8")).toBe("Committed snapshot\n");
    for (const reference of [":verified", `@sha256:${"a".repeat(64)}`]) {
      writeFileSync(
        preload,
        `globalThis.fetch = async () => new Response('default = "ghcr.io/getopenpost/openpost${reference}";\\n');`,
      );
      const refreshed = run("--refresh");
      expect(refreshed.status).toBe(0);
      expect(readFileSync(output, "utf8")).toContain(
        'default = "ghcr.io/getopenpost/openpost:latest";',
      );
      expect(readFileSync(output, "utf8")).not.toContain("@sha256:");
    }
    const local = path.join(fixture, "module.nix");
    writeFileSync(local, "# Local module\n");
    const localResult = spawnSync("bun", ["scripts/sync-docs-external.mjs"], {
      cwd: fixture,
      encoding: "utf8",
      env: { ...process.env, OPENPOST_NIX_MODULE_PATH: local },
    });
    expect(localResult.status).toBe(0);
    expect(readFileSync(output, "utf8")).toContain("# Local module");
    rmSync(output);
    expect(run().status).not.toBe(0);
    expect(existsSync(output)).toBe(false);
  } finally {
    rmSync(fixture, { recursive: true, force: true });
  }
});
