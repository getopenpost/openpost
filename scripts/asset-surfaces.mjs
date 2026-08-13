import { createHash } from "node:crypto";
import { createReadStream, existsSync } from "node:fs";
import { readdir, readFile, stat } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

import {
  assetSurfaceManifest,
  publishedProviderAssetSlugs,
} from "./asset-surfaces.ts";

export const repositoryRoot = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "..",
);

export const assetSourceDirectory = path.join(repositoryRoot, "assets");

export const assetTargetDirectories = Object.freeze({
  frontend: path.join(repositoryRoot, "frontend", "static", "assets"),
  docs: path.join(repositoryRoot, "docs-site", "public", "assets"),
  marketing: path.join(repositoryRoot, "marketing-site", "static", "assets"),
});

const surfaceSourceDirectories = Object.freeze({
  frontend: [path.join(repositoryRoot, "frontend", "src")],
  docs: [path.join(repositoryRoot, "docs-site")],
  marketing: [
    path.join(repositoryRoot, "marketing-site", "src"),
    path.join(repositoryRoot, "marketing-site", "functions"),
  ],
});

const sourceExtensions = new Set([
  ".css",
  ".html",
  ".js",
  ".json",
  ".md",
  ".mjs",
  ".svelte",
  ".ts",
  ".tsx",
]);

const excludedSourceDirectories = new Set([
  ".svelte-kit",
  ".wrangler",
  "build",
  "dist",
  "node_modules",
  "public",
  "static",
]);

async function listFiles(directory, { sourceTree = false } = {}) {
  if (!existsSync(directory)) return [];
  const files = [];
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    const entryPath = path.join(directory, entry.name);
    if (entry.isDirectory()) {
      if (sourceTree && excludedSourceDirectories.has(entry.name)) continue;
      files.push(...(await listFiles(entryPath, { sourceTree })));
    } else if (entry.isFile()) {
      files.push(entryPath);
    }
  }
  return files;
}

