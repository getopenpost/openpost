// Cross-language conformance check for getopenpost/openpost#415.
//
// Platform text limits and counting rules exist twice: TypeScript owns the
// composer counter in packages/platform-text, Go owns publish validation in
// apps/server/internal/{capabilities,providerlimits}. The per-language tests
// pin each side to packages/platform-text/conformance/fixtures.json; this
// script parses both sources directly (offline, no build) and fails when the
// two implementations disagree with each other.
//
// Canonical rule: @openpost/platform-text owns public platform text limits
// and counting rules; account-specific limit resolution stays in the web app.
// Media limits shared by the capability catalogue and provider validators
// belong in apps/server/internal/providerlimits/.
import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

import { reportProblems } from "./report-problems.mjs";

export const repositoryRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

const SHORT_TEXT_PROFILE = "ContentProfileShortText";

export function parseIntLiteral(value) {
  return Number.parseInt(value.replaceAll("_", ""), 10);
}

export function parseTypeScriptTextFacts(source) {
  const constant = (name) => {
    const match = source.match(new RegExp(`${name}\\s*=\\s*([\\d_]+)`));
    if (!match) throw new Error(`TypeScript constant ${name} is missing`);
    return parseIntLiteral(match[1]);
  };
  const constants = {
    xStandard: constant("X_STANDARD_CHAR_LIMIT"),
    xPremium: constant("X_PREMIUM_CHAR_LIMIT"),
    youtubeDescriptionMaxBytes: constant("YOUTUBE_DESCRIPTION_MAX_BYTES"),
    xTransformedURLLength: constant("X_TRANSFORMED_URL_LENGTH"),
    mastodonURLLength: constant("MASTODON_URL_LENGTH"),
  };
  const limits = {};
  const blockPattern = /(\w+):\s*\{\s*key:\s*"([^"]+)"[\s\S]*?charLimit:\s*([A-Za-z_]\w*|[\d_]+)/g;
  for (const match of source.matchAll(blockPattern)) {
    const key = match[2];
    const raw = match[3].trim();
    limits[key] = /^[\d_]+$/.test(raw) ? parseIntLiteral(raw) : (constants[raw] ?? constant(raw));
  }
  if (Object.keys(limits).length === 0) throw new Error("PLATFORM_LIMITS has no entries");
  return { constants, limits };
}

