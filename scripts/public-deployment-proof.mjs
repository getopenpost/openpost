#!/usr/bin/env bun

import { createHash } from "node:crypto";
import { execFile } from "node:child_process";
import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { promisify } from "node:util";
import { fileURLToPath } from "node:url";

import { docsPageCatalog } from "../packages/social-images/src/docs-catalog.js";
import { marketingRouteManifest } from "../packages/social-images/src/index.js";

const repositoryRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const execFileAsync = promisify(execFile);

const sampleRoutes = Object.freeze({
  marketing: [
    { category: "core", route: "/features" },
    { category: "legal", route: "/privacy" },
    { category: "platform", route: "/platforms/x" },
    { category: "comparison", route: "/compare/buffer" },
    { category: "tool", route: "/tools/multi-platform-character-counter" },
  ],
  documentation: [
    { category: "root", route: "/" },
    { category: "section", route: "/usage/" },
    { category: "leaf", route: "/usage/composing-posts" },
    { category: "special source", route: "/installation/nix-module" },
    { category: "API reference", route: "/development/api-reference" },
  ],
});

const nativeBoundaries = Object.freeze([
  {
    label: "OpenAPI",
    name: "OpenAPI JSON",
    canonicalURL: "https://docs.openpost.social/openapi.json",
    contentType: "application/json",
    deployment: "documentation",
    localPath: "openapi.json",
    queryIsolation: true,
  },
  {
    label: "MCP",
    name: "MCP native JSON-RPC boundary",
    canonicalURL: "https://app.openpost.social/mcp",
    contentType: "application/json",
    status: 401,
    method: "POST",
    headers: { "content-type": "application/json" },
    requestBody: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "tools/list" }),
  },
  {
    label: "marketing asset",
    name: "marketing SVG asset",
    canonicalURL: "https://openpost.social/assets/brand/logo.svg",
    contentType: "image/svg+xml",
  },
  {
    label: "documentation asset",
    name: "documentation PNG asset",
    canonicalURL: "https://docs.openpost.social/assets/screenshots/main-dark.png",
    contentType: "image/png",
  },
]);

export function publicSurfaceSamples() {
  for (const sample of sampleRoutes.marketing) {
    if (!marketingRouteManifest.some(({ path }) => path === sample.route)) {
      throw new Error(`unknown marketing proof route ${sample.route}`);
    }
  }
  for (const sample of sampleRoutes.documentation) {
    if (!docsPageCatalog.some(({ route }) => route === sample.route)) {
      throw new Error(`unknown documentation proof route ${sample.route}`);
    }
  }
  return {
    marketing: sampleRoutes.marketing.map((sample) => ({ ...sample })),
    documentation: sampleRoutes.documentation.map((sample) => ({ ...sample })),
    native: nativeBoundaries.map(({ label, canonicalURL, contentType }) => [
      label,
      canonicalURL,
      contentType,
    ]),
  };
}

export function deploymentForRevision(deployments, revision) {
  if (!/^[0-9a-f]{40}$/u.test(revision)) {
    throw new Error(`reviewed revision must be a full lowercase commit SHA: ${revision}`);
  }
  const records = Array.isArray(deployments) ? deployments : [deployments.result ?? deployments];
  const deployment = records.find(
    (candidate) =>
      candidate.environment === "production" &&
      candidate.deployment_trigger?.metadata?.branch === "main" &&
      candidate.deployment_trigger.metadata.commit_hash === revision &&
      candidate.deployment_trigger.metadata.commit_dirty === false &&
      candidate.latest_stage?.status === "success",
  );
  if (!deployment) {
    throw new Error(`no successful clean main production deployment matches ${revision}`);
  }
  return {
    Id: deployment.id,
    Branch: deployment.deployment_trigger.metadata.branch,
    SourceRevision: deployment.deployment_trigger.metadata.commit_hash,
    Deployment: deployment.url,
    Status: deployment.latest_stage.status,
  };
}

export function assertLocalRevision({ head, status }, revision) {
  assertEqual(head, revision, "local HEAD differs from reviewed revision");
  assertEqual(status, "", "local tracked tree must be clean before proof");
}

export function assertCanonicalProvenance(markdown, canonical, relativePath) {
  const provenance = `Canonical: ${canonical}`;
  if (!markdown.split("\n").includes(provenance)) {
    throw new Error(`${relativePath} does not name its exact canonical URL ${canonical}`);
  }
  return provenance;
}

