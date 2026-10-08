import assert from "node:assert/strict";
import test from "node:test";
import { spawn } from "node:child_process";
import {
  access,
  copyFile,
  mkdir,
  mkdtemp,
  readFile,
  realpath,
  rm,
  symlink,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { setTimeout as delay } from "node:timers/promises";

const buildEntry = fileURLToPath(new URL("../packages/ui/scripts/build.mjs", import.meta.url));
const dependencies = fileURLToPath(new URL("../node_modules", import.meta.url));
const SLOW_BUILD_MS = 12_000;

async function fixture(t) {
  const root = await mkdtemp(path.join(tmpdir(), "openpost-ui-lock-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  const packageRoot = path.join(root, "packages/ui");
  const binaryDirectory = path.join(root, "bin");
  await mkdir(path.join(packageRoot, "scripts"), { recursive: true });
  await mkdir(binaryDirectory);
  await symlink(await realpath(dependencies), path.join(root, "node_modules"), "dir");
  await writeFile(path.join(root, "package.json"), '{"type":"module"}');
  await copyFile(buildEntry, path.join(packageRoot, "scripts/build.mjs"));
  await writeFile(
    path.join(binaryDirectory, "svelte-package"),
    `#!/usr/bin/env node
import * as fs from "node:fs/promises";
import { setTimeout as delay } from "node:timers/promises";
(async () => {
  await fs.mkdir("writing-output");
  await fs.appendFile("events", "start " + process.pid + "\\n");
  console.log("packager stdout");
  console.error("packager stderr");
  try {
    await delay(Number(process.env.FIXTURE_BUILD_DELAY_MS || 0));
    if (process.env.FIXTURE_BUILD_FAIL) throw new Error("fixture packaging failure");
  } finally {
    await fs.appendFile("events", "end " + process.pid + "\\n");
    await fs.rmdir("writing-output");
  }
})().catch(error => { console.error(error.message); process.exitCode = 17; });
`,
    { mode: 0o755 },
  );
  return { packageRoot, binaryDirectory };
}

function runBuild(t, fixture, environment = {}) {
  const child = spawn("node", ["scripts/build.mjs"], {
    cwd: fixture.packageRoot,
    env: {
      ...process.env,
      PATH: `${fixture.binaryDirectory}${path.delimiter}${process.env.PATH}`,
      ...environment,
    },
    stdio: ["ignore", "pipe", "pipe"],
  });
  t.after(() => {
    if (child.exitCode === null) child.kill();
  });
  let stdout = "";
  let stderr = "";
  child.stdout.on("data", (data) => {
    stdout += data;
  });
  child.stderr.on("data", (data) => {
    stderr += data;
  });
  return new Promise((resolve, reject) => {
    child.once("error", reject);
    child.once("close", (code) => resolve({ code, stdout, stderr }));
  });
}

async function waitForStarted(packageRoot) {
  for (let attempt = 0; attempt < 100; attempt++) {
    try {
      await access(path.join(packageRoot, "events"));
      return;
    } catch (error) {
      if (error.code !== "ENOENT") throw error;
    }
    await delay(50);
  }
  throw new Error("The first packager did not start");
}

test(
  "concurrent UI builds keep exclusive output access throughout a slow child build",
  { timeout: 30_000 },
  async (t) => {
    const setup = await fixture(t);
    const first = runBuild(t, setup, { FIXTURE_BUILD_DELAY_MS: String(SLOW_BUILD_MS) });
    await waitForStarted(setup.packageRoot);
    const second = runBuild(t, setup);
    const results = await Promise.all([first, second]);
    for (const result of results) assert.equal(result.code, 0, result.stderr);
    const events = (await readFile(path.join(setup.packageRoot, "events"), "utf8"))
      .trim()
      .split("\n");
    assert.equal(events.length, 4);
    assert.equal(events[0].split(" ")[0], "start");
    assert.equal(events[1], events[0].replace("start", "end"));
    assert.equal(events[2].split(" ")[0], "start");
    assert.equal(events[3], events[2].replace("start", "end"));
  },
);

test("failed packaging keeps its output and error visible and allows the next build", async (t) => {
  const setup = await fixture(t);
  const failed = await runBuild(t, setup, { FIXTURE_BUILD_FAIL: "1" });
  assert.notEqual(failed.code, 0);
  assert.match(failed.stdout, /packager stdout/);
  assert.match(failed.stderr, /packager stderr/);
  assert.match(failed.stderr, /fixture packaging failure/);
  const next = await runBuild(t, setup);
  assert.equal(next.code, 0, next.stderr);
});
