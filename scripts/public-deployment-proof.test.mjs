import assert from "node:assert/strict";
import test from "node:test";
import { assetSurfaceManifest } from "./asset-surfaces.ts";

import {
  assertCanonicalProvenance,
  assertLocalRevision,
  deploymentForRevision,
  linksFromMarkdown,
  markdownOutputForRoute,
  proveHTTPContract,
  publicSurfaceSamples,
  validateAICrawlSnapshot,
  validateMachineLinks,
} from "./public-deployment-proof.mjs";

test("selects an active production deployment for the exact reviewed revision", () => {
  const revision = "abcdef1234567890abcdef1234567890abcdef12";
  const reviewed = {
    id: "reviewed",
    environment: "production",
    url: "https://reviewed.example",
    deployment_trigger: {
      metadata: { branch: "main", commit_hash: revision, commit_dirty: false },
    },
    latest_stage: { status: "success" },
  };
  assert.deepEqual(deploymentForRevision([reviewed], revision), {
    Id: "reviewed",
    Branch: "main",
    SourceRevision: revision,
    Deployment: "https://reviewed.example",
    Status: "success",
  });
  for (const [field, value] of [
    ["environment", "preview"],
    ["branch", "feature"],
    ["commit_dirty", true],
    ["commit_hash", "fedcba9876543210fedcba9876543210fedcba98"],
    ["status", "failure"],
  ]) {
    const candidate = structuredClone(reviewed);
    if (field === "environment") candidate.environment = value;
    else if (field === "status") candidate.latest_stage.status = value;
    else candidate.deployment_trigger.metadata[field] = value;
    assert.throws(
      () => deploymentForRevision([candidate], revision),
      /no successful clean main production deployment matches/u,
      field,
    );
  }
  assert.throws(() => deploymentForRevision([reviewed], "abcdef1"), /full lowercase commit SHA/u);
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
  const canonical = "https://openpo.st/docs/usage/";
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
        "Canonical: https://openpo.st/docs/other\n",
        canonical,
        "usage/index.md",
      ),
    /does not name its exact canonical URL/u,
  );
  assert.equal(
    assertCanonicalProvenance("Canonical: https://openpo.st/\n", "https://openpo.st", "index.md"),
    "Canonical: https://openpo.st/",
  );
  for (const normalizedButNotExact of [
    "https://openpo.st/docs/usage/./composing-posts",
    "https://DOCS.openpo.st/usage/composing-posts",
    "https://openpo.st/docs:443/usage/composing-posts",
    "not a URL",
  ]) {
    assert.throws(
      () =>
        assertCanonicalProvenance(
          `Canonical: ${normalizedButNotExact}\n`,
          "https://openpo.st/docs/usage/composing-posts",
          "usage/composing-posts.md",
        ),
      /does not name its exact canonical URL/u,
    );
  }
});

test("requires a bounded observation-only 24-hour AI crawl snapshot", () => {
  const snapshot = {
    observed_at: "2026-08-14T13:50:27Z",
    window_start: "2026-08-13T13:50:27Z",
    window_end: "2026-08-14T13:50:27Z",
    window_hours: 24,
    source: "Cloudflare GraphQL Analytics API",
    scope: ["openpo.st"],
    method: "documented crawler user-agent patterns",
    requests: 3,
    response_statuses: { 200: 1, 404: 2 },
    requests_by_host: { "openpo.st": 3 },
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
    () =>
      validateAICrawlSnapshot({
        ...snapshot,
        window_start: "2026-08-13T14:50:27Z",
      }),
    /exactly 24 hours/u,
  );
  assert.throws(
    () =>
      validateAICrawlSnapshot({
        ...snapshot,
        requests_by_host: { ...snapshot.requests_by_host, "openpo.st": 1 },
      }),
    /host total must equal requests/u,
  );
});

test("reads explicit Markdown and intentional native links from discovery files", () => {
  assert.deepEqual(
    linksFromMarkdown(`
# OpenPost

- [Guide](https://openpo.st/docs/usage/index.md)
- [OpenAPI](https://openpo.st/docs/openapi.json): authoritative JSON.

![Codex logo](https://openpo.st/docs/clients/codex.svg)

Ignore https://example.com/bare and [local](./local.md).
`),
    ["https://openpo.st/docs/usage/index.md", "https://openpo.st/docs/openapi.json", "./local.md"],
  );
});