function assertCountMap(value, name) {
  if (!value || Array.isArray(value) || typeof value !== "object") {
    throw new Error(`${name} must be an object of non-negative integer counts`);
  }
  for (const [key, count] of Object.entries(value)) {
    if (!key || !Number.isInteger(count) || count < 0) {
      throw new Error(`${name} must contain non-negative integer counts`);
    }
  }
}

export function validateAICrawlSnapshot(snapshot) {
  const requiredText = [
    "observed_at",
    "window_start",
    "window_end",
    "source",
    "method",
    "next_review_owner",
    "next_review",
  ];
  for (const field of requiredText) {
    if (typeof snapshot?.[field] !== "string" || !snapshot[field].trim()) {
      throw new Error(`AI Crawl Control snapshot requires ${field}`);
    }
  }
  const start = Date.parse(snapshot.window_start);
  const end = Date.parse(snapshot.window_end);
  const observed = Date.parse(snapshot.observed_at);
  if (![start, end, observed].every(Number.isFinite)) {
    throw new Error("AI Crawl Control snapshot timestamps must be valid ISO dates");
  }
  if (snapshot.window_hours !== 24 || end - start !== 24 * 60 * 60 * 1000) {
    throw new Error("AI Crawl Control snapshot must cover exactly 24 hours");
  }
  if (observed < end) {
    throw new Error("AI Crawl Control snapshot cannot be observed before its window ends");
  }
  const expectedHosts = ["docs.openpost.social", "openpost.social"];
  if (
    !Array.isArray(snapshot.scope) ||
    JSON.stringify([...snapshot.scope].sort()) !== JSON.stringify(expectedHosts)
  ) {
    throw new Error("AI Crawl Control snapshot must cover both public hosts exactly");
  }
  if (!Number.isInteger(snapshot.requests) || snapshot.requests < 0) {
    throw new Error("AI Crawl Control snapshot requests must be a non-negative integer");
  }
  assertCountMap(snapshot.response_statuses, "response_statuses");
  assertCountMap(snapshot.requests_by_host, "requests_by_host");
  if (
    JSON.stringify(Object.keys(snapshot.requests_by_host).sort()) !== JSON.stringify(expectedHosts)
  ) {
    throw new Error("AI Crawl Control snapshot host counts must cover both public hosts exactly");
  }
  for (const [name, counts] of [
    ["response_statuses", snapshot.response_statuses],
    ["requests_by_host", snapshot.requests_by_host],
  ]) {
    const total = Object.values(counts).reduce((sum, count) => sum + count, 0);
    if (total !== snapshot.requests) {
      throw new Error(`AI Crawl Control snapshot ${name} total must equal requests`);
    }
  }
  if (
    snapshot.user_agent_matching_spoofable !== true ||
    snapshot.crawler_identity_proven !== false
  ) {
    throw new Error("AI Crawl Control snapshot must label user-agent identity limits");
  }
  if (snapshot.release_kpi !== false) {
    throw new Error("AI Crawl Control snapshot must remain an observation, not a release KPI");
  }
  return snapshot;
}

export function linksFromMarkdown(markdown) {
  return [...markdown.matchAll(/\[[^\]]+\]\(([^\s)]+)(?:\s+"[^"]*")?\)/gu)].map(
    ([, target]) => target,
  );
}

function sha256(value) {
  return createHash("sha256").update(value).digest("hex");
}

async function fetchResponse(fetchImpl, url, request = {}) {
  const response = await fetchImpl(url, { redirect: "follow", ...request });
  return {
    response,
    body: await response.text(),
    contentType: response.headers.get("content-type") ?? "",
  };
}

function assertEqual(actual, expected, message) {
  if (actual !== expected) {
    throw new Error(
      `${message}: expected ${JSON.stringify(expected)}, received ${JSON.stringify(actual)}`,
    );
  }
}

function assertBodyEqual(actual, expected, message) {
  if (actual === expected) return;
  throw new Error(
    `${message}: expected sha256:${sha256(expected)} (${Buffer.byteLength(expected)} bytes), received sha256:${sha256(actual)} (${Buffer.byteLength(actual)} bytes)`,
  );
}

