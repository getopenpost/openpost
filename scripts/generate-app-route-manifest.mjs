import { mkdir, readdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const scriptDirectory = path.dirname(fileURLToPath(import.meta.url));
export const repositoryRoot = path.resolve(scriptDirectory, "..");
export const defaultRoutesDirectory = path.join(
  repositoryRoot,
  "frontend/src/routes",
);
export const defaultManifestPath = path.join(
  repositoryRoot,
  "frontend/build/app-routes.json",
);

const pageFilePattern = /^\+page(?:\.[^.]+)?\.(?:js|ts|svelte)$/;

function routeSegment(directoryName) {
  if (directoryName.startsWith("(") && directoryName.endsWith(")")) return null;
  return directoryName;
}

async function pageDirectoriesBelow(directory, relativeSegments = []) {
  const entries = await readdir(directory, { withFileTypes: true });
  const routes = entries.some(
    (entry) => entry.isFile() && pageFilePattern.test(entry.name),
  )
    ? [relativeSegments]
    : [];

  for (const entry of entries) {
    if (
      !entry.isDirectory() ||
      entry.name.startsWith("_") ||
      entry.name.startsWith(".")
    ) {
      continue;
    }
    const segment = routeSegment(entry.name);
    routes.push(
      ...(await pageDirectoriesBelow(path.join(directory, entry.name), [
        ...relativeSegments,
        ...(segment === null ? [] : [segment]),
      ])),
    );
  }
  return routes;
}

export async function collectAppRoutes(
  routesDirectory = defaultRoutesDirectory,
) {
  const routeSegments = await pageDirectoriesBelow(routesDirectory);
  const routes = routeSegments
    .map((segments) => (segments.length === 0 ? "/" : `/${segments.join("/")}`))
    .sort();
  const duplicates = routes.filter(
    (route, index) => route === routes[index - 1],
  );
  if (duplicates.length > 0) {
    throw new Error(
      `App route manifest contains duplicate public paths: ${[...new Set(duplicates)].join(", ")}`,
    );
  }
  return routes;
}

export function serializeAppRouteManifest(routes) {
  return `${JSON.stringify({ schema_version: 1, routes }, null, 2)}\n`;
}

export async function writeAppRouteManifest({
  routesDirectory = defaultRoutesDirectory,
  manifestPath = defaultManifestPath,
} = {}) {
  const routes = await collectAppRoutes(routesDirectory);
  await mkdir(path.dirname(manifestPath), { recursive: true });
  await writeFile(manifestPath, serializeAppRouteManifest(routes));
  return routes;
}

function optionValue(name) {
  const index = process.argv.indexOf(name);
  if (index === -1) return undefined;
  const value = process.argv[index + 1];
  if (!value || value.startsWith("--")) {
    throw new Error(`${name} requires a path`);
  }
  return value;
}

async function run() {
  const routes = await collectAppRoutes();
  if (process.argv.includes("--check")) {
    console.log(`Validated ${routes.length} application routes.`);
    return;
  }
  const outputDirectory = optionValue("--output-directory");
  const manifestPath = outputDirectory
    ? path.resolve(process.cwd(), outputDirectory, "app-routes.json")
    : defaultManifestPath;
  await mkdir(path.dirname(manifestPath), { recursive: true });
  await writeFile(manifestPath, serializeAppRouteManifest(routes));
  const persisted = JSON.parse(await readFile(manifestPath, "utf8"));
  if (
    persisted.schema_version !== 1 ||
    persisted.routes.length !== routes.length
  ) {
    throw new Error(
      "Generated application route manifest could not be verified.",
    );
  }
  console.log(`Generated ${routes.length} application routes.`);
}

if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href
) {
  await run();
}
