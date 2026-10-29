#!/usr/bin/env bun
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { readFileSync, writeFileSync } from "node:fs";
import { distributionPlan, mobileChanged } from "./release-distribution-plan.mjs";
import { coreReleaseAssets } from "./release-assets.mjs";

const stable = /^v\d+\.\d+\.\d+$/;
const cliAssets = coreReleaseAssets.filter((name) => /^openpost-(cli|mcp)-/.test(name));
function command(name, args) {
  return execFileSync(name, args, {
    encoding: "utf8",
    timeout: 120000,
    maxBuffer: 16 * 1024 * 1024,
  }).trim();
}
const git = (args) => command("git", args);
const paths = async (base, head) =>
  git(["diff", "--name-only", "--no-renames", base, head, "--"]).split("\n").filter(Boolean);
function completeAsset(asset, repository, tag) {
  return (
    asset?.state === "uploaded" &&
    Number.isInteger(asset.size) &&
    asset.size > 0 &&
    /^sha256:[a-f0-9]{64}$/.test(asset.digest ?? "") &&
    asset.browser_download_url ===
      `https://github.com/${repository}/releases/download/${tag}/${asset.name}`
  );
}
async function verifyDownload(
  url,
  algorithm,
  expected,
  encoding = "hex",
  size,
  captureText = false,
) {
  const response = await fetch(url, { signal: AbortSignal.timeout(180000) });
  if (!response.ok || !response.body) throw Error(`Download failed: ${url} (${response.status})`);
  const hash = createHash(algorithm);
  let bytes = 0;
  const chunks = [];
  for await (const chunk of response.body) {
    bytes += chunk.length;
    if (captureText) {
      if (bytes > 65536) throw Error(`Checksum file is too large: ${url}`);
      chunks.push(chunk);
    }
    hash.update(chunk);
  }
  if (hash.digest(encoding) !== expected || (size !== undefined && bytes !== size))
    throw Error(`Download integrity mismatch: ${url}`);
  if (captureText) return Buffer.concat(chunks).toString("utf8");
}
async function registryPackage(directory) {
  const local = JSON.parse(readFileSync(`${directory}/package.json`, "utf8"));
  const version = local.version;
  const response = await fetch(
    `https://registry.npmjs.org/${encodeURIComponent(local.name)}/${version}`,
    { signal: AbortSignal.timeout(30000) },
  );
  if (!response.ok) throw Error(`Missing registry package ${local.name}@${version}`);
  const metadata = await response.json();
  if (
    metadata.name !== local.name ||
    metadata.version !== version ||
    !/^\d+\.\d+\.\d+$/.test(version) ||
    !/^sha512-[A-Za-z0-9+/]+=*$/.test(metadata.dist?.integrity ?? "") ||
    !metadata.dist?.tarball?.startsWith(`https://registry.npmjs.org/${local.name}/-/`)
  )
    throw Error(`Invalid registry metadata for ${local.name}`);
  await verifyDownload(metadata.dist.tarball, "sha512", metadata.dist.integrity.slice(7), "base64");
  return { name: local.name, version, pin: metadata.openpost?.releaseTag };
}