export function directAssetReferences(contents) {
  const references = new Set();
  const patterns = [
    /(?:^|[^A-Za-z0-9_./-])\/assets\/([A-Za-z0-9_.@/-]+\.[A-Za-z0-9]+)(?=[?#"'`\s),}:]|$)/gmu,
    /\$\{[^}]+\}assets\/([A-Za-z0-9_.@/-]+\.[A-Za-z0-9]+)(?=[?#"'`\s),}:]|$)/gmu,
  ];
  for (const pattern of patterns) {
    for (const match of contents.matchAll(pattern)) references.add(match[1]);
  }
  return [...references].sort();
}

async function sourceReferences(surface, root = repositoryRoot) {
  const configuredRoots = surfaceSourceDirectories[surface].map((directory) =>
    path.join(root, path.relative(repositoryRoot, directory)),
  );
  const references = new Set();
  for (const directory of configuredRoots) {
    for (const file of await listFiles(directory, { sourceTree: true })) {
      if (!sourceExtensions.has(path.extname(file))) continue;
      const contents = await readFile(file, "utf8");
      for (const reference of directAssetReferences(contents)) {
        references.add(reference);
      }
    }
  }
  return references;
}

function valuesMatching(source, pattern) {
  return [...source.matchAll(pattern)].map((match) => match[1]);
}

async function dynamicMarketingReferences(root = repositoryRoot) {
  const postizSource = await readFile(
    path.join(
      root,
      "marketing-site/src/routes/_components/postiz-social-logos.ts",
    ),
    "utf8",
  );
  const functionSource = await readFile(
    path.join(root, "marketing-site/functions/og.tsx"),
    "utf8",
  );
  const references = new Set(
    valuesMatching(postizSource, /:\s*["']([^"']+\.svg)["']/gu).map(
      (file) => `postiz-socials/${file}`,
    ),
  );
  for (const font of valuesMatching(
    functionSource,
    /font\(url\.origin,\s*["']([^"']+)["']\)/gu,
  )) {
    references.add(`brand/fonts/${font}`);
  }
  if (!functionSource.includes("/assets/logos/${platform}.svg")) {
    throw new Error("marketing OG provider logo path is no longer recognized");
  }
  for (const slug of publishedProviderAssetSlugs) {
    references.add(`logos/${slug}.svg`);
  }
  return references;
}

export async function expectedSurfaceAssets(surface, root = repositoryRoot) {
  const references = await sourceReferences(surface, root);
  if (surface === "marketing") {
    for (const reference of await dynamicMarketingReferences(root)) {
      references.add(reference);
    }
  }
  return [...references].sort();
}

export async function validateAssetSurfaceManifest(
  manifest = assetSurfaceManifest,
  root = repositoryRoot,
  surfaces = Object.keys(assetTargetDirectories),
) {
  const problems = [];
  const sourceDirectory = path.join(root, "assets");
  for (const surface of surfaces) {
    if (!(surface in assetTargetDirectories)) {
      problems.push(`unknown asset surface: ${surface}`);
      continue;
    }
    const entries = manifest[surface];
    if (!Array.isArray(entries) || entries.length === 0) {
      problems.push(`${surface} must declare at least one asset`);
      continue;
    }
    const seen = new Set();
    for (const entry of entries) {
      if (
        typeof entry !== "string" ||
        entry.startsWith("/") ||
        entry.includes("..") ||
        entry.includes("\\")
      ) {
        problems.push(`${surface} has an unsafe asset path: ${String(entry)}`);
        continue;
      }
      if (seen.has(entry)) problems.push(`${surface} repeats ${entry}`);
      seen.add(entry);
      const sourcePath = path.join(sourceDirectory, entry);
      if (!existsSync(sourcePath) || !(await stat(sourcePath)).isFile()) {
        problems.push(`${surface} source asset is missing: ${entry}`);
      }
    }

    const expected = await expectedSurfaceAssets(surface, root);
    for (const reference of expected) {
      if (!seen.has(reference)) {
        problems.push(`${surface} references undeclared asset: ${reference}`);
      }
    }
    for (const entry of seen) {
      if (!expected.includes(entry)) {
        problems.push(`${surface} declares unreferenced asset: ${entry}`);
      }
    }
  }
  return problems;
}

export async function validateAssetTarget(
  surface,
  targetDirectory = assetTargetDirectories[surface],
  manifest = assetSurfaceManifest,
  { verifyContents = true, sourceDirectory = assetSourceDirectory } = {},
) {
  const expected = [...manifest[surface]].sort();
  const actual = (await listFiles(targetDirectory))
    .map((file) =>
      path.relative(targetDirectory, file).split(path.sep).join("/"),
    )
    .sort();
  const expectedSet = new Set(expected);
  const actualSet = new Set(actual);
  const problems = [
    ...expected
      .filter((file) => !actualSet.has(file))
      .map((file) => `${surface} target is missing ${file}`),
    ...actual
      .filter((file) => !expectedSet.has(file))
      .map((file) => `${surface} target has undeclared file ${file}`),
  ];
  if (verifyContents) {
    for (const file of expected.filter((entry) => actualSet.has(entry))) {
      const [sourceHash, targetHash] = await Promise.all([
        sha256File(path.join(sourceDirectory, file)),
        sha256File(path.join(targetDirectory, file)),
      ]);
      if (sourceHash !== targetHash) {
        problems.push(`${surface} target content differs for ${file}`);
      }
    }
  }
  return problems;
}

async function sha256File(file) {
  const hash = createHash("sha256");
  for await (const chunk of createReadStream(file)) hash.update(chunk);
  return hash.digest("hex");
}

export async function assetSizeReport(
  manifest = assetSurfaceManifest,
  root = repositoryRoot,
) {
  const sourceDirectory = path.join(root, "assets");
  const sourceFiles = await listFiles(sourceDirectory);
  const sourceBytes = (
    await Promise.all(sourceFiles.map(async (file) => (await stat(file)).size))
  ).reduce((total, size) => total + size, 0);
  const surfaceBytes = {};
  for (const [surface, entries] of Object.entries(manifest)) {
    surfaceBytes[surface] = (
      await Promise.all(
        entries.map(
          async (file) => (await stat(path.join(sourceDirectory, file))).size,
        ),
      )
    ).reduce((total, size) => total + size, 0);
  }
  return {
    sourceBytes,
    previousCopiedBytes: sourceBytes * Object.keys(manifest).length,
    copiedBytes: Object.values(surfaceBytes).reduce(
      (total, size) => total + size,
      0,
    ),
    surfaceBytes,
  };
}

async function main() {
  const problems = await validateAssetSurfaceManifest();
  if (problems.length > 0) {
    console.error(
      `Asset surface manifest check failed:\n${problems.map((problem) => `- ${problem}`).join("\n")}`,
    );
    process.exit(1);
  }
  const report = await assetSizeReport();
  if (report.copiedBytes >= report.previousCopiedBytes) {
    console.error("Per-surface asset copies do not reduce shipped bytes.");
    process.exit(1);
  }
  const reduction = 1 - report.copiedBytes / report.previousCopiedBytes;
  console.log(
    `Asset manifests declare ${Object.values(assetSurfaceManifest).reduce((total, entries) => total + entries.length, 0)} copies and reduce copied bytes by ${(reduction * 100).toFixed(1)}%.`,
  );
}

if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href
) {
  await main();
}
