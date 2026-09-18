import { createHash, randomBytes } from "node:crypto";
import { readFileSync } from "node:fs";
import { chmod, lstat, mkdir, readFile, rename, writeFile } from "node:fs/promises";
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

// Release binaries are tens of megabytes. Anything far larger is either the
// wrong asset or hostile; refuse it before buffering the whole body.
const MAX_DOWNLOAD_BYTES = 256 * 1024 * 1024;

const RELEASE_TAG_PATTERN = /^v\d+\.\d+\.\d+$/;

function env(name: string): string | undefined {
  const value = process.env[name];
  return value && value.length > 0 ? value : undefined;
}

export function releaseTag(options: ResolveOptions = {}): string {
  const tag = options.releaseTag ?? env("OPENPOST_CLI_TAG") ?? defaultReleaseTag();
  if (!RELEASE_TAG_PATTERN.test(tag)) {
    throw new Error(
      `Refusing to resolve OpenPost CLI release ${JSON.stringify(tag)}: ` +
        `expected a release tag like v4.35.0.`,
    );
  }
  return tag;
}

export function defaultReleaseTag(): string {
  // Pinned in package.json under the "openpost" key and bumped whenever the
  // wrapper picks up a newer CLI. Tests assert the pin looks like a release.
  const manifest = readManifest();
  const tag = manifest?.openpost?.releaseTag;
  if (typeof tag !== "string" || !RELEASE_TAG_PATTERN.test(tag)) {
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
  const root = options.cacheDir ?? env("OPENPOST_CLI_DIR") ?? defaultCacheRoot();
  // The tag segment always applies, including under an explicit directory, so
  // two releases never share one cached filename.
  return path.join(root, tag);
}

function defaultCacheRoot(): string {
  return path.join(homedir(), ".cache", "openpost", "cli");
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

function warnUnverified(assetUrl: string): void {
  console.error(
    `warning: installing ${assetUrl} without checksum verification ` +
      `(OPENPOST_CLI_ALLOW_UNVERIFIED=1). Only use this on a network path you trust.`,
  );
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

  const cached = await verifiedCacheHit(destination);
  if (cached) return destination;

  const fetchImpl = options.fetch ?? globalThis.fetch;
  await downloadVerified(
    fetchImpl,
    downloadUrl(tag, asset),
    downloadUrl(tag, checksumName(asset)),
    destination,
    asset,
  );
  return destination;
}

// verifiedCacheHit re-verifies a cached binary on every hit. The expected hex
// lives in a sidecar written at install time; a missing sidecar, a symlink, a
// hash mismatch, or any read failure forces a fresh verified download instead
// of executing a stranger's bytes.
async function verifiedCacheHit(destination: string): Promise<boolean> {
  try {
    const entry = await lstat(destination);
    if (!entry.isFile()) return false;
    const sidecar = await readFile(`${destination}.hex`, "utf8").catch(() => null);
    if (sidecar === null) return false;
    const expected = sidecar.trim().toLowerCase();
    if (!/^[a-f0-9]{64}$/.test(expected)) return false;
    const actual = createHash("sha256")
      .update(await readFile(destination))
      .digest("hex");
    return actual === expected;
  } catch {
    return false;
  }
}

// downloadVerified fetches the binary and its detached .sha256 checksum from
// the GitHub release, then verifies before installing atomically. Releases
// that predate checksum assets fail closed unless OPENPOST_CLI_ALLOW_UNVERIFIED=1
// explicitly opts into the legacy behavior.
async function downloadVerified(
  fetchImpl: typeof fetch,
  assetUrl: string,
  checksumUrl: string,
  destination: string,
  asset: string,
): Promise<void> {
  const assetResponse = await fetchImpl(assetUrl);
  if (!assetResponse.ok) {
    throw new Error(
      `Download failed with HTTP ${assetResponse.status} for ${assetUrl}. ` +
        `Set OPENPOST_CLI_TAG to a release that ships this asset, ` +
        `or point OPENPOST_CLI_BIN at a local binary.`,
    );
  }
  const bytes = await readBounded(assetResponse, assetUrl);

  const checksumResponse = await fetchImpl(checksumUrl);
  if (!checksumResponse.ok) {
    if (allowUnverified()) {
      warnUnverified(assetUrl);
      await writeExecutable(destination, bytes, null);
      return;
    }
    throw new Error(
      `Release asset ${checksumUrl} is missing (HTTP ${checksumResponse.status}). ` +
        `Checksum verification is required; set OPENPOST_CLI_ALLOW_UNVERIFIED=1 only ` +
        `when you trust this network path, or use a newer release.`,
    );
  }
  const expected = parseChecksum(await checksumResponse.text(), asset);
  const actual = createHash("sha256").update(bytes).digest("hex");
  if (actual !== expected) {
    throw new Error(`Checksum mismatch for ${assetUrl}: expected ${expected}, got ${actual}.`);
  }
  await writeExecutable(destination, bytes, expected);
}

async function readBounded(response: Response, assetUrl: string): Promise<Uint8Array> {
  const declared = response.headers.get("content-length");
  if (declared !== null) {
    const size = Number(declared);
    if (!Number.isFinite(size) || size < 0 || size > MAX_DOWNLOAD_BYTES) {
      throw new Error(
        `Refusing to download ${assetUrl}: declared size ${declared} exceeds the ${MAX_DOWNLOAD_BYTES}-byte limit.`,
      );
    }
  }
  const bytes = new Uint8Array(await response.arrayBuffer());
  if (bytes.byteLength > MAX_DOWNLOAD_BYTES) {
    throw new Error(
      `Refusing to install ${assetUrl}: downloaded ${bytes.byteLength} bytes exceeds the ${MAX_DOWNLOAD_BYTES}-byte limit.`,
    );
  }
  return bytes;
}

export function parseChecksum(body: string, asset: string): string {
  // sha256sum format: "<hex><space><space|*><filename>". The filename must
  // name this asset so a checksum file for another binary cannot validate it.
  for (const line of body.split("\n")) {
    const match = /^([a-fA-F0-9]{64})\s+(\S+)\s*$/.exec(line.trim());
    if (match?.[1] && match[2] === asset) return match[1].toLowerCase();
  }
  throw new Error(`Checksum file did not contain a SHA-256 digest for ${asset}.`);
}

async function writeExecutable(
  destination: string,
  bytes: Uint8Array,
  expectedHex: string | null,
): Promise<void> {
  await mkdir(path.dirname(destination), { recursive: true });
  // Write to a sibling temp file and rename into place so a concurrent or
  // interrupted install never leaves a truncated binary behind. The mode is
  // set at creation so the executable bit never passes through a window
  // where the file is world-writable.
  const staging = `${destination}.${randomBytes(8).toString("hex")}.tmp`;
  const mode = process.platform === "win32" ? 0o666 : 0o755;
  await writeFile(staging, bytes, { mode });
  if (expectedHex !== null) await writeFile(`${staging}.hex`, `${expectedHex}\n`, { mode: 0o600 });
  await rename(staging, destination);
  if (expectedHex !== null) await rename(`${staging}.hex`, `${destination}.hex`);
}
