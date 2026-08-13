import assert from "node:assert/strict";
import { mkdir, mkdtemp, readFile, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import {
  collectAppRoutes,
  serializeAppRouteManifest,
  writeAppRouteManifest,
} from "./generate-app-route-manifest.mjs";

async function addPage(routesDirectory, route, filename = "+page.svelte") {
  const directory = path.join(
    routesDirectory,
    ...route.split("/").filter(Boolean),
  );
  await mkdir(directory, { recursive: true });
  await writeFile(path.join(directory, filename), "<main />\n");
}

test("collects static, dynamic, rest, and grouped SvelteKit pages", async () => {
  const directory = await mkdtemp(
    path.join(os.tmpdir(), "openpost-app-routes-"),
  );
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

test("fails when route groups create duplicate public paths", async () => {
  const directory = await mkdtemp(
    path.join(os.tmpdir(), "openpost-app-routes-"),
  );
  await Promise.all([
    addPage(directory, "(one)/settings"),
    addPage(directory, "(two)/settings"),
  ]);

  await assert.rejects(collectAppRoutes(directory), /duplicate public paths/);
});

test("serializes a strict, versioned manifest", () => {
  assert.equal(
    serializeAppRouteManifest(["/", "/calendar"]),
    `{
  "schema_version": 1,
  "routes": [
    "/",
    "/calendar"
  ]
}\n`,
  );
});

test("writes a manifest into an explicit package-owned output", async () => {
  const directory = await mkdtemp(
    path.join(os.tmpdir(), "openpost-app-routes-"),
  );
  const routesDirectory = path.join(directory, "routes");
  const manifestPath = path.join(directory, "package-build", "app-routes.json");
  await addPage(routesDirectory, "");
  await addPage(routesDirectory, "calendar");

  await writeAppRouteManifest({ routesDirectory, manifestPath });

  assert.deepEqual(JSON.parse(await readFile(manifestPath, "utf8")), {
    schema_version: 1,
    routes: ["/", "/calendar"],
  });
});
