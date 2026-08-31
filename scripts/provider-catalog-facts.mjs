import { existsSync } from "node:fs";
import { readdir, readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

import { marketingSocialEntries } from "../packages/social-images/src/index.js";
import { platforms } from "../marketing-site/src/routes/_marketing.ts";
import { publishedProviderAssetSlugs } from "./asset-surfaces.ts";

export const repositoryRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

const numberWords = [
  "zero",
  "one",
  "two",
  "three",
  "four",
  "five",
  "six",
  "seven",
  "eight",
  "nine",
  "ten",
  "eleven",
  "twelve",
  "thirteen",
  "fourteen",
  "fifteen",
  "sixteen",
  "seventeen",
  "eighteen",
  "nineteen",
  "twenty",
];

const countToken = `(${numberWords.join("|")}|\\d+)`;
const totalCountPatterns = [
  new RegExp(`\\b${countToken} publishing destinations\\b`, "giu"),
  new RegExp(`\\b${countToken} social networks\\b`, "giu"),
  new RegExp(`\\b${countToken} social network limits\\b`, "giu"),
  new RegExp(`\\b${countToken} OpenPost platforms\\b`, "giu"),
  new RegExp(`\\b(?:compare|preview) ${countToken} (?:limits|platforms)\\b`, "giu"),
  new RegExp(`\\b${countToken} equivalent providers\\b`, "giu"),
];

const nonProviderDocumentationPages = new Set([
  "index",
  "launch-matrix",
  "overview",
  "platform-limits",
  "roadmap",
  "troubleshooting",
]);

export function backendProviderCatalog(source) {
  const start = source.indexOf("var providerCatalog = []ProviderInfo{");
  if (start < 0) throw new Error("backend providerCatalog declaration is missing");
  const remainder = source.slice(start);
  const end = remainder.indexOf("\n}\n\nfunc ");
  if (end < 0) throw new Error("backend providerCatalog boundary is not recognized");
  const block = remainder.slice(0, end);
  const constants = new Map(
    [...source.matchAll(/^\s*(?:const\s+)?([A-Za-z][A-Za-z0-9_]*)\s*=\s*"([^"]+)"/gmu)].map(
      (match) => [match[1], match[2]],
    ),
  );
  const providers = [];
  for (const match of block.matchAll(/Platform:\s*(?:"([^"]+)"|([A-Za-z][A-Za-z0-9_]*))/gu)) {
    const provider = match[1] ?? constants.get(match[2]);
    if (!provider) {
      throw new Error(`backend provider constant ${match[2]} is not a string`);
    }
    providers.push(provider);
  }
  if (providers.length === 0) {
    throw new Error("backend providerCatalog has no providers");
  }
  return providers;
}

export function providerCountCopyProblems(source, expectedCount, label) {
  const expectedTokens = new Set([String(expectedCount), numberWords[expectedCount]]);
  const problems = [];
  for (const pattern of totalCountPatterns) {
    for (const match of source.matchAll(pattern)) {
      if (!expectedTokens.has(match[1].toLowerCase())) {
        problems.push(
          `${label} says ${JSON.stringify(match[0])}; canonical provider count is ${expectedCount}`,
        );
      }
    }
  }
  return problems;
}

function sameSetProblems(label, actual, expected) {
  const problems = [];
  const actualSet = new Set(actual);
  const expectedSet = new Set(expected);
  if (actualSet.size !== actual.length) problems.push(`${label} contains duplicates`);
  for (const provider of expectedSet) {
    if (!actualSet.has(provider)) problems.push(`${label} is missing ${provider}`);
  }
  for (const provider of actualSet) {
    if (!expectedSet.has(provider)) problems.push(`${label} has unknown ${provider}`);
  }
  return problems;
}

async function maintainedCopyFiles(root) {
  const roots = [
    ".github/copilot-instructions.md",
    "README.md",
    "docs-site",
    "launch-kit",
    "marketing-site/src",
    "packages/social-images/src/index.js",
  ];
  const files = [];
  const visit = async (relativePath) => {
    const absolutePath = path.join(root, relativePath);
    if (!existsSync(absolutePath)) return;
    const details = await readdir(absolutePath, { withFileTypes: true }).catch(() => undefined);
    if (!details) {
      files.push(relativePath);
      return;
    }
    for (const entry of details) {
      if (
        entry.name === "node_modules" ||
        entry.name === "dist" ||
        entry.name === ".svelte-kit" ||
        entry.name === "docs-catalog.js"
      ) {
        continue;
      }
      await visit(path.join(relativePath, entry.name));
    }
  };
  for (const rootPath of roots) await visit(rootPath);
  return files.filter((file) => /\.(?:js|md|svelte|ts)$/u.test(file));
}

export async function validateProviderCatalogFacts(root = repositoryRoot) {
  const backendSource = await readFile(
    path.join(root, "backend/internal/api/handlers/oauth.go"),
    "utf8",
  );
  const canonical = backendProviderCatalog(backendSource);
  const problems = [];
  if (new Set(canonical).size !== canonical.length) {
    problems.push("backend providerCatalog contains duplicates");
  }

  problems.push(
    ...sameSetProblems(
      "marketing provider catalogue",
      platforms.map((provider) => provider.slug),
      canonical,
    ),
    ...sameSetProblems(
      "social-image provider catalogue",
      marketingSocialEntries
        .filter((entry) => entry.kind === "platform")
        .map((entry) => entry.platform),
      canonical,
    ),
    ...sameSetProblems("provider asset catalogue", [...publishedProviderAssetSlugs], canonical),
  );

  const documentationPages = (await readdir(path.join(root, "docs-site/providers")))
    .filter((file) => file.endsWith(".md"))
    .map((file) => file.slice(0, -3))
    .filter((slug) => !nonProviderDocumentationPages.has(slug));
  problems.push(...sameSetProblems("provider documentation", documentationPages, canonical));

  for (const file of await maintainedCopyFiles(root)) {
    const source = await readFile(path.join(root, file), "utf8");
    problems.push(...providerCountCopyProblems(source, canonical.length, file));
  }
  return problems;
}

async function main() {
  const problems = await validateProviderCatalogFacts();
  if (problems.length > 0) {
    console.error(
      `Provider catalogue fact check failed:\n${problems.map((problem) => `- ${problem}`).join("\n")}`,
    );
    process.exit(1);
  }
  const source = await readFile(
    path.join(repositoryRoot, "backend/internal/api/handlers/oauth.go"),
    "utf8",
  );
  console.log(
    `Validated ${backendProviderCatalog(source).length} canonical providers across public metadata, assets, documentation, and count copy.`,
  );
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  await main();
}