export function parseGoTextFacts({ capabilities, textLength, youtube, devnull }) {
  const providerSlugs = new Map(
    [...capabilities.matchAll(/^\s*(Provider\w+)\s*=\s*"([^"]+)"/gm)].map((match) => [
      match[1],
      match[2],
    ]),
  );
  if (providerSlugs.size === 0) throw new Error("Go provider constants are missing");

  const providerConstants = {
    YouTubeDescriptionMaxBytes: undefined,
    DevNullMaxBodyBytes: undefined,
  };
  // Some capability limits reference another provider-limits constant rather
  // than a literal (DevNullMaxBodyBytes aliases DevNullMaxBodyCharacters), so
  // follow one-level identifier references to the numeric literal.
  const goIntConstant = (source, name, seen = new Set()) => {
    if (seen.has(name)) return undefined;
    seen.add(name);
    const match = source.match(new RegExp(`\\b${name}\\s*=\\s*([\\d_]+|[A-Za-z_]\\w*)`));
    if (!match) return undefined;
    const raw = match[1];
    return /^[\d_]+$/.test(raw) ? parseIntLiteral(raw) : goIntConstant(source, raw, seen);
  };
  for (const [source, name] of [
    [youtube, "YouTubeDescriptionMaxBytes"],
    [devnull ?? "", "DevNullMaxBodyBytes"],
  ]) {
    providerConstants[name] = goIntConstant(source, name);
  }

  const byProvider = new Map();
  const tuplePattern =
    /Provider:\s*(Provider\w+).*?Profile:\s*models\.(\w+).*?TextLimit:\s*([\d_]+|providerlimits\.\w+)/g;
  for (const match of capabilities.matchAll(tuplePattern)) {
    const slug = providerSlugs.get(match[1]);
    if (!slug) throw new Error(`Go provider constant ${match[1]} has no slug`);
    const raw = match[3];
    const limit = raw.startsWith("providerlimits.")
      ? providerConstants[raw.slice("providerlimits.".length)]
      : parseIntLiteral(raw);
    if (limit === undefined) continue;
    if (!byProvider.has(slug)) byProvider.set(slug, []);
    byProvider.get(slug).push({ profile: match[2], limit });
  }

  const standardMatch = capabilities.match(
    /if provider == ProviderX \{[^}]*?return\s+([\d_]+),\s*true/s,
  );
  if (!standardMatch) throw new Error("Go ProviderTextLimit X branch is missing");

  const urlLength = (source, name) => {
    const match = source.match(new RegExp(`${name}\\s*=\\s*(\\d+)`));
    if (!match) throw new Error(`Go constant ${name} is missing`);
    return Number.parseInt(match[1], 10);
  };

  const standard = parseIntLiteral(standardMatch[1]);
  const limits = new Map(
    [...byProvider].map(([slug, entries]) => [
      slug,
      // Mirror ProviderTextLimit: legacy validation without account context
      // keeps X's standard limit while the catalog carries premium limits.
      slug === "x"
        ? standard
        : (entries.find((entry) => entry.profile === SHORT_TEXT_PROFILE)?.limit ??
          Math.min(...entries.map((entry) => entry.limit))),
    ]),
  );

  return {
    constants: {
      xStandard: standard,
      xPremium: byProvider.get("x")?.[0]?.limit,
      youtubeDescriptionMaxBytes: providerConstants.YouTubeDescriptionMaxBytes,
      xTransformedURLLength: urlLength(textLength, "XTransformedURLLength"),
      mastodonURLLength: urlLength(textLength, "MastodonCountedURLLength"),
    },
    limits,
  };
}

export function platformTextConformanceProblems(ts, go) {
  const problems = [];
  const names = {
    xStandard: "X standard char limit",
    xPremium: "X premium char limit",
    youtubeDescriptionMaxBytes: "YouTube description max bytes",
    xTransformedURLLength: "X transformed URL length",
    mastodonURLLength: "Mastodon URL length",
  };
  for (const [key, label] of Object.entries(names)) {
    if (go.constants[key] === undefined) {
      problems.push(`Go has no maintained value for ${label}`);
    } else if (ts.constants[key] !== go.constants[key]) {
      problems.push(
        `${label} disagrees: TypeScript ${ts.constants[key]} vs Go ${go.constants[key]}`,
      );
    }
  }
  for (const [platform, tsLimit] of Object.entries(ts.limits)) {
    if (!go.limits.has(platform)) {
      problems.push(`TypeScript platform ${platform} has no Go text limit`);
    } else if (go.limits.get(platform) !== tsLimit) {
      problems.push(
        `Platform ${platform} limit disagrees: TypeScript ${tsLimit} vs Go ${go.limits.get(platform)}`,
      );
    }
  }
  return problems;
}

export async function validatePlatformTextConformance(root = repositoryRoot) {
  const [tsSource, capabilities, textLength, youtube] = await Promise.all(
    [
      "packages/platform-text/src/index.ts",
      "apps/server/internal/capabilities/capabilities.go",
      "apps/server/internal/providerlimits/text.go",
      "apps/server/internal/providerlimits/youtube.go",
    ].map((file) => readFile(path.join(root, file), "utf8")),
  );
  // devnull.go is in-flight work; when absent, devnull entries resolve through
  // the TypeScript side only and the per-platform comparison still applies
  // wherever both sides maintain the provider.
  const devnull = await readFile(
    path.join(root, "apps/server/internal/providerlimits/devnull.go"),
    "utf8",
  ).catch(() => "");
  return platformTextConformanceProblems(
    parseTypeScriptTextFacts(tsSource),
    parseGoTextFacts({ capabilities, textLength, youtube, devnull }),
  );
}

async function main() {
  const problems = await validatePlatformTextConformance();
  reportProblems("Platform text conformance check failed", problems);
  console.log("TypeScript and Go platform text limits and counting lengths agree.");
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  await main();
}
