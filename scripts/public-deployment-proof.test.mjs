import assert from "node:assert/strict";
import test from "node:test";

import {
  assertCanonicalProvenance,
  assertLocalRevision,
  deploymentForRevision,
  linksFromMarkdown,
  proveHTTPContract,
  publicSurfaceSamples,
  validateAICrawlSnapshot,
  validateMachineLinks,
} from "./public-deployment-proof.mjs";

test("selects an active production deployment for the exact reviewed revision", () => {
  const revision = "abcdef1234567890abcdef1234567890abcdef12";
  const deployments = [
    {
      id: "wrong-branch",
      environment: "preview",
      url: "https://wrong.example",
      deployment_trigger: {
        metadata: { branch: "feature", commit_hash: revision, commit_dirty: false },
      },
      latest_stage: { status: "success" },
    },
    {
      id: "reviewed",
      environment: "production",
      url: "https://reviewed.example",
      deployment_trigger: {
        metadata: { branch: "main", commit_hash: revision, commit_dirty: false },
      },
      latest_stage: { status: "success" },
    },
  ];

  assert.deepEqual(deploymentForRevision(deployments, revision), {
    Id: "reviewed",
    Branch: "main",
    SourceRevision: revision,
    Deployment: "https://reviewed.example",
    Status: "success",
  });
  assert.throws(
    () => deploymentForRevision(deployments, "fedcba9876543210fedcba9876543210fedcba98"),
    /successful clean main production deployment.*fedcba/u,
  );
  assert.throws(() => deploymentForRevision(deployments, "abcdef1"), /full lowercase commit SHA/u);
});

test("binds proof to the exact clean local revision", () => {
  const revision = "abcdef1234567890abcdef1234567890abcdef12";
  assert.doesNotThrow(() => assertLocalRevision({ head: revision, status: "" }, revision));
  assert.throws(
    () => assertLocalRevision({ head: revision, status: " M tracked" }, revision),
    /tracked tree must be clean/u,
  );
  assert.throws(
    () =>
      assertLocalRevision(
        { head: "fedcba9876543210fedcba9876543210fedcba98", status: "" },
        revision,
      ),
    /local HEAD differs/u,
  );
});

test("requires each Markdown artifact to name its exact canonical HTML URL", () => {
  const canonical = "https://docs.openpost.social/usage/";
  assert.equal(
    assertCanonicalProvenance(
      `Title: Usage\nCanonical: ${canonical}\n`,
      canonical,
      "usage/index.md",
    ),
    `Canonical: ${canonical}`,
  );
  assert.throws(
    () =>
      assertCanonicalProvenance(
        "Canonical: https://docs.openpost.social/other\n",
        canonical,
        "usage/index.md",
      ),
    /does not name its exact canonical URL/u,
  );
});

test("requires a bounded observation-only 24-hour AI crawl snapshot", () => {
  const snapshot = {
    observed_at: "2026-08-14T13:50:27Z",
    window_start: "2026-08-13T13:50:27Z",
    window_end: "2026-08-14T13:50:27Z",
    window_hours: 24,
    source: "Cloudflare GraphQL Analytics API",
    scope: ["openpost.social", "docs.openpost.social"],
    method: "documented crawler user-agent patterns",
    requests: 3,
    response_statuses: { 200: 1, 404: 2 },
    requests_by_host: { "openpost.social": 2, "docs.openpost.social": 1 },
    user_agent_matching_spoofable: true,
    crawler_identity_proven: false,
    release_kpi: false,
    next_review_owner: "public-surface operator",
    next_review: "within 24 hours of a policy change",
  };
  assert.equal(validateAICrawlSnapshot(snapshot), snapshot);
  assert.throws(
    () => validateAICrawlSnapshot({ ...snapshot, release_kpi: true }),
    /observation, not a release KPI/u,
  );
  assert.throws(
    () => validateAICrawlSnapshot({ ...snapshot, window_start: "2026-08-13T14:50:27Z" }),
    /exactly 24 hours/u,
  );
  assert.throws(
    () =>
      validateAICrawlSnapshot({
        ...snapshot,
        requests_by_host: { ...snapshot.requests_by_host, "openpost.social": 1 },
      }),
    /host total must equal requests/u,
  );
});

test("reads explicit Markdown and intentional native links from discovery files", () => {
  assert.deepEqual(
    linksFromMarkdown(`
# OpenPost

- [Guide](https://docs.openpost.social/usage/index.md)
- [OpenAPI](https://docs.openpost.social/openapi.json): authoritative JSON.

Ignore https://example.com/bare and [local](./local.md).
`),
    [
      "https://docs.openpost.social/usage/index.md",
      "https://docs.openpost.social/openapi.json",
      "./local.md",
    ],
  );
});

