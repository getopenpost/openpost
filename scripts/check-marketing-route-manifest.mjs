import { existsSync } from "node:fs";
import { readdir, readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { marketingRouteManifest } from "../packages/social-images/src/index.js";

export const repositoryRoot = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "..",
);

const routeCatalogBoundaries = Object.freeze({
  platforms: ["const platformImplementations = [", "export const platforms ="],
  tools: ["export const tools = [", "const comparisonDrafts = ["],
  compare: ["const comparisonDrafts = [", "export const comparisons ="],
});

async function listPageComponents(directory) {
  if (!existsSync(directory)) return [];
  const pages = [];
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    const entryPath = path.join(directory, entry.name);
    if (entry.isDirectory()) {
      pages.push(...(await listPageComponents(entryPath)));
    } else if (entry.isFile() && entry.name === "+page.svelte") {
      pages.push(entryPath);
    }
  }
  return pages;
}

export function marketingPagePattern(routesDirectory, pageComponent) {
  const relativeDirectory = path.relative(
    routesDirectory,
    path.dirname(pageComponent),
  );
  if (!relativeDirectory) return "/";
  const segments = relativeDirectory
    .split(path.sep)
    .filter((segment) => !/^\(.+\)$/u.test(segment));
  return `/${segments.join("/")}`;
}

export function routePatternRegex(pattern) {
  if (pattern === "/") return /^\/$/u;
  const expression = pattern
    .split("/")
    .map((segment) => {
      if (/^\[\.\.\.[^\]]+\]$/u.test(segment)) return ".+";
      if (/^\[[^\]]+\]$/u.test(segment)) return "[^/]+";
      return segment.replace(/[.*+?^${}()|[\]\\]/gu, "\\$&");
    })
    .join("/");
  return new RegExp(`^${expression}$`, "u");
}

export function catalogSlugs(source, catalog) {
  const boundaries = routeCatalogBoundaries[catalog];
  if (!boundaries) throw new Error(`Unknown route catalog: ${catalog}`);
  const start = source.indexOf(boundaries[0]);
  const end = source.indexOf(boundaries[1], start + boundaries[0].length);
  if (start === -1 || end === -1) {
    throw new Error(`Could not find ${catalog} catalog boundaries`);
  }
  return [
    ...source.slice(start, end).matchAll(/\bslug:\s*["']([^"']+)["']/gu),
  ].map((match) => match[1]);
}

function sorted(values) {
  return [...values].sort((left, right) => left.localeCompare(right));
}

function compareSlugSets(problems, section, manifestSlugs, catalogEntries) {
  const expected = sorted(catalogEntries);
  const actual = sorted(manifestSlugs);
  if (new Set(expected).size !== expected.length) {
    problems.push(`${section} content catalog contains duplicate slugs`);
  }
  if (JSON.stringify(actual) !== JSON.stringify(expected)) {
    problems.push(
      `${section} manifest slugs ${JSON.stringify(actual)} do not match content catalog ${JSON.stringify(expected)}`,
    );
  }
}

export async function validateMarketingRouteManifest({
  root = repositoryRoot,
  manifest = marketingRouteManifest,
} = {}) {
  const problems = [];
  const routesDirectory = path.join(root, "marketing-site/src/routes");
  const pageComponents = await listPageComponents(routesDirectory);
  const patterns = pageComponents.map((page) =>
    marketingPagePattern(routesDirectory, page),
  );
  const manifestPaths = manifest.map((entry) => entry.path);
  const manifestPathSet = new Set(manifestPaths);

  if (manifestPathSet.size !== manifestPaths.length) {
    problems.push("marketing route manifest contains duplicate paths");
  }

  for (const pattern of patterns) {
    const expression = routePatternRegex(pattern);
    const matches = manifestPaths.filter((route) => expression.test(route));
    if (matches.length === 0) {
      problems.push(`${pattern} has no canonical manifest entry`);
    }
    if (!pattern.includes("[") && !manifestPathSet.has(pattern)) {
      problems.push(`${pattern} is missing its exact canonical manifest entry`);
    }
  }

  for (const route of manifestPaths) {
    const owners = patterns.filter((pattern) =>
      routePatternRegex(pattern).test(route),
    );
    if (owners.length !== 1) {
      problems.push(
        `${route} must resolve to exactly one page pattern; found ${owners.length}`,
      );
    }
  }

  const marketingSource = await readFile(
    path.join(routesDirectory, "_marketing.ts"),
    "utf8",
  );
  for (const [section, catalog] of [
    ["platforms", "platforms"],
    ["compare", "compare"],
    ["tools", "tools"],
  ]) {
    const prefix = `/${section}/`;
    compareSlugSets(
      problems,
      section,
      manifestPaths
        .filter((route) => route.startsWith(prefix))
        .map((route) => route.slice(prefix.length)),
      catalogSlugs(marketingSource, catalog),
    );

    const entryModule = await readFile(
      path.join(routesDirectory, section, "[slug]/+page.ts"),
      "utf8",
    );
    if (
      !new RegExp(
        `marketingPrerenderEntries\\(\\s*["']/${section}["']\\s*\\)`,
        "u",
      ).test(entryModule)
    ) {
      problems.push(
        `/${section}/[slug] prerender entries must derive from marketingRouteManifest`,
      );
    }
  }

  const sitemapSource = await readFile(
    path.join(routesDirectory, "sitemap.xml/+server.ts"),
    "utf8",
  );
  if (
    !sitemapSource.includes("marketingRouteManifest") ||
    !sitemapSource.includes("marketingSiteUrl")
  ) {
    problems.push("sitemap must derive URLs from the canonical route manifest");
  }
  if (sitemapSource.includes("const routes =")) {
    problems.push("sitemap must not maintain a second route list");
  }

  return problems;
}

async function main() {
  const problems = await validateMarketingRouteManifest();
  if (problems.length > 0) {
    console.error(
      `Marketing route manifest check failed:\n${problems.map((problem) => `- ${problem}`).join("\n")}`,
    );
    process.exit(1);
  }
  console.log(
    `Validated ${marketingRouteManifest.length} canonical marketing routes against page, sitemap, social-card, and prerender ownership.`,
  );
}

if (import.meta.main) await main();
