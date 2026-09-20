#!/usr/bin/env bun

import { cp, mkdir, readFile, rm, stat, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const repositoryRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

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

  const mountedDocsDirectory = path.join(outputDirectory, "docs");
  await cp(docsDirectory, mountedDocsDirectory, { recursive: true });
  await Promise.all([
    rm(path.join(mountedDocsDirectory, "_headers"), { force: true }),
    rm(path.join(mountedDocsDirectory, "_redirects"), { force: true }),
  ]);

  await Promise.all([
    writeFile(
      path.join(outputDirectory, "_headers"),
      `${marketingHeaders.trimEnd()}\n${scopeDocsHeaders(docsHeaders).trimEnd()}\n`,
      "utf8",
    ),
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
