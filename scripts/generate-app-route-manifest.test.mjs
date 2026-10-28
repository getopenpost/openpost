import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { copyFile, mkdir, mkdtemp, readFile, realpath, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

import { collectAppRoutes } from "./generate-app-route-manifest.mjs";

const scriptsDirectory = path.dirname(fileURLToPath(import.meta.url));

async function addPage(routesDirectory, route, filename = "+page.svelte") {
  const directory = path.join(routesDirectory, ...route.split("/").filter(Boolean));
  await mkdir(directory, { recursive: true });
  await writeFile(path.join(directory, filename), "<main />\n");
}

function runRouteManifestCli(directory, ...cliArguments) {
  return new Promise((resolve) => {
    execFile(
      process.execPath,
      [path.join(directory, "scripts", "generate-app-route-manifest.mjs"), ...cliArguments],
      { cwd: directory, encoding: "utf8" },
      (error, stdout, stderr) => resolve({ code: error ? error.code : 0, stderr, stdout }),
    );
  });
}

test("collects static, dynamic, rest, and grouped SvelteKit pages", async (t) => {
  const directory = await mkdtemp(path.join(os.tmpdir(), "openpost-app-routes-"));
  t.after(() => rm(directory, { force: true, recursive: true }));
  await Promise.all([
    addPage(directory, ""),
    addPage(directory, "calendar"),
    addPage(directory, "publications/[id]"),
    addPage(directory, "studio/[...path]", "+page.ts"),
    addPage(directory, "(authenticated)/settings"),
    addPage(directory, "_components", "PublicHome.svelte"),
  ]);

  assert.deepEqual(await collectAppRoutes(directory), [
    "/",
    "/calendar",
    "/publications/[id]",
    "/settings",
    "/studio/[...path]",
  ]);
});

test("fails when route groups create duplicate public paths", async (t) => {
  const directory = await mkdtemp(path.join(os.tmpdir(), "openpost-app-routes-"));
  t.after(() => rm(directory, { force: true, recursive: true }));
  await Promise.all([addPage(directory, "(one)/settings"), addPage(directory, "(two)/settings")]);

  await assert.rejects(collectAppRoutes(directory), /duplicate public paths/);
});

test("writes a manifest into an explicit package-owned output", async (t) => {
  // The CLI matches import.meta.url against argv, and macOS links /var to /private/var.
  const directory = await realpath(await mkdtemp(path.join(os.tmpdir(), "openpost-app-routes-")));
  t.after(() => rm(directory, { force: true, recursive: true }));
  const routesDirectory = path.join(directory, "apps/web/src/routes");
  const scriptsCopy = path.join(directory, "scripts");
  const manifestPath = path.join(directory, "package-build", "app-routes.json");
  await mkdir(scriptsCopy, { recursive: true });
  await Promise.all([
    addPage(routesDirectory, ""),
    addPage(routesDirectory, "calendar"),
    ...["cli-option.mjs", "generate-app-route-manifest.mjs"].map((filename) =>
      copyFile(path.join(scriptsDirectory, filename), path.join(scriptsCopy, filename)),
    ),
  ]);

  const result = await runRouteManifestCli(directory, "--output-directory", "package-build");

  assert.equal(result.code, 0, result.stderr);
  assert.match(result.stdout, /^Generated 2 application routes\.$/mu);
  assert.deepEqual(JSON.parse(await readFile(manifestPath, "utf8")), {
    schema_version: 1,
    routes: ["/", "/calendar"],
  });
  await assert.rejects(readFile(path.join(directory, "apps/web/build/app-routes.json")), /ENOENT/);
});
