#!/usr/bin/env bun

import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
export const publicClaimManifestPath = path.join(root, "provider-certification/public-claims.json");
const publicProjectionStart = "<!-- provider-certification:begin -->";
const publicProjectionEnd = "<!-- provider-certification:end -->";

const gitRevisionPattern = /^[0-9a-f]{40}$/u;
const digestPattern = /^sha256:[0-9a-f]{64}$/u;
const safeSlugPattern = /^[a-z0-9]+(?:[._-][a-z0-9]+)*$/u;
const safeIdentifierPattern = /^[A-Za-z0-9]+(?:[._:-][A-Za-z0-9]+)*$/u;
const safeDocumentationQueryValuePattern = /^[A-Za-z0-9._-]+$/u;
const allowedDocumentationQueryKeys = new Set(["hl", "locale", "view"]);
const configurationSources = new Set(["built_in", "database", "dynamic", "environment"]);
const claimOperations = new Set(["publish_immediate", "publish_scheduled"]);
const optionalLifecycleChecks = new Set(["refresh", "revoke"]);
const knownChecks = new Set([
  "authorization",
  "connect",
  "final_result",
  "publish_immediate",
  "publish_scheduled",
  "refresh",
  "revoke",
]);
const providerSourceRules = {
  bluesky: [{ host: "docs.bsky.app", path: "/docs/" }],
  discord: [{ host: "docs.discord.com", path: "/developers/" }],
  facebook: [{ host: "www.postman.com", path: "/meta/facebook/" }],
  instagram: [{ host: "www.postman.com", path: "/meta/instagram/" }],
  linkedin: [{ host: "learn.microsoft.com", path: "/en-us/linkedin/" }],
  mastodon: [{ host: "docs.joinmastodon.org", path: "/" }],
  threads: [{ host: "www.postman.com", path: "/meta/threads/" }],
  tiktok: [{ host: "developers.tiktok.com", path: "/doc/" }],
  x: [{ host: "docs.x.com", path: "/x-api/" }],
  youtube: [{ host: "developers.google.com", path: "/youtube/" }],
};

export async function readPublicClaimManifest(manifestPath = publicClaimManifestPath, options) {
  const manifest = JSON.parse(await readFile(manifestPath, "utf8"));
  return validatePublicClaimManifest(manifest, options);
}

export async function readPublicClaimManifestBinding(
  manifestPath = publicClaimManifestPath,
  options,
) {
  const contents = await readFile(manifestPath);
  const manifest = validatePublicClaimManifest(JSON.parse(contents.toString("utf8")), options);
  assertNoUnprojectedPublicClaims(manifest);
  await assertPublicClaimSurfaces(manifest);
  return {
    schema_version: manifest.schema_version,
    manifest_sha256: `sha256:${createHash("sha256").update(contents).digest("hex")}`,
    claim_count: manifest.claims.length,
  };
}

export function validatePublicClaimManifest(manifest, options = {}) {
  assertExactKeys(manifest, ["claims", "schema_version"], "manifest");
  if (manifest.schema_version !== 1) {
    throw new Error("manifest.schema_version must be 1");
  }
  if (!Array.isArray(manifest.claims)) {
    throw new Error("manifest.claims must be an array");
  }

  const now = parseNow(options.now);
  validateOptionalRevision(options.currentRevision);
  if (options.requireExactRevision === true && options.currentRevision === undefined) {
    throw new Error("currentRevision is required when exact revision matching is enabled");
  }
  const seenSubjects = new Set();
  for (const [index, claim] of manifest.claims.entries()) {
    const label = `manifest.claims[${index}]`;
    validateClaim(claim, label, now, options);
    const key = subjectKey(claim.subject);
    if (seenSubjects.has(key)) {
      throw new Error(`${label}.subject duplicates another public claim`);
    }
    seenSubjects.add(key);
  }
  return manifest;
}

export function assertNoUnprojectedPublicClaims(manifest) {
  if (manifest.claims.length > 0) {
    throw new Error(
      "standalone check refuses non-empty claims until a current contract-digest projection is supplied by the ledger/release integration",
    );
  }
}