test("rejects HTML and external links from indexes and the full corpus", () => {
  const known = new Set([
    "https://openpo.st/docs/usage/accounts.md",
    "https://openpo.st/docs/llms-full.txt",
  ]);
  assert.doesNotThrow(() =>
    validateMachineLinks(
      "corpus",
      "[Accounts](https://openpo.st/docs/usage/accounts.md)\n![Image](https://openpo.st/docs/assets/image.png)\n[API](https://openpo.st/docs/openapi.json)",
      known,
    ),
  );
  assert.throws(
    () =>
      validateMachineLinks("corpus", "[Accounts](https://openpo.st/docs/usage/accounts)", known),
    /non-resolving or non-machine/u,
  );
  assert.throws(
    () => validateMachineLinks("corpus", "[Video](https://youtu.be/example)", known),
    /non-resolving or non-machine/u,
  );
});

test("asset samples belong to the surface that deploys them", () => {
  const paths = publicSurfaceSamples().native.map(([, url]) => new URL(url).pathname);
  for (const [surface, prefix] of [
    ["docs", "/docs/assets/"],
    ["marketing", "/assets/"],
  ]) {
    const assets = paths.filter((pathname) => pathname.startsWith(prefix));
    assert.ok(assets.length > 0, `${surface} must have an asset proof sample`);
    for (const pathname of assets) {
      assert.ok(
        assetSurfaceManifest[surface].includes(pathname.slice(prefix.length)),
        `${pathname} is not published by ${surface}`,
      );
    }
  }
});

test("the live sample plan covers every required public category and machine boundary", () => {
  const samples = publicSurfaceSamples();
  for (const [surface, categories] of [
    ["marketing", ["core", "legal", "platform", "guide", "tool"]],
    ["documentation", ["root", "guide", "self-hosting", "API reference"]],
  ]) {
    assert.deepEqual(samples[surface].map(({ category }) => category).sort(), categories.sort());
    const routes = samples[surface].map(({ route }) => route);
    assert.equal(new Set(routes).size, routes.length);
    for (const route of routes) assert.match(route, /^\/(?:[^?#]*)$/u);
  }
  const native = new Map(samples.native.map(([, url, type]) => [url, type]));
  assert.equal(native.size, samples.native.length, "native boundaries are unique");
  // Protocol endpoints are stable contracts; display labels and representative page routes are not.
  for (const host of ["https://openpo.st/docs", "https://app.openpo.st"]) {
    assert.equal(native.get(`${host}/openapi.json`)?.split(";")[0], "application/json");
  }
  for (const host of ["https://openpo.st", "https://app.openpo.st"]) {
    assert.equal(
      native.get(`${host}/.well-known/api-catalog`),
      'application/linkset+json; profile="https://www.rfc-editor.org/info/rfc9727"',
    );
    assert.equal(
      native.get(`${host}/.well-known/mcp/server-card.json`)?.split(";")[0],
      "application/json",
    );
  }
  for (const suffix of ["", "/mcp"]) {
    assert.equal(
      native.get(`https://app.openpo.st/.well-known/oauth-protected-resource${suffix}`),
      "application/json",
    );
  }
  for (const endpoint of ["ard.json", "agent-skills/index.json"]) {
    assert.equal(
      native.get(`https://openpo.st/.well-known/${endpoint}`)?.split(";")[0],
      "application/json",
    );
  }
  assert.equal(
    native.get("https://openpo.st/.well-known/agent-skills/openpost-cli.tar.gz"),
    "application/gzip",
  );
  for (const host of ["https://openpo.st", "https://openpo.st/docs", "https://app.openpo.st"]) {
    assert.equal(native.get(`${host}/robots.txt`)?.split(";")[0], "text/plain");
  }
  assert.equal(native.get("https://openpo.st/favicon.ico"), "image/x-icon");
  assert.equal(native.get("https://app.openpo.st/mcp"), "application/json");
  for (const host of ["https://openpo.st", "https://openpo.st/docs"]) {
    assert.equal(native.get(`${host}/og/home.png`), "image/png");
  }
  for (const [prefix, type] of [
    ["https://openpo.st/assets/", "image/svg+xml"],
    ["https://openpo.st/docs/assets/", "image/webp"],
  ]) {
    assert.ok(
      [...native].some(([url, mediaType]) => url.startsWith(prefix) && mediaType === type),
      `${prefix} needs a representative ${type} boundary`,
    );
  }
});

test("proves status, media type, exact content, query isolation, and redirect behavior", async () => {
  const canonical = "https://openpo.st/pricing.md";
  const deployment = "https://deployment.example/pricing.md";
  const query = `${canonical}?openpost_proof=query-isolation`;
  const redirect = "https://openpo.st/pricing/?openpost_proof=redirect";
  const location = "https://openpo.st/pricing?openpost_proof=redirect";
  const checks = [
    {
      kind: "artifact",
      name: "marketing core",
      canonicalURL: canonical,
      deploymentURL: deployment,
      contentType: "text/markdown; charset=utf-8",
      expectedBody: "# Features\n",
      responseHeaders: { "x-openpost-discovery": "current" },
      queryIsolation: true,
    },
    {
      kind: "redirect",
      name: "marketing canonical redirect",
      url: redirect,
      status: 308,
      location: "/pricing?openpost_proof=redirect",
    },
  ];
  const responses = new Map(
    [canonical, deployment, query].map((url) => [
      url,
      response(200, "text/markdown; charset=utf-8", "# Features\n", {
        "x-openpost-discovery": "current",
      }),
    ]),
  );
  responses.set(redirect, response(308, "text/html; charset=UTF-8", "", { location }));
  const requests = [];
  const fetchImpl = async (url, options) => {
    requests.push([String(url), options.redirect]);
    const found = responses.get(String(url));
    assert.ok(found, `unexpected request ${url}`);
    return found.clone();
  };
  const result = await proveHTTPContract({ fetchImpl, checks });
  assert.deepEqual(requests, [
    [canonical, "follow"],
    [deployment, "follow"],
    [query, "follow"],
    [redirect, "manual"],
  ]);
  assert.equal(result.length, 2);
  assert.equal(result[0].sha256.length, 64);
  assert.equal(result[0].query_isolated, true);
  assert.equal(result[1].location, location);

  for (const url of [canonical, deployment, query]) {
    for (const [badResponse, error] of [
      [response(503, "text/markdown; charset=utf-8", "# Features\n"), /status/u],
      [response(200, "text/html", "# Features\n"), /content type/u],
      [
        response(200, "text/markdown; charset=utf-8", "changed", {
          "x-openpost-discovery": "current",
        }),
        /body|differs/u,
      ],
      ...(url === query
        ? []
        : [[response(200, "text/markdown; charset=utf-8", "# Features\n"), /header/u]]),
    ]) {
      const good = responses.get(url);
      responses.set(url, badResponse);
      try {
        await assert.rejects(proveHTTPContract({ fetchImpl, checks }), error, url);
      } finally {
        responses.set(url, good);
      }
    }
  }
  for (const [badResponse, error] of [
    [response(302, "text/html", "", { location }), /status/u],
    [response(308, "text/html", "", { location: "/wrong" }), /location/u],
  ]) {
    responses.set(redirect, badResponse);
    await assert.rejects(proveHTTPContract({ fetchImpl, checks }), error);
  }
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
          canonicalURL: "https://openpo.st/index.md",
          contentType: "text/markdown; charset=utf-8",
          expectedBody: "stable",
          queryIsolation: true,
        },
      ],
    }),
    /query changed the response body/u,
  );
});

