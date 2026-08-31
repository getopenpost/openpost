import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const turboBinary = path.join(root, "node_modules", ".bin", "turbo");

function runTurbo(directory, args) {
  const result = spawnSync(turboBinary, args, {
    cwd: directory,
    encoding: "utf8",
    maxBuffer: 10 * 1024 * 1024,
  });
  assert.equal(result.status, 0, result.stderr || result.stdout);
}

test("the frontend package cache restores output and invalidates on root assets", async (t) => {
  const directory = await mkdtemp(path.join(os.tmpdir(), "openpost-build-graph-"));
  const cacheDirectory = await mkdtemp(path.join(os.tmpdir(), "openpost-build-graph-cache-"));
  const runCountPath = path.join(
    os.tmpdir(),
    `openpost-build-graph-runs-${path.basename(directory)}.txt`,
  );
  t.after(async () => {
    await rm(directory, { recursive: true, force: true });
    await rm(cacheDirectory, { recursive: true, force: true });
    await rm(runCountPath, { force: true });
  });
  await mkdir(path.join(directory, "frontend"), { recursive: true });
  await mkdir(path.join(directory, "assets"), { recursive: true });
  const rootTurbo = JSON.parse(await readFile(path.join(root, "turbo.json"), "utf8"));
  const frontendTurbo = JSON.parse(
    await readFile(path.join(root, "frontend", "turbo.json"), "utf8"),
  );
  await Promise.all([
    writeFile(
      path.join(directory, "package.json"),
      `${JSON.stringify({
        name: "build-graph-fixture",
        private: true,
        packageManager: "npm@10.9.0",
        workspaces: ["frontend"],
      })}\n`,
    ),
    writeFile(
      path.join(directory, "package-lock.json"),
      `${JSON.stringify({
        name: "build-graph-fixture",
        lockfileVersion: 3,
        requires: true,
        packages: {
          "": { name: "build-graph-fixture", workspaces: ["frontend"] },
          frontend: { name: "@fixture/web", version: "1.0.0" },
        },
      })}\n`,
    ),
    writeFile(path.join(directory, ".gitignore"), ".turbo/\n"),
    writeFile(path.join(directory, "turbo.json"), `${JSON.stringify(rootTurbo)}\n`),
    writeFile(path.join(directory, "frontend", "turbo.json"), `${JSON.stringify(frontendTurbo)}\n`),
    writeFile(
      path.join(directory, "frontend", "package.json"),
      `${JSON.stringify({
        name: "@fixture/web",
        version: "1.0.0",
        private: true,
        scripts: { build: "node build.mjs" },
      })}\n`,
    ),
    writeFile(
      path.join(directory, "frontend", "build.mjs"),
      [
        'import { appendFile, mkdir, readFile, writeFile } from "node:fs/promises";',
        'const input = await readFile(new URL("../assets/cache-input.txt", import.meta.url));',
        'await mkdir(new URL("./build", import.meta.url), { recursive: true });',
        'await writeFile(new URL("./build/artifact.txt", import.meta.url), input);',
        `await appendFile(${JSON.stringify(runCountPath)}, "run\\n");`,
        "",
      ].join("\n"),
    ),
    writeFile(path.join(directory, "assets", "cache-input.txt"), "alpha\n"),
  ]);

  const common = [
    "run",
    "build",
    "--filter",
    "@fixture/web",
    "--cache-dir",
    cacheDirectory,
    "--output-logs",
    "errors-only",
  ];
  runTurbo(directory, [...common, "--force"]);
  assert.equal(
    await readFile(path.join(directory, "frontend", "build", "artifact.txt"), "utf8"),
    "alpha\n",
  );
  await rm(path.join(directory, "frontend", "build"), { recursive: true });

  runTurbo(directory, common);
  assert.equal(
    await readFile(path.join(directory, "frontend", "build", "artifact.txt"), "utf8"),
    "alpha\n",
  );
  assert.equal(await readFile(runCountPath, "utf8"), "run\n");

  await writeFile(path.join(directory, "assets", "cache-input.txt"), "beta\n");
  runTurbo(directory, common);
  assert.equal(
    await readFile(path.join(directory, "frontend", "build", "artifact.txt"), "utf8"),
    "beta\n",
  );
  assert.equal(await readFile(runCountPath, "utf8"), "run\nrun\n");
});

test("the frontend cache stores compiled output without immutable editor assets", async () => {
  const turboJSON = JSON.parse(await readFile(path.join(root, "frontend", "turbo.json"), "utf8"));
  for (const directory of ["image-editor-models"]) {
    assert.ok(turboJSON.tasks.build.outputs.includes(`!build/${directory}/**`));
    assert.ok(turboJSON.tasks.build.inputs.includes(`!static/${directory}/**`));
  }
});