async function proveArtifact(fetchImpl, check) {
  const canonical = await fetchResponse(fetchImpl, check.canonicalURL, {
    method: check.method ?? "GET",
    headers: check.headers,
    body: check.requestBody,
  });
  assertEqual(canonical.response.status, check.status ?? 200, `${check.name} status`);
  assertEqual(canonical.contentType, check.contentType, `${check.name} content type`);
  let localMatches;
  if (check.expectedBody !== undefined) {
    assertBodyEqual(
      canonical.body,
      check.expectedBody,
      `${check.name} body differs from local build`,
    );
    localMatches = true;
  }
  for (const fragment of check.bodyIncludes ?? []) {
    if (!canonical.body.includes(fragment)) {
      throw new Error(`${check.name} body is missing ${JSON.stringify(fragment)}`);
    }
  }
  for (const fragment of check.bodyExcludes ?? []) {
    if (canonical.body.includes(fragment)) {
      throw new Error(`${check.name} body contains ${JSON.stringify(fragment)}`);
    }
  }

  let deploymentMatches;
  if (check.deploymentURL) {
    const deployment = await fetchResponse(fetchImpl, check.deploymentURL);
    assertEqual(deployment.response.status, check.status ?? 200, `${check.name} deployment status`);
    assertEqual(deployment.contentType, check.contentType, `${check.name} deployment content type`);
    assertBodyEqual(
      deployment.body,
      canonical.body,
      `${check.name} canonical host differs from deployment`,
    );
    deploymentMatches = true;
  }

  let queryIsolated;
  if (check.queryIsolation) {
    const queryURL = new URL(check.canonicalURL);
    queryURL.searchParams.set("openpost_proof", "query-isolation");
    const query = await fetchResponse(fetchImpl, queryURL);
    assertEqual(query.response.status, check.status ?? 200, `${check.name} query status`);
    assertEqual(query.contentType, check.contentType, `${check.name} query content type`);
    if (query.body !== canonical.body)
      throw new Error(`${check.name} query changed the response body`);
    queryIsolated = true;
  }

  return {
    name: check.name,
    kind: check.kind,
    url: check.canonicalURL,
    status: canonical.response.status,
    content_type: canonical.contentType,
    bytes: Buffer.byteLength(canonical.body),
    sha256: sha256(canonical.body),
    ...(localMatches === undefined ? {} : { local_matches: localMatches }),
    ...(deploymentMatches === undefined ? {} : { deployment_matches: deploymentMatches }),
    ...(queryIsolated === undefined ? {} : { query_isolated: queryIsolated }),
  };
}

async function proveRedirect(fetchImpl, check) {
  const { response, contentType } = await fetchResponse(fetchImpl, check.url, {
    redirect: "manual",
  });
  assertEqual(response.status, check.status, `${check.name} status`);
  assertEqual(response.headers.get("location"), check.location, `${check.name} location`);
  return {
    name: check.name,
    kind: check.kind,
    url: check.url,
    status: response.status,
    content_type: contentType,
    location: response.headers.get("location"),
  };
}

export async function proveHTTPContract({ checks, fetchImpl = fetch }) {
  const results = [];
  for (const check of checks) {
    results.push(
      check.kind === "redirect"
        ? await proveRedirect(fetchImpl, check)
        : await proveArtifact(fetchImpl, check),
    );
  }
  return results;
}

function markdownOutputForRoute(route) {
  if (route === "/") return "index.md";
  if (route.endsWith("/")) return `${route.slice(1)}index.md`;
  return `${route.slice(1)}.md`;
}

function deploymentURL(deployment, pathname) {
  return new URL(pathname, `${deployment.Deployment}/`).href;
}

async function localArtifact(directory, relativePath) {
  return readFile(path.join(directory, relativePath), "utf8");
}

function sampleByRoute(samples, route) {
  return samples.find((sample) => sample.route === route);
}

export function validateMachineLinks(indexName, markdown, knownMarkdownURLs) {
  for (const target of linksFromMarkdown(markdown)) {
    const url = new URL(target);
    if (url.search) {
      throw new Error(`${indexName} contains a query-bearing machine link ${target}`);
    }
    url.hash = "";
    const intentionalNative =
      target === "https://docs.openpost.social/openapi.json" ||
      (["https://openpost.social", "https://docs.openpost.social"].includes(url.origin) &&
        url.pathname.startsWith("/assets/"));
    if (intentionalNative) continue;
    if (!knownMarkdownURLs.has(url.href)) {
      throw new Error(`${indexName} contains a non-resolving or non-machine link ${target}`);
    }
  }
}

