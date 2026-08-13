import { execFileSync } from "node:child_process";
import { pathToFileURL } from "node:url";

const stableVersionPattern = /^v?(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/;
const conventionalHeaderPattern =
  /^[a-z][a-z0-9-]*(?:\([^)\r\n]+\))?(!)?:\s+\S/i;
const featureHeaderPattern = /^feat(?:\([^)\r\n]+\))?!?:\s+\S/i;
const breakingFooterPattern = /^BREAKING(?: CHANGE|-CHANGE):\s+\S/im;
const bumpRank = { patch: 0, minor: 1, major: 2 };

export function parseStableVersion(value) {
  const match = stableVersionPattern.exec(String(value).trim());
  if (!match) {
    throw new Error(
      `expected a stable version such as v1.2.3, received ${JSON.stringify(value)}`,
    );
  }
  return match.slice(1).map(Number);
}

export function compareVersions(left, right) {
  const leftParts = parseStableVersion(left);
  const rightParts = parseStableVersion(right);
  for (let index = 0; index < leftParts.length; index += 1) {
    if (leftParts[index] !== rightParts[index]) {
      return Math.sign(leftParts[index] - rightParts[index]);
    }
  }
  return 0;
}

export function classifyCommitMessages(messages) {
  if (messages.length === 0) {
    throw new Error("no commits found since the latest release tag");
  }

  let hasFeature = false;
  for (const message of messages) {
    const normalized = String(message).trim();
    const [header = ""] = normalized.split(/\r?\n/, 1);
    const conventionalMatch = conventionalHeaderPattern.exec(header);
    if (conventionalMatch?.[1] || breakingFooterPattern.test(normalized)) {
      return "major";
    }
    if (featureHeaderPattern.test(header)) {
      hasFeature = true;
    }
  }

  return hasFeature ? "minor" : "patch";
}

export function includePendingCommitMessage(messages, pendingMessage) {
  const normalized = String(pendingMessage ?? "").trim();
  return normalized ? [...messages, normalized] : [...messages];
}

export function incrementVersion(currentVersion, bump) {
  const [major, minor, patch] = parseStableVersion(currentVersion);
  switch (bump) {
    case "major":
      return `v${major + 1}.0.0`;
    case "minor":
      return `v${major}.${minor + 1}.0`;
    case "patch":
      return `v${major}.${minor}.${patch + 1}`;
    default:
      throw new Error(`unsupported release bump ${JSON.stringify(bump)}`);
  }
}

export function resolveNextTag(currentVersion, messages, options = {}) {
  const exactVersion = String(options.exactVersion ?? "").trim();
  const requestedBump = String(options.bump ?? "")
    .trim()
    .toLowerCase();

  if (exactVersion && requestedBump) {
    throw new Error("RELEASE_VERSION and RELEASE_BUMP cannot be used together");
  }

  const requiredBump = classifyCommitMessages(messages);
  const requiredTag = incrementVersion(currentVersion, requiredBump);

  if (exactVersion) {
    const tag = exactVersion.startsWith("v")
      ? exactVersion
      : `v${exactVersion}`;
    parseStableVersion(tag);
    if (compareVersions(tag, currentVersion) <= 0) {
      throw new Error(
        `${tag} must be greater than the latest tag ${currentVersion}`,
      );
    }
    if (compareVersions(tag, requiredTag) < 0) {
      throw new Error(
        `${tag} is lower than the required ${requiredTag} for ${requiredBump} changes`,
      );
    }
    return tag;
  }

  if (
    requestedBump &&
    (!Object.hasOwn(bumpRank, requestedBump) ||
      bumpRank[requestedBump] < bumpRank[requiredBump])
  ) {
    throw new Error(
      `RELEASE_BUMP=${requestedBump} cannot lower the required ${requiredBump} bump`,
    );
  }

  const bump = requestedBump || requiredBump;
  return incrementVersion(currentVersion, bump);
}

function gitMessages(range) {
  const output = execFileSync("git", ["log", "--format=%B%x1e", range], {
    encoding: "utf8",
    stdio: ["ignore", "pipe", "inherit"],
  });
  return output
    .split("\x1e")
    .map((message) => message.trim())
    .filter(Boolean);
}

function main() {
  const currentVersion = process.argv[2];
  if (!currentVersion) {
    throw new Error(
      "usage: bun scripts/next-release-version.mjs <latest-tag> [git-range]",
    );
  }

  const range = process.argv[3] || `${currentVersion}..HEAD`;
  const messages = includePendingCommitMessage(
    gitMessages(range),
    process.env.PENDING_COMMIT_MESSAGE,
  );
  const tag = resolveNextTag(currentVersion, messages, {
    exactVersion: process.env.RELEASE_VERSION,
    bump: process.env.RELEASE_BUMP,
  });
  process.stdout.write(`${tag}\n`);
}

if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(process.argv[1]).href
) {
  try {
    main();
  } catch (error) {
    console.error(`next-release-version: ${error.message}`);
    process.exitCode = 1;
  }
}
