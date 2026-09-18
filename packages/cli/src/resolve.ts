import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { chmod, mkdir, stat, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import path from "node:path";
import { assetName, assetTarget, checksumName } from "./platform.js";

export type CliBinary = "openpost-cli" | "openpost-mcp";

export interface ResolveOptions {
  binary?: CliBinary;
  releaseTag?: string;
  cacheDir?: string;
  fetch?: typeof fetch;
}

function env(name: string): string | undefined {
  const value = process.env[name];
  return value && value.length > 0 ? value : undefined;
}

export function releaseTag(options: ResolveOptions = {}): string {
  return options.releaseTag ?? env("OPENPOST_CLI_TAG") ?? defaultReleaseTag();
}

export function defaultReleaseTag(): string {
  // Pinned in package.json under the "openpost" key and bumped whenever the
  // wrapper picks up a newer CLI. Tests assert the pin looks like a release.
  const manifest = readManifest();
  const tag = manifest?.openpost?.releaseTag;
  if (typeof tag !== "string" || !/^v\d+\.\d+\.\d+$/.test(tag)) {
    throw new Error(
      `packages/cli/package.json must pin openpost.releaseTag to a release tag (got ${JSON.stringify(tag)}).`,
    );
  }
  return tag;
}

function readManifest(): { openpost?: { releaseTag?: unknown } } | undefined {
  try {
    // eslint-disable-next-line no-sync
    return JSON.parse(readFileSyncManifest());
  } catch {
    return undefined;
  }
}

// readFileSyncManifest keeps the sync manifest read in one seam so tests can
// cover resolve paths without touching the real package.json.
function readFileSyncManifest(): string {
  return readFileSync(new URL("../package.json", import.meta.url), "utf8");
}

export function cacheDir(tag: string, options: ResolveOptions = {}): string {
  return (
    options.cacheDir ??
    env("OPENPOST_CLI_DIR") ??
    path.join(homedir(), ".cache", "openpost", "cli", tag)
  );
}

export function downloadUrl(tag: string, asset: string): string {
  return `https://github.com/getopenpost/openpost/releases/download/${tag}/${asset}`;
}

// explicitBinaryPath honors operator overrides: OPENPOST_CLI_BIN for the CLI
// and OPENPOST_MCP_BIN for the MCP proxy. An explicit path skips download and
// checksum verification because the operator owns that file.
export function explicitBinaryPath(binary: CliBinary): string | undefined {
  return binary === "openpost-cli" ? env("OPENPOST_CLI_BIN") : env("OPENPOST_MCP_BIN");
}

export function allowUnverified(): boolean {
  return env("OPENPOST_CLI_ALLOW_UNVERIFIED") === "1";
}

export async function resolveBinaryPath(options: ResolveOptions = {}): Promise<string> {
  const binary = options.binary ?? "openpost-cli";
  const explicit = explicitBinaryPath(binary);
  if (explicit) return explicit;

  const tag = releaseTag(options);
  const target = assetTarget();
  const asset = assetName(binary, target);
  const dir = cacheDir(tag, options);
  const destination = path.join(dir, asset);

  if (await exists(destination)) return destination;

  const fetchImpl = options.fetch ?? globalThis.fetch;
  await downloadVerified(
    fetchImpl,
    downloadUrl(tag, asset),
    downloadUrl(tag, checksumName(asset)),
    destination,
  );
  return destination;
}

async function exists(file: string): Promise<boolean> {
  try {
    await stat(file);
    return true;
  } catch {
    return false;
  }
}

// downloadVerified fetches the binary and its detached .sha256 checksum from
// the GitHub release, then verifies before marking executable. Releases that
// predate checksum assets fail closed unless OPENPOST_CLI_ALLOW_UNVERIFIED=1
// explicitly opts into the legacy behavior.
async function downloadVerified(
  fetchImpl: typeof fetch,
  assetUrl: string,
  checksumUrl: string,
  destination: string,
): Promise<void> {
  const assetResponse = await fetchImpl(assetUrl);
  if (!assetResponse.ok) {
    throw new Error(
      `Download failed with HTTP ${assetResponse.status} for ${assetUrl}. ` +
        `Set OPENPOST_CLI_TAG to a release that ships this asset, ` +
        `or point OPENPOST_CLI_BIN at a local binary.`,
    );
  }
  const bytes = new Uint8Array(await assetResponse.arrayBuffer());

  const checksumResponse = await fetchImpl(checksumUrl);
  if (!checksumResponse.ok) {
    if (allowUnverified()) {
      await writeExecutable(destination, bytes);
      return;
    }
    throw new Error(
      `Release asset ${checksumUrl} is missing (HTTP ${checksumResponse.status}). ` +
        `Checksum verification is required; set OPENPOST_CLI_ALLOW_UNVERIFIED=1 only ` +
        `when you trust this network path, or use a newer release.`,
    );
  }
  const expected = parseChecksum(await checksumResponse.text());
  const actual = createHash("sha256").update(bytes).digest("hex");
  if (actual !== expected) {
    throw new Error(`Checksum mismatch for ${assetUrl}: expected ${expected}, got ${actual}.`);
  }
  await writeExecutable(destination, bytes);
}

export function parseChecksum(body: string): string {
  // sha256sum format: "<hex><space><space|*><filename>". Accept the hex of
  // the first non-empty line so trailing newlines never matter.
  for (const line of body.split("\n")) {
    const match = /^([a-fA-F0-9]{64})\s+\S/.exec(line.trim());
    if (match?.[1]) return match[1].toLowerCase();
  }
  throw new Error("Checksum file did not contain a SHA-256 hex digest.");
}

async function writeExecutable(destination: string, bytes: Uint8Array): Promise<void> {
  await mkdir(path.dirname(destination), { recursive: true });
  await writeFile(destination, bytes);
  if (process.platform !== "win32") await chmod(destination, 0o755);
}