export async function buildPublicProofChecks({
  rootDirectory = repositoryRoot,
  revision,
  marketingDeployments,
  documentationDeployments,
}) {
  const marketingDeployment = deploymentForRevision(marketingDeployments, revision);
  const documentationDeployment = deploymentForRevision(documentationDeployments, revision);
  const samples = publicSurfaceSamples();
  const marketingDirectory = path.join(rootDirectory, "marketing-site/dist");
  const documentationDirectory = path.join(rootDirectory, "docs-site/.vitepress/dist");
  const checks = [];
  const knownMarkdownURLs = new Set();

  const surfaces = [
    {
      key: "marketing",
      origin: "https://openpost.social",
      directory: marketingDirectory,
      deployment: marketingDeployment,
      routes: marketingRouteManifest
        .filter(({ agentRepresentation }) => Boolean(agentRepresentation))
        .map(({ path: route, canonical }) => ({ route, canonical })),
      samples: samples.marketing,
    },
    {
      key: "documentation",
      origin: "https://docs.openpost.social",
      directory: documentationDirectory,
      deployment: documentationDeployment,
      routes: docsPageCatalog
        .filter(({ agentRepresentation }) => agentRepresentation.membership === "ordinary")
        .map(({ route }) => ({
          route,
          canonical:
            route === "/" ? "https://docs.openpost.social" : `https://docs.openpost.social${route}`,
        })),
      samples: samples.documentation,
    },
  ];

  for (const surface of surfaces) {
    for (const { route, canonical } of surface.routes) {
      const relativePath = markdownOutputForRoute(route);
      const canonicalURL = `${surface.origin}/${relativePath}`;
      const expectedBody = await localArtifact(surface.directory, relativePath);
      const provenance = assertCanonicalProvenance(expectedBody, canonical, relativePath);
      knownMarkdownURLs.add(canonicalURL);
      const sample = sampleByRoute(surface.samples, route);
      checks.push({
        kind: "artifact",
        name: sample ? `${surface.key} ${sample.category} Markdown` : `${surface.key} Markdown`,
        canonicalURL,
        deploymentURL: deploymentURL(surface.deployment, relativePath),
        contentType: "text/markdown; charset=utf-8",
        expectedBody,
        queryIsolation: Boolean(sample),
        bodyIncludes: ["Generated from the canonical OpenPost public page", provenance],
      });
    }
  }

  const marketingIndex = await localArtifact(marketingDirectory, "llms.txt");
  const documentationIndex = await localArtifact(documentationDirectory, "llms.txt");
  knownMarkdownURLs.add("https://docs.openpost.social/llms-full.txt");
  validateMachineLinks("marketing llms.txt", marketingIndex, knownMarkdownURLs);
  validateMachineLinks("documentation llms.txt", documentationIndex, knownMarkdownURLs);
  const documentationCorpus = await localArtifact(documentationDirectory, "llms-full.txt");
  validateMachineLinks("documentation llms-full.txt", documentationCorpus, knownMarkdownURLs);

  for (const [surface, relativePath, contentType, expectedBody] of [
    [surfaces[0], "llms.txt", "text/plain; charset=utf-8", marketingIndex],
    [surfaces[1], "llms.txt", "text/plain; charset=utf-8", documentationIndex],
    [surfaces[1], "llms-full.txt", "text/plain; charset=utf-8", documentationCorpus],
  ]) {
    checks.push({
      kind: "artifact",
      name: `${surface.key} ${relativePath}`,
      canonicalURL: `${surface.origin}/${relativePath}`,
      deploymentURL: deploymentURL(surface.deployment, relativePath),
      contentType,
      expectedBody,
      queryIsolation: true,
    });
  }

  for (const surface of surfaces) {
    for (const sample of surface.samples) {
      const markdownPath = markdownOutputForRoute(sample.route);
      checks.push({
        kind: "artifact",
        name: `${surface.key} ${sample.category} HTML discovery`,
        canonicalURL: `${surface.origin}${sample.route}`,
        contentType: "text/html; charset=utf-8",
        bodyIncludes: [
          `rel="alternate" type="text/markdown" href="${surface.origin}/${markdownPath}"`,
          `href="${surface.origin}/llms.txt"`,
          ...(surface.key === "documentation"
            ? [`href="https://docs.openpost.social/llms-full.txt"`]
            : []),
        ],
      });
    }
  }

  for (const surface of surfaces) {
    checks.push({
      kind: "artifact",
      name: `${surface.key} HTML-only sitemap`,
      canonicalURL: `${surface.origin}/sitemap.xml`,
      contentType: "application/xml",
      bodyExcludes: [".md</loc>"],
    });
  }

  for (const boundary of nativeBoundaries) {
    checks.push({
      kind: "artifact",
      ...boundary,
      ...(boundary.deployment === "documentation"
        ? { deploymentURL: deploymentURL(documentationDeployment, boundary.localPath) }
        : {}),
      ...(boundary.localPath
        ? { expectedBody: await localArtifact(documentationDirectory, boundary.localPath) }
        : {}),
    });
  }

  for (const surface of surfaces) {
    checks.push(
      {
        kind: "artifact",
        name: `${surface.key} unknown HTML 404`,
        canonicalURL: `${surface.origin}/openpost-proof-unknown-90`,
        contentType: "text/html; charset=utf-8",
        status: 404,
      },
      {
        kind: "artifact",
        name: `${surface.key} unknown Markdown 404`,
        canonicalURL: `${surface.origin}/openpost-proof-unknown-90.md`,
        contentType: "text/markdown; charset=utf-8",
        status: 404,
      },
    );
  }

  checks.push(
    {
      kind: "redirect",
      name: "marketing canonical redirect",
      url: "https://openpost.social/features/?openpost_proof=redirect",
      status: 308,
      location: "/features?openpost_proof=redirect",
    },
    {
      kind: "redirect",
      name: "documentation canonical redirect",
      url: "https://docs.openpost.social/usage?openpost_proof=redirect",
      status: 308,
      location: "/usage/?openpost_proof=redirect",
    },
  );

  return { checks, marketingDeployment, documentationDeployment };
}