test("rejects HTML and external links from indexes and the full corpus", () => {
  const known = new Set([
    "https://docs.openpost.social/usage/accounts.md",
    "https://docs.openpost.social/llms-full.txt",
  ]);
  assert.doesNotThrow(() =>
    validateMachineLinks(
      "corpus",
      "[Accounts](https://docs.openpost.social/usage/accounts.md)\n![Image](https://docs.openpost.social/assets/image.png)\n[API](https://docs.openpost.social/openapi.json)",
      known,
    ),
  );
  assert.throws(
    () =>
      validateMachineLinks(
        "corpus",
        "[Accounts](https://docs.openpost.social/usage/accounts)",
        known,
      ),
    /non-resolving or non-machine/u,
  );
  assert.throws(
    () => validateMachineLinks("corpus", "[Video](https://youtu.be/example)", known),
    /non-resolving or non-machine/u,
  );
});

test("the live sample plan covers every required public category and machine boundary", () => {
  const samples = publicSurfaceSamples();
  assert.deepEqual(
    samples.marketing.map(({ category, route }) => [category, route]),
    [
      ["core", "/features"],
      ["legal", "/privacy"],
      ["platform", "/platforms/x"],
      ["comparison", "/compare/buffer"],
      ["tool", "/tools/multi-platform-character-counter"],
    ],
  );
  assert.deepEqual(
    samples.documentation.map(({ category, route }) => [category, route]),
    [
      ["root", "/"],
      ["section", "/usage/"],
      ["leaf", "/usage/composing-posts"],
      ["special source", "/installation/nix-module"],
      ["API reference", "/development/api-reference"],
    ],
  );
  assert.deepEqual(samples.native, [
    ["OpenAPI", "https://docs.openpost.social/openapi.json", "application/json"],
    ["MCP", "https://app.openpost.social/mcp", "application/json"],
    ["marketing asset", "https://openpost.social/assets/brand/logo.svg", "image/svg+xml"],
    [
      "documentation asset",
      "https://docs.openpost.social/assets/screenshots/main-dark.png",
      "image/png",
    ],
  ]);
});

test("proves status, media type, exact content, query isolation, and redirect behavior", async () => {
  const responses = new Map([
    [
      "https://openpost.social/features.md",
      response(200, "text/markdown; charset=utf-8", "# Features\n"),
    ],
    [
      "https://deployment.example/features.md",
      response(200, "text/markdown; charset=utf-8", "# Features\n"),
    ],
    [
      "https://openpost.social/features.md?openpost_proof=query-isolation",
      response(200, "text/markdown; charset=utf-8", "# Features\n"),
    ],
    [
      "https://openpost.social/features/?openpost_proof=redirect",
      response(308, "text/html; charset=UTF-8", "", {
        location: "https://openpost.social/features?openpost_proof=redirect",
      }),
    ],
  ]);
  const fetchImpl = async (url) => {
    const found = responses.get(String(url));
    assert.ok(found, `unexpected request ${url}`);
    return found.clone();
  };

  const result = await proveHTTPContract({
    fetchImpl,
    checks: [
      {
        kind: "artifact",
        name: "marketing core",
        canonicalURL: "https://openpost.social/features.md",
        deploymentURL: "https://deployment.example/features.md",
        contentType: "text/markdown; charset=utf-8",
        expectedBody: "# Features\n",
        queryIsolation: true,
      },
      {
        kind: "redirect",
        name: "marketing canonical redirect",
        url: "https://openpost.social/features/?openpost_proof=redirect",
        status: 308,
        location: "https://openpost.social/features?openpost_proof=redirect",
      },
    ],
  });

  assert.equal(result.length, 2);
  assert.equal(result[0].sha256.length, 64);
  assert.equal(result[0].query_isolated, true);
  assert.equal(result[1].location, "https://openpost.social/features?openpost_proof=redirect");
});

test("fails when a query changes generated content", async () => {
  const fetchImpl = async (url) =>
    String(url).includes("openpost_proof")
      ? response(200, "text/markdown; charset=utf-8", "leaked query")
      : response(200, "text/markdown; charset=utf-8", "stable");

  await assert.rejects(
    proveHTTPContract({
      fetchImpl,
      checks: [
        {
          kind: "artifact",
          name: "query isolation",
          canonicalURL: "https://openpost.social/index.md",
          contentType: "text/markdown; charset=utf-8",
          expectedBody: "stable",
          queryIsolation: true,
        },
      ],
    }),
    /query changed the response body/u,
  );
});

function response(status, contentType, body, headers = {}) {
  return new Response(body, {
    status,
    headers: { "content-type": contentType, ...headers },
  });
}