export function renderPublicClaimProjection(manifest) {
  const claims = [...manifest.claims].sort((left, right) =>
    subjectKey(left.subject).localeCompare(subjectKey(right.subject)),
  );
  const lines = [
    publicProjectionStart,
    `The checked-in public certification manifest contains **${claims.length} exact provider-format claim${claims.length === 1 ? "" : "s"}**.`,
    "",
  ];
  if (claims.length === 0) {
    lines.push(
      "No Hosted service provider-format certification claim is current. Implementation descriptions do not assert Hosted service availability.",
    );
  } else {
    lines.push("Current exact claims:");
    for (const claim of claims) {
      const subject = claim.subject;
      lines.push(
        `- \`${subject.provider} / ${subject.output_profile} / ${subject.operation} / ${subject.policy_mode}\``,
      );
    }
  }
  lines.push(publicProjectionEnd);
  return lines.join("\n");
}

export function validatePublicClaimSurfaceSources(manifest, sources) {
  const marketingCatalog = sources.marketingCatalog ?? "";
  if (
    !/import\s+publicClaimManifest\s+from\s+["']\.\.\/\.\.\/\.\.\/provider-certification\/public-claims\.json["'];/u.test(
      marketingCatalog,
    ) ||
    !marketingCatalog.includes("const publicProviderClaims = publicClaimManifest.claims") ||
    !marketingCatalog.includes("managedCertificationState")
  ) {
    throw new Error(
      "marketing provider catalogue must derive managed certification from public-claims.json",
    );
  }
  if (/\bstatus:\s*["'](?:Available|Supported)["']/u.test(marketingCatalog)) {
    throw new Error(
      "marketing provider catalogue cannot infer availability from Available/Supported status labels",
    );
  }

  const marketingIndex = sources.marketingIndex ?? "";
  const marketingDetail = sources.marketingDetail ?? "";
  if (
    /platform\.status/u.test(marketingIndex) ||
    /platform\.status/u.test(marketingDetail) ||
    /supported by OpenPost/iu.test(marketingIndex)
  ) {
    throw new Error(
      "marketing provider pages must use implementation and exact certification facts",
    );
  }
  if (/aria-label=["']Supported social platforms["']/u.test(sources.marketingLanding ?? "")) {
    throw new Error("marketing landing provider marks must be labelled as implementations");
  }

  const expectedProjection = renderPublicClaimProjection(manifest);
  for (const [label, source] of [
    ["provider limits documentation", sources.providerLimits ?? ""],
    ["provider overview documentation", sources.providerOverview ?? ""],
    ["provider launch gate documentation", sources.launchMatrix ?? ""],
    ["certification contract documentation", sources.certificationReadme ?? ""],
    ["README provider section", sources.readme ?? ""],
  ]) {
    if (extractPublicClaimProjection(source, label) !== expectedProjection) {
      throw new Error(`${label} public certification projection is stale`);
    }
  }
  if (/\b(?:Available|Supported)\b/u.test(sources.providerLimits ?? "")) {
    throw new Error(
      "provider limits documentation must label code paths as implementations, not availability claims",
    );
  }
}

export async function assertPublicClaimSurfaces(manifest, repositoryRoot = root) {
  const read = (relativePath) => readFile(path.join(repositoryRoot, relativePath), "utf8");
  validatePublicClaimSurfaceSources(manifest, {
    marketingCatalog: await read("marketing-site/src/routes/_marketing.ts"),
    marketingIndex: await read("marketing-site/src/routes/platforms/+page.svelte"),
    marketingDetail: await read("marketing-site/src/routes/platforms/[slug]/+page.svelte"),
    marketingLanding: await read("marketing-site/src/routes/+page.svelte"),
    providerLimits: await read("docs-site/providers/platform-limits.md"),
    providerOverview: await read("docs-site/providers/overview.md"),
    launchMatrix: await read("docs-site/providers/launch-matrix.md"),
    certificationReadme: await read("provider-certification/README.md"),
    readme: await read("README.md"),
  });
}

function extractPublicClaimProjection(source, label) {
  const start = source.indexOf(publicProjectionStart);
  const end = source.indexOf(publicProjectionEnd, start);
  if (start < 0 || end < 0) {
    throw new Error(`${label} is missing the public certification projection`);
  }
  if (
    source.indexOf(publicProjectionStart, start + publicProjectionStart.length) >= 0 ||
    source.indexOf(publicProjectionEnd, end + publicProjectionEnd.length) >= 0
  ) {
    throw new Error(`${label} has multiple public certification projections`);
  }
  const projection = source.slice(start + publicProjectionStart.length, end).trim();
  return `${publicProjectionStart}\n${projection}\n${publicProjectionEnd}`;
}

function validateClaim(claim, label, now, options) {
  assertExactKeys(
    claim,
    [
      "approval",
      "configuration",
      "granted_scopes",
      "live_certification",
      "local_certification",
      "policy_sources",
      "policy_state",
      "required_scopes",
      "runtime_control",
      "subject",
    ],
    label,
  );
  validateSubject(claim.subject, `${label}.subject`);
  validateConfiguration(claim.configuration, `${label}.configuration`);
  const approval = validateApproval(
    claim.approval,
    `${label}.approval`,
    now,
    claim.subject.provider,
  );
  validateRuntimeControl(claim.runtime_control, `${label}.runtime_control`);
  if (claim.policy_state !== "allowed") {
    throw new Error(`${label}.policy_state must be allowed`);
  }
  validateScopes(claim.required_scopes, `${label}.required_scopes`);
  validateScopes(claim.granted_scopes, `${label}.granted_scopes`);
  for (const requiredScope of claim.required_scopes) {
    if (!claim.granted_scopes.includes(requiredScope)) {
      throw new Error(`${label}.granted_scopes is missing ${requiredScope}`);
    }
  }
  validatePolicySources(claim.policy_sources, `${label}.policy_sources`, claim.subject.provider);

  const local = validateCertification(
    claim.local_certification,
    "local",
    claim.subject.operation,
    `${label}.local_certification`,
    now,
    options,
  );
  const live = validateCertification(
    claim.live_certification,
    "live",
    claim.subject.operation,
    `${label}.live_certification`,
    now,
    options,
  );
  for (const [kind, certification] of [
    ["local", local],
    ["live", live],
  ]) {
    validateCertificationSnapshot(certification.value, claim, `${label}.${kind}_certification`);
    if (certification.testedAt < approval.reviewedAt) {
      throw new Error(`${label}.${kind}_certification predates approval review`);
    }
    if (certification.expiresAt > approval.expiresAt) {
      throw new Error(`${label}.${kind}_certification cannot outlive approval review`);
    }
  }
  if (local.value.contract_digest !== live.value.contract_digest) {
    throw new Error(`${label} local and live certification contracts differ`);
  }

  if (options.contractDigests !== undefined) {
    const expectedDigest = resolveExpectedDigest(options.contractDigests, claim);
    if (expectedDigest === undefined) {
      throw new Error(`contract digest projection is missing ${subjectKey(claim.subject)}`);
    }
    if (!digestPattern.test(expectedDigest)) {
      throw new Error(`contract digest projection for ${subjectKey(claim.subject)} is invalid`);
    }
    if (
      local.value.contract_digest !== expectedDigest ||
      live.value.contract_digest !== expectedDigest
    ) {
      throw new Error(`${label} certification contract digest is stale`);
    }
  }
}

function validateSubject(subject, label) {
  assertExactKeys(
    subject,
    [
      "account_kind",
      "app_fingerprint",
      "deployment_environment",
      "instance_fingerprint",
      "operation",
      "output_profile",
      "policy_mode",
      "provider",
      "provider_environment",
    ],
    label,
  );
  assertSafeSlug(subject.provider, `${label}.provider`);
  if (!Object.hasOwn(providerSourceRules, subject.provider)) {
    throw new Error(`${label}.provider is not in the certification catalogue`);
  }
  assertDigest(subject.app_fingerprint, `${label}.app_fingerprint`);
  if (subject.deployment_environment !== "production") {
    throw new Error(`${label}.deployment_environment must be production`);
  }
  if (subject.provider_environment !== "production") {
    throw new Error(`${label}.provider_environment must be production`);
  }
  if (subject.instance_fingerprint !== null && !digestPattern.test(subject.instance_fingerprint)) {
    throw new Error(`${label}.instance_fingerprint must be null or a sha256 digest`);
  }
  assertSafeSlug(subject.account_kind, `${label}.account_kind`);
  assertSafeSlug(subject.output_profile, `${label}.output_profile`);
  assertSafeSlug(subject.policy_mode, `${label}.policy_mode`);
  if (!claimOperations.has(subject.operation)) {
    throw new Error(`${label}.operation is not publicly claimable`);
  }
}

function validateConfiguration(configuration, label) {
  assertExactKeys(configuration, ["source", "state"], label);
  if (configuration.state !== "configured") {
    throw new Error(`${label}.state must be configured`);
  }
  if (!configurationSources.has(configuration.source)) {
    throw new Error(`${label}.source is unsupported`);
  }
}

function validateApproval(approval, label, now, provider) {
  assertExactKeys(approval, ["expires_at", "reviewed_at", "source_url", "state", "tier"], label);
  if (approval.state !== "approved" && approval.state !== "not_required") {
    throw new Error(`${label}.state must be approved or not_required`);
  }
  assertSafeSlug(approval.tier, `${label}.tier`);
  if (approval.state === "not_required" && approval.tier !== "not_required") {
    throw new Error(`${label}.tier must be not_required when approval is not required`);
  }
  assertOfficialSource(approval.source_url, provider, `${label}.source_url`);
  const reviewedAt = parseTimestamp(approval.reviewed_at, `${label}.reviewed_at`);
  const expiresAt = parseTimestamp(approval.expires_at, `${label}.expires_at`);
  if (reviewedAt > now) {
    throw new Error(`${label}.reviewed_at cannot be in the future`);
  }
  if (expiresAt <= now || expiresAt <= reviewedAt) {
    throw new Error(`${label} review is expired or has an invalid time range`);
  }
  return { expiresAt, reviewedAt };
}

function validateRuntimeControl(control, label) {
  assertExactKeys(control, ["state"], label);
  if (control.state !== "enabled") {
    throw new Error(`${label}.state must be enabled`);
  }
}

function validateCertification(certification, expectedKind, operation, label, now, options) {
  assertExactKeys(
    certification,
    [
      "checks",
      "contract_digest",
      "expires_at",
      "granted_scopes",
      "id",
      "kind",
      "approval_state_at_test",
      "approval_tier_at_test",
      "required_scopes",
      "subject_digest",
      "tested_at",
      "tested_revision",
    ],
    label,
  );
  if (!safeIdentifierPattern.test(certification.id)) {
    throw new Error(`${label}.id must be an opaque safe identifier`);
  }
  if (certification.kind !== expectedKind) {
    throw new Error(`${label}.kind must be ${expectedKind}`);
  }
  if (!gitRevisionPattern.test(certification.tested_revision)) {
    throw new Error(`${label}.tested_revision must be a full Git revision`);
  }
  if (
    options.requireExactRevision === true &&
    certification.tested_revision !== options.currentRevision
  ) {
    throw new Error(`${label}.tested_revision does not match the release revision`);
  }
  assertDigest(certification.contract_digest, `${label}.contract_digest`);
  const testedAt = parseTimestamp(certification.tested_at, `${label}.tested_at`);
  const expiresAt = parseTimestamp(certification.expires_at, `${label}.expires_at`);
  if (testedAt > now) {
    throw new Error(`${label}.tested_at cannot be in the future`);
  }
  if (expiresAt <= now || expiresAt <= testedAt) {
    throw new Error(`${label} is expired or has an invalid time range`);
  }
  validateChecks(certification.checks, operation, `${label}.checks`);
  return { expiresAt, testedAt, value: certification };
}

function validateCertificationSnapshot(certification, claim, label) {
  if (certification.subject_digest !== subjectDigest(claim.subject)) {
    throw new Error(`${label}.subject_digest does not match the claim`);
  }
  if (certification.approval_state_at_test !== claim.approval.state) {
    throw new Error(`${label}.approval_state_at_test is stale`);
  }
  if (certification.approval_tier_at_test !== claim.approval.tier) {
    throw new Error(`${label}.approval_tier_at_test is stale`);
  }
  validateScopes(certification.required_scopes, `${label}.required_scopes`);
  validateScopes(certification.granted_scopes, `${label}.granted_scopes`);
  if (!sameStringSet(certification.required_scopes, claim.required_scopes)) {
    throw new Error(`${label}.required_scopes does not match the claim`);
  }
  if (!sameStringSet(certification.granted_scopes, claim.granted_scopes)) {
    throw new Error(`${label}.granted_scopes does not match current authorization`);
  }
}

function validateChecks(checks, operation, label) {
  if (!Array.isArray(checks)) {
    throw new Error(`${label} must be an array`);
  }
  const required = new Set([
    "authorization",
    "connect",
    "final_result",
    operation,
    "refresh",
    "revoke",
  ]);
  const seen = new Set();
  for (const [index, check] of checks.entries()) {
    const checkLabel = `${label}[${index}]`;
    assertExactKeys(check, ["kind", "not_applicable_reason", "outcome"], checkLabel);
    if (!knownChecks.has(check.kind)) {
      throw new Error(`${checkLabel}.kind is unsupported`);
    }
    if (seen.has(check.kind)) {
      throw new Error(`${checkLabel}.kind is duplicated`);
    }
    seen.add(check.kind);
    if (check.outcome === "passed") {
      if (check.not_applicable_reason !== null) {
        throw new Error(`${checkLabel}.not_applicable_reason must be null`);
      }
      continue;
    }
    if (check.outcome !== "not_applicable" || !optionalLifecycleChecks.has(check.kind)) {
      throw new Error(`${checkLabel} must pass`);
    }
    assertSafeSlug(check.not_applicable_reason, `${checkLabel}.not_applicable_reason`);
  }
  for (const requiredKind of required) {
    if (!seen.has(requiredKind)) {
      throw new Error(`${label} is missing ${requiredKind}`);
    }
  }
}

function validateScopes(scopes, label) {
  if (!Array.isArray(scopes)) {
    throw new Error(`${label} must be an array`);
  }
  const seen = new Set();
  for (const scope of scopes) {
    if (
      typeof scope !== "string" ||
      scope.length > 256 ||
      scope.trim() !== scope ||
      scope === "" ||
      /\s/u.test(scope)
    ) {
      throw new Error(`${label} contains an invalid scope`);
    }
    if (seen.has(scope)) {
      throw new Error(`${label} contains duplicate scope ${scope}`);
    }
    seen.add(scope);
  }
}

function sameStringSet(left, right) {
  return left.length === right.length && left.every((value) => right.includes(value));
}

function validatePolicySources(sources, label, provider) {
  if (!Array.isArray(sources) || sources.length === 0) {
    throw new Error(`${label} must contain at least one official source`);
  }
  const seen = new Set();
  for (const source of sources) {
    assertOfficialSource(source, provider, label);
    if (seen.has(source)) {
      throw new Error(`${label} contains a duplicate URL`);
    }
    seen.add(source);
  }
}

function resolveExpectedDigest(contractDigests, claim) {
  if (contractDigests === undefined) {
    return undefined;
  }
  if (contractDigests instanceof Map) {
    return contractDigests.get(subjectKey(claim.subject));
  }
  if (contractDigests && typeof contractDigests === "object") {
    return contractDigests[subjectKey(claim.subject)];
  }
  throw new Error("contractDigests must be a Map or object");
}

export function subjectKey(subject) {
  return [
    subject.provider,
    subject.app_fingerprint,
    subject.deployment_environment,
    subject.provider_environment,
    subject.instance_fingerprint ?? "",
    subject.account_kind,
    subject.output_profile,
    subject.operation,
    subject.policy_mode,
  ].join("\u001f");
}

export function subjectDigest(subject) {
  return `sha256:${createHash("sha256")
    .update(JSON.stringify(subjectKey(subject).split("\u001f")))
    .digest("hex")}`;
}

function assertExactKeys(value, expected, label) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error(`${label} must be an object`);
  }
  const actual = Object.keys(value).sort();
  const wanted = [...expected].sort();
  if (actual.length !== wanted.length || actual.some((key, index) => key !== wanted[index])) {
    throw new Error(`${label} must contain exactly ${wanted.join(", ")}`);
  }
}

