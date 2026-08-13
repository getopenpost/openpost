#!/usr/bin/env bun

import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const repositoryRoot = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "..",
);
const stableVersionPattern = /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/;

export function validateMCPRegistryOwnership({ manifest, listings, docs }) {
  if (manifest?.name !== "io.github.rodrgds/openpost") {
    throw new Error("server.json must retain the published OpenPost MCP name");
  }
  if (!stableVersionPattern.test(String(manifest.version ?? ""))) {
    throw new Error("server.json version must be a stable semantic version");
  }
  const remotes = Array.isArray(manifest.remotes) ? manifest.remotes : [];
  if (
    remotes.length !== 1 ||
    remotes[0]?.type !== "streamable-http" ||
    remotes[0]?.url !== "https://app.openpost.social/mcp"
  ) {
    throw new Error(
      "server.json must describe the canonical managed MCP endpoint",
    );
  }

  const escapedName = manifest.name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const listingMatch = new RegExp(
    "Published as `" + escapedName + "` version `([^`]+)`",
  ).exec(listings);
  if (!listingMatch) {
    throw new Error("launch-kit listing must record the published MCP version");
  }
  if (listingMatch[1] !== manifest.version) {
    throw new Error(
      `server.json version ${manifest.version} does not match the published listing ${listingMatch[1]}`,
    );
  }
  if (!docs.includes("## Registry listing version and compatibility")) {
    throw new Error("MCP docs must define registry version ownership");
  }
  return manifest.version;
}

export function checkMCPRegistryOwnership(root = repositoryRoot) {
  const manifest = JSON.parse(
    readFileSync(path.join(root, "server.json"), "utf8"),
  );
  const listings = readFileSync(
    path.join(root, "launch-kit/listings.md"),
    "utf8",
  );
  const docs = readFileSync(
    path.join(root, "docs-site/development/mcp.md"),
    "utf8",
  );
  return validateMCPRegistryOwnership({ manifest, listings, docs });
}

if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href
) {
  try {
    const version = checkMCPRegistryOwnership();
    console.log(`MCP registry ownership is consistent at ${version}.`);
  } catch (error) {
    console.error(`check-mcp-registry: ${error.message}`);
    process.exitCode = 1;
  }
}