function requiredOption(name) {
  const index = process.argv.indexOf(name);
  const value = index === -1 ? undefined : process.argv[index + 1];
  if (!value) throw new Error(`missing ${name}`);
  return value;
}

function deploymentEvidence(deployment) {
  return {
    id: deployment.Id,
    branch: deployment.Branch,
    source_revision: deployment.SourceRevision,
    deployment_url: deployment.Deployment,
    build_url: deployment.Build,
  };
}

async function main() {
  if (process.argv[2] !== "prove") {
    throw new Error(
      "usage: public-deployment-proof.mjs prove --revision SHA --marketing-deployment FILE --documentation-deployment FILE --ai-crawl-snapshot FILE --output FILE",
    );
  }
  const revision = requiredOption("--revision");
  const [{ stdout: headOutput }, { stdout: statusOutput }] = await Promise.all([
    execFileAsync("git", ["rev-parse", "HEAD"], { cwd: repositoryRoot }),
    execFileAsync("git", ["status", "--porcelain", "--untracked-files=no"], {
      cwd: repositoryRoot,
    }),
  ]);
  const localRevision = { head: headOutput.trim(), status: statusOutput.trim() };
  assertLocalRevision(localRevision, revision);
  const [marketingDeployments, documentationDeployments, aiCrawlSnapshot] = await Promise.all(
    [
      requiredOption("--marketing-deployment"),
      requiredOption("--documentation-deployment"),
      requiredOption("--ai-crawl-snapshot"),
    ].map(async (file) => JSON.parse(await readFile(path.resolve(file), "utf8"))),
  );
  validateAICrawlSnapshot(aiCrawlSnapshot);
  const { checks, marketingDeployment, documentationDeployment } = await buildPublicProofChecks({
    revision,
    marketingDeployments,
    documentationDeployments,
  });
  const results = await proveHTTPContract({ checks });
  const exactArtifacts = results.filter(
    ({ local_matches, deployment_matches }) => local_matches && deployment_matches,
  ).length;
  const report = {
    schema_version: 1,
    reviewed_revision: revision,
    generated_at: new Date().toISOString(),
    local_build: {
      marketing: "bun run build -- marketing",
      documentation: "bun run build -- docs",
      head_revision: localRevision.head,
      tracked_tree_clean: true,
      generated_artifacts_verified: true,
    },
    deployment_artifact_acceptance: {
      marketing: deploymentEvidence(marketingDeployment),
      documentation: deploymentEvidence(documentationDeployment),
      exact_local_deployment_canonical_artifacts: exactArtifacts,
    },
    live_response_behavior: {
      checks: results,
      passed: results.length,
    },
    ai_crawl_control_observation: aiCrawlSnapshot,
  };
  await writeFile(path.resolve(requiredOption("--output")), `${JSON.stringify(report, null, 2)}\n`);
  console.log(
    `Proved ${results.length} live responses and ${exactArtifacts} exact deployed artifacts for ${revision}.`,
  );
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    await main();
  } catch (error) {
    console.error(`public-deployment-proof: ${error.message}`);
    process.exitCode = 1;
  }
}