test("proves binary discovery artifacts byte for byte", async () => {
  const expectedBody = Buffer.from([0, 255, 1, 254]);
  const canonical = "https://openpo.st/skill.tar.gz";
  const deployment = "https://deployment.example/skill.tar.gz";
  const responses = new Map(
    [canonical, deployment].map((url) => [url, response(200, "application/gzip", expectedBody)]),
  );
  const checks = [
    {
      kind: "artifact",
      name: "binary Agent Skill",
      canonicalURL: canonical,
      deploymentURL: deployment,
      contentType: "application/gzip",
      expectedBody,
      binary: true,
    },
  ];
  const fetchImpl = async (url) => responses.get(String(url)).clone();
  const results = await proveHTTPContract({ fetchImpl, checks });
  assert.equal(results.length, 1);
  const [result] = results;
  assert.equal(result.local_matches, true);
  assert.equal(result.deployment_matches, true);
  assert.equal(result.bytes, 4);
  assert.equal(result.sha256, "5d8d910591d272938aef5f966e0816e374beaf7b5adf02cca5f8f770596c2ce3");
  for (const url of [canonical, deployment]) {
    const good = responses.get(url);
    responses.set(url, response(200, "application/gzip", Buffer.from([0, 255, 1, 253])));
    try {
      await assert.rejects(
        proveHTTPContract({ fetchImpl, checks }),
        /body differs from local build|canonical host differs from deployment/u,
      );
    } finally {
      responses.set(url, good);
    }
  }
});

function response(status, contentType, body, headers = {}) {
  return new Response(body, {
    status,
    headers: { "content-type": contentType, ...headers },
  });
}

test("resolves section Markdown from each surface source", () => {
  assert.equal(markdownOutputForRoute("/self-hosting", "marketing"), "self-hosting.md");
  assert.equal(markdownOutputForRoute("/self-hosting", "documentation"), "self-hosting/index.md");
  assert.equal(markdownOutputForRoute("/api-reference", "documentation"), "api-reference/index.md");
  assert.equal(
    markdownOutputForRoute("/mcp/coding-assistants", "documentation"),
    "mcp/coding-assistants.md",
  );
});