// Dependencies are explicit so failure and release-chain behavior can be tested
// without network access. Every linked download is checked before notes persist.
export async function reusedDownloads(options, dependencies = {}) {
  const { repository, tag, plan, identity } = options;
  const deps = {
    releases: async () =>
      command("gh", [
        "api",
        "--paginate",
        `repos/${repository}/releases?per_page=100`,
        "--jq",
        ".[] | {tag_name,draft,prerelease,assets:[.assets[] | {name,state,size,digest,browser_download_url}]} | @json",
      ])
        .split("\n")
        .filter(Boolean)
        .map((line) => JSON.parse(line)),
    identity: async (tag) => JSON.parse(git(["show", `${tag}:apps/mobile/app.json`])),
    paths,
    verifyAsset: async (asset) =>
      verifyDownload(
        asset.browser_download_url,
        "sha256",
        asset.digest.slice(7),
        "hex",
        asset.size,
        asset.name.endsWith(".sha256"),
      ),
    registry: registryPackage,
    ...dependencies,
  };
  const lines = [];
  let releases;
  if (!plan.mobile || !plan.cli)
    releases = (await deps.releases()).filter(
      (release) =>
        stable.test(release.tag_name ?? "") &&
        release.tag_name !== tag &&
        !release.draft &&
        !release.prerelease,
    );
  if (!plan.mobile) {
    let found;
    for (const release of releases) {
      const assets = release.assets.filter((asset) => asset.name === "openpost-app-android.apk");
      if (!assets.length) continue;
      if (assets.length !== 1 || !completeAsset(assets[0], repository, release.tag_name))
        throw Error(`Invalid prior APK: ${release.tag_name}`);
      const prior = await deps.identity(release.tag_name);
      if (
        prior.expo?.version !== identity.expo?.version ||
        prior.expo?.android?.versionCode !== identity.expo?.android?.versionCode
      )
        continue;
      if (mobileChanged(await deps.paths(release.tag_name, tag)))
        throw Error("Prior APK inputs differ from this release");
      await deps.verifyAsset(assets[0]);
      found = `- Android ${identity.expo.version} (${identity.expo.android.versionCode}): [download APK](${assets[0].browser_download_url}) from ${release.tag_name}.`;
      break;
    }
    if (!found) throw Error("No verified published APK matches the current Android identity");
    lines.push(found);
  }
  if (!plan.cli) {
    const release = releases.find((release) =>
      cliAssets.every((name) => release.assets.filter((asset) => asset.name === name).length === 1),
    );
    if (!release || distributionPlan(await deps.paths(release.tag_name, tag)).cli)
      throw Error("No published CLI/MCP assets match the current inputs");
    for (const name of cliAssets) {
      const asset = release.assets.find((asset) => asset.name === name);
      if (!completeAsset(asset, repository, release.tag_name))
        throw Error(`Invalid prior CLI asset: ${name}`);
      const text = await deps.verifyAsset(asset);
      if (name.endsWith(".sha256")) {
        const binaryName = name.slice(0, -7);
        const binary = release.assets.find((asset) => asset.name === binaryName);
        const checksum = /^([a-f0-9]{64}) [ *](\S+)\r?\n?$/i.exec(text ?? "");
        if (
          !checksum ||
          checksum[1].toLowerCase() !== binary.digest?.slice(7) ||
          checksum[2] !== binaryName
        )
          throw Error(`CLI checksum does not match its binary: ${name}`);
      }
    }
    lines.push(
      `- CLI and MCP binaries: [${release.tag_name} downloads](https://github.com/${repository}/releases/tag/${release.tag_name}).`,
    );
  }
  for (const [key, directory] of [
    ["sdk", "packages/sdk"],
    ["n8n", "packages/n8n-nodes-openpost"],
    ["cli", "packages/cli"],
  ]) {
    if (plan[key]) continue;
    const pkg = await deps.registry(directory);
    if (key === "cli") {
      const pinned = releases.find((release) => release.tag_name === pkg.pin);
      if (
        !stable.test(pkg.pin ?? "") ||
        !pinned ||
        !cliAssets.every(
          (name) =>
            pinned.assets.filter(
              (asset) => asset.name === name && completeAsset(asset, repository, pkg.pin),
            ).length === 1,
        )
      )
        throw Error("Published CLI wrapper pin has no complete public release");
    }
    lines.push(
      `- ${pkg.name}: [${pkg.version}](https://www.npmjs.com/package/${pkg.name}/v/${pkg.version})${key === "cli" ? ` (wrapper pins ${pkg.pin})` : ""}.`,
    );
  }
  return lines.length
    ? `\n\n### Unchanged distributions\n\nThese distributions retain their existing versions and downloads.\n\n${lines.join("\n")}\n`
    : "";
}

if (import.meta.main) {
  const [tag, planFile, output] = process.argv.slice(2);
  if (!stable.test(tag ?? "") || !planFile || !output)
    throw Error("usage: release-reuse-notes.mjs TAG PLAN_JSON OUTPUT");
  writeFileSync(
    output,
    await reusedDownloads({
      repository: process.env.GITHUB_REPOSITORY,
      tag,
      plan: JSON.parse(readFileSync(planFile, "utf8")),
      identity: JSON.parse(readFileSync("apps/mobile/app.json", "utf8")),
    }),
  );
}