function assertSafeSlug(value, label) {
  if (typeof value !== "string" || !safeSlugPattern.test(value)) {
    throw new Error(`${label} must be a safe lowercase identifier`);
  }
}

function assertDigest(value, label) {
  if (typeof value !== "string" || !digestPattern.test(value)) {
    throw new Error(`${label} must be a sha256 digest`);
  }
}

function assertSafeURL(value, label) {
  let url;
  try {
    url = new URL(value);
  } catch {
    throw new Error(`${label} must be a valid URL`);
  }
  if (url.protocol !== "https:" || url.username || url.password || url.hash) {
    throw new Error(`${label} must be an HTTPS URL without credentials or fragment`);
  }
  for (const [key, value] of url.searchParams) {
    if (
      !allowedDocumentationQueryKeys.has(key) ||
      !safeDocumentationQueryValuePattern.test(value)
    ) {
      throw new Error(`${label} contains an unsupported documentation query parameter`);
    }
  }
  return url;
}

function assertOfficialSource(value, provider, label) {
  const url = assertSafeURL(value, label);
  const rules = providerSourceRules[provider] ?? [];
  if (!rules.some((rule) => url.hostname === rule.host && url.pathname.startsWith(rule.path))) {
    throw new Error(`${label} is not an official source for ${provider}`);
  }
}

