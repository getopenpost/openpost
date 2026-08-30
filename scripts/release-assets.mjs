import { readFile } from "node:fs/promises";

const serverTargets = [
  ["linux", "amd64", ""],
  ["darwin", "arm64", ""],
  ["windows", "amd64", ".exe"],
];

const cliTargets = [
  ["linux", "amd64", ""],
  ["linux", "arm64", ""],
  ["darwin", "arm64", ""],
  ["windows", "amd64", ".exe"],
];

export const expectedReleaseAssets = Object.freeze([
  "release-manifest.json",
  "openpost-image-evidence.json",
  "openpost-image.spdx.json",
  "openpost-image-trivy.json",
  ...serverTargets.map(
    ([os, architecture, extension]) => `openpost-server-${os}-${architecture}${extension}`,
  ),
  ...cliTargets.flatMap(([os, architecture, extension]) => [
    `openpost-cli-${os}-${architecture}${extension}`,
    `openpost-mcp-${os}-${architecture}${extension}`,
  ]),
  "openpost-app-android.apk",
  "openpost-app-android-release.json",
]);

function normalizeNotes(value) {
  return String(value ?? "")
    .replaceAll("\r\n", "\n")
    .trimEnd();
}

export function validateRelease(release, options) {
  const problems = [];
  const expectedDraft = options.published !== true;
  if (!release || typeof release !== "object" || Array.isArray(release)) {
    return ["release response must be an object"];
  }
  if (release.tag_name !== options.tag) {
    problems.push("release tag does not match the workflow tag");
  }
  if (release.name !== options.tag) {
    problems.push("release title does not match the workflow tag");
  }
  if (release.draft !== expectedDraft) {
    problems.push(
      expectedDraft ? "tag release must remain a draft" : "tag release was not published",
    );
  }
  if (release.prerelease !== false) {
    problems.push("tag release must not be a prerelease");
  }
  if (normalizeNotes(release.body) !== normalizeNotes(options.notes)) {
    problems.push("release notes do not match the canonical changelog");
  }
  if (!Array.isArray(release.assets)) {
    problems.push("release assets must be an array");
    return problems;
  }

  const expected = new Set(expectedReleaseAssets);
  const seen = new Set();
  for (const asset of release.assets) {
    const name = asset?.name;
    if (typeof name !== "string" || name.length === 0) {
      problems.push("release asset has no valid name");
      continue;
    }
    if (seen.has(name)) problems.push(`duplicate release asset: ${name}`);
    seen.add(name);
    if (!expected.has(name)) problems.push(`unexpected release asset: ${name}`);
    if (asset.state !== "uploaded" || !Number.isInteger(asset.size) || asset.size <= 0) {
      problems.push(`release asset is not completely uploaded: ${name}`);
    }
  }

  if (options.complete === true) {
    for (const name of expected) {
      if (!seen.has(name)) problems.push(`missing release asset: ${name}`);
    }
  }
  return problems;
}

function option(name) {
  const index = process.argv.indexOf(name);
  return index >= 0 ? process.argv[index + 1] : undefined;
}

async function main() {
  if (process.argv[2] !== "verify") {
    throw new Error(
      "usage: release-assets.mjs verify --release-json FILE --tag TAG --notes-file FILE [--complete] [--published]",
    );
  }
  const releaseJSON = option("--release-json");
  const tag = option("--tag");
  const notesFile = option("--notes-file");
  if (!releaseJSON || !tag || !notesFile) {
    throw new Error("release JSON, tag, and notes file are required");
  }
  const [releaseSource, notes] = await Promise.all([
    readFile(releaseJSON, "utf8"),
    readFile(notesFile, "utf8"),
  ]);
  const problems = validateRelease(JSON.parse(releaseSource), {
    tag,
    notes,
    complete: process.argv.includes("--complete"),
    published: process.argv.includes("--published"),
  });
  if (problems.length > 0) throw new Error(problems.join("; "));
  console.log(
    `Verified ${process.argv.includes("--published") ? "published" : "draft"} release ${tag} with ${process.argv.includes("--complete") ? "all" : "only expected"} assets.`,
  );
}

if (import.meta.main) {
  main().catch((error) => {
    console.error(`release-assets: ${error.message}`);
    process.exitCode = 1;
  });
}
