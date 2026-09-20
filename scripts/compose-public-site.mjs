#!/usr/bin/env bun

import { cp, mkdir, readFile, readdir, rm, stat, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const repositoryRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const maximumPagesHeaderRules = 100;

function docsPath(value) {
  if (value === "/docs" || value.startsWith("/docs/")) return value;
  return value === "/" ? "/docs" : `/docs${value}`;
}

export function scopeDocsRedirects(source) {
  return source
    .split("\n")
    .map((line) => {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith("#")) return line;
      const [from, to, ...rest] = trimmed.split(/\s+/u);
      if (!from?.startsWith("/") || !to) {
        throw new Error(`invalid documentation redirect: ${line}`);
      }
      const scopedTarget = to.startsWith("/") ? docsPath(to) : to;
      return [docsPath(from), scopedTarget, ...rest].join(" ");
    })
    .join("\n");
}

export function scopeDocsHeaders(source) {
  return source
    .split("\n")
    .map((line) => {
      if (!line.startsWith("/") || line.startsWith("//")) return line;
      return docsPath(line.trim());
    })
    .join("\n");
}

function expandHeaderRule(source, rulePath, replacementPaths) {
  const lines = source.split("\n");
  const ruleIndex = lines.indexOf(rulePath);
  if (ruleIndex < 0) return source;
  let nextRuleIndex = ruleIndex + 1;
  while (nextRuleIndex < lines.length && !lines[nextRuleIndex].startsWith("/")) {
    nextRuleIndex++;
  }
  const body = lines.slice(ruleIndex + 1, nextRuleIndex);
  lines.splice(
    ruleIndex,
    nextRuleIndex - ruleIndex,
    ...replacementPaths.flatMap((replacementPath) => [replacementPath, ...body]),
  );
  return lines.join("\n");
}

function markdownHeaderPaths(files) {
  const paths = new Set();
  for (const file of files.filter((entry) => entry.endsWith(".md"))) {
    const normalized = file.split(path.sep).join("/");
    const slashIndex = normalized.indexOf("/");
    paths.add(slashIndex < 0 ? `/${normalized}` : `/${normalized.slice(0, slashIndex)}/*.md`);
  }
  return [...paths].sort();
}

function headerPatternSubsumes(broad, narrow) {
  if (broad === narrow || !broad.includes("*")) return false;
  const [broadPrefix, broadSuffix] = broad.split("*");
  if (!narrow.includes("*")) {
    return narrow.startsWith(broadPrefix) && narrow.endsWith(broadSuffix);
  }
  const [narrowPrefix, narrowSuffix = ""] = narrow.split("*");
  return narrowPrefix.startsWith(broadPrefix) && narrowSuffix.endsWith(broadSuffix);
}

function deduplicateInheritedHeaders(source) {
  const lines = source.split("\n");
  const rules = [];
  for (let index = 0; index < lines.length; index++) {
    if (!lines[index].startsWith("/")) continue;
    const headers = [];
    for (let bodyIndex = index + 1; bodyIndex < lines.length; bodyIndex++) {
      if (lines[bodyIndex].startsWith("/")) break;
      const match = lines[bodyIndex].match(/^\s+([^:]+):\s*(.+)$/u);
      if (match) headers.push({ index: bodyIndex, value: `${match[1].toLowerCase()}:${match[2]}` });
    }
    rules.push({ path: lines[index], headers });
  }

  const duplicateLines = new Set();
  for (const rule of rules) {
    for (const header of rule.headers) {
      if (
        rules.some(
          (candidate) =>
            headerPatternSubsumes(candidate.path, rule.path) &&
            candidate.headers.some((candidateHeader) => candidateHeader.value === header.value),
        )
      ) {
        duplicateLines.add(header.index);
      }
    }
  }
  return lines.filter((_, index) => !duplicateLines.has(index)).join("\n");
}

async function exists(target) {
  try {
    await stat(target);
    return true;
  } catch (error) {
    if (error.code === "ENOENT") return false;
    throw error;
  }
}

export async function composePublicSite({ marketingDirectory, docsDirectory, outputDirectory }) {
  for (const [label, directory] of [
    ["marketing", marketingDirectory],
    ["documentation", docsDirectory],
  ]) {
    if (!(await exists(directory))) throw new Error(`missing ${label} build output: ${directory}`);
  }

  if (await exists(path.join(marketingDirectory, "docs"))) {
    throw new Error("marketing output already owns /docs");
  }

  const marketingHeaders = await readFile(path.join(marketingDirectory, "_headers"), "utf8");
  const marketingRedirects = await readFile(path.join(marketingDirectory, "_redirects"), "utf8");
  const docsHeaders = await readFile(path.join(docsDirectory, "_headers"), "utf8");
  const docsRedirects = await readFile(path.join(docsDirectory, "_redirects"), "utf8");

  await rm(outputDirectory, { recursive: true, force: true });
  await mkdir(outputDirectory, { recursive: true });
  await cp(marketingDirectory, outputDirectory, { recursive: true });

  const marketingFiles = await readdir(marketingDirectory, { recursive: true });
  const composedHeaders = deduplicateInheritedHeaders(
    `${expandHeaderRule(marketingHeaders, "/*.md", markdownHeaderPaths(marketingFiles)).trimEnd()}\n${scopeDocsHeaders(docsHeaders).trimEnd()}\n`,
  );
  const headerRuleCount = composedHeaders.split("\n").filter((line) => line.startsWith("/")).length;
  if (headerRuleCount > maximumPagesHeaderRules) {
    throw new Error(
      `composed Cloudflare Pages headers use ${headerRuleCount} rules; limit is ${maximumPagesHeaderRules}`,
    );
  }

  const mountedDocsDirectory = path.join(outputDirectory, "docs");
  await cp(docsDirectory, mountedDocsDirectory, { recursive: true });
  await Promise.all([
    rm(path.join(mountedDocsDirectory, "_headers"), { force: true }),
    rm(path.join(mountedDocsDirectory, "_redirects"), { force: true }),
  ]);

  await Promise.all([
    writeFile(path.join(outputDirectory, "_headers"), composedHeaders, "utf8"),
    writeFile(
      path.join(outputDirectory, "_redirects"),
      `${marketingRedirects.trimEnd()}\n${scopeDocsRedirects(docsRedirects).trimEnd()}\n`,
      "utf8",
    ),
  ]);

  return outputDirectory;
}

async function main() {
  const outputDirectory = path.join(repositoryRoot, "dist/public-site");
  await composePublicSite({
    marketingDirectory: path.join(repositoryRoot, "apps/marketing/dist"),
    docsDirectory: path.join(repositoryRoot, "apps/docs/out"),
    outputDirectory,
  });
  console.log(`Composed public site at ${path.relative(repositoryRoot, outputDirectory)}.`);
}

if (import.meta.main) await main();