function parseNow(value) {
  if (value === undefined) {
    return Date.now();
  }
  if (value instanceof Date) {
    if (Number.isNaN(value.valueOf())) {
      throw new Error("now must be a valid date");
    }
    return value.valueOf();
  }
  const parsed = Date.parse(value);
  if (Number.isNaN(parsed)) {
    throw new Error("now must be a valid timestamp");
  }
  return parsed;
}

function parseTimestamp(value, label) {
  if (typeof value !== "string" || !value.endsWith("Z")) {
    throw new Error(`${label} must be an RFC 3339 UTC timestamp`);
  }
  const parsed = Date.parse(value);
  if (Number.isNaN(parsed) || new Date(parsed).toISOString() !== value) {
    throw new Error(`${label} must be a canonical RFC 3339 UTC timestamp`);
  }
  return parsed;
}

function validateOptionalRevision(revision) {
  if (revision !== undefined && !gitRevisionPattern.test(revision)) {
    throw new Error("currentRevision must be a full Git revision");
  }
}

async function main() {
  const command = process.argv[2] ?? "check";
  if (command !== "check" || process.argv.length > 4) {
    throw new Error("usage: provider-certification-manifest.mjs check [manifest-path]");
  }
  const manifestPath = process.argv[3] ? path.resolve(process.argv[3]) : publicClaimManifestPath;
  const manifest = await readPublicClaimManifest(manifestPath);
  assertNoUnprojectedPublicClaims(manifest);
  await assertPublicClaimSurfaces(manifest);
  console.log(`Validated ${manifest.claims.length} fail-closed public provider claim(s).`);
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  try {
    await main();
  } catch (error) {
    console.error(`provider-certification: ${error.message}`);
    process.exitCode = 1;
  }
}
