#!/usr/bin/env bun

// Splits a Go module's top-level tests across CI shards by test name.
// Whole-package sharding cannot help here: the slowest packages each run
// for longer than every other package combined. A name-based hash keeps
// assignment stable and needs no timing database, and every top-level test
// lands in exactly one shard. A name shared by two packages runs in both
// packages on the same shard, so nothing is skipped or duplicated.

import { existsSync, readFileSync } from "node:fs";
import path from "node:path";

const root = path.resolve(import.meta.dir, "..");
const topLevelTest = /^func (Test[A-Za-z0-9_]*)\(/gmu;

export function parseShard(value) {
  const match = /^([1-9][0-9]*)\/([1-9][0-9]*)$/u.exec(String(value ?? ""));
  if (!match)
    throw new Error(`Go test shard must look like 2/4, received ${JSON.stringify(value)}`);
  const index = Number(match[1]);
  const count = Number(match[2]);
  if (index > count) throw new Error(`Go test shard ${value} is outside its total`);
  return { index, count };
}

export function testNamesInSource(source) {
  return [...source.matchAll(topLevelTest)]
    .map((match) => match[1])
    .filter((name) => name !== "TestMain");
}

export function discoverGoTests(moduleDirectory, repositoryRoot = root) {
  const listing = Bun.spawnSync(
    [
      "git",
      "ls-files",
      "--cached",
      "--others",
      "--exclude-standard",
      "-z",
      "--",
      `${moduleDirectory}/*_test.go`,
    ],
    {
      cwd: repositoryRoot,
      stdout: "pipe",
      stderr: "pipe",
    },
  );
  if (listing.exitCode !== 0) {
    throw new Error(`could not list Go tests: ${listing.stderr.toString().trim()}`);
  }
  const files = listing.stdout
    .toString()
    .split("\0")
    .filter((file) => file && existsSync(path.join(repositoryRoot, file)));
  const names = new Set(
    files.flatMap((file) =>
      testNamesInSource(readFileSync(path.join(repositoryRoot, file), "utf8")),
    ),
  );
  if (names.size === 0) throw new Error(`no Go tests found under ${moduleDirectory}`);
  return [...names].sort();
}

// FNV-1a keeps the assignment identical across machines and runtimes.
function fnv1a(value) {
  let hash = 0x811c9dc5;
  for (const byte of new TextEncoder().encode(value)) {
    hash ^= byte;
    hash = Math.imul(hash, 0x01000193) >>> 0;
  }
  return hash;
}

export function shardTests(names, { index, count }) {
  return names.filter((name) => (fnv1a(name) % count) + 1 === index);
}

export function runPattern(names) {
  if (names.length === 0) throw new Error("a Go test shard must select at least one test");
  return `^(?:${names.join("|")})$`;
}

export function shardRunPattern(moduleDirectory, shard, repositoryRoot = root) {
  return runPattern(
    shardTests(discoverGoTests(moduleDirectory, repositoryRoot), parseShard(shard)),
  );
}

if (import.meta.main) {
  try {
    const [command, moduleDirectory, shard] = process.argv.slice(2);
    if (command !== "pattern" || !moduleDirectory || !shard) {
      throw new Error("usage: go-test-shards.mjs pattern <module-directory> <index/count>");
    }
    console.log(shardRunPattern(moduleDirectory, shard));
  } catch (error) {
    console.error(`go-test-shards: ${error.message}`);
    process.exitCode = 1;
  }
}
