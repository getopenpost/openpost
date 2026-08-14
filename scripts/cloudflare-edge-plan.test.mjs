import assert from "node:assert/strict";
import { mkdtemp, readFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import {
  applyCloudflarePlan,
  buildCloudflareEdgePlan,
  createCloudflareClient,
  inspectCloudflarePlan,
  planDigest,
  rollbackCloudflarePlan,
  validateCloudflarePlan,
} from "./cloudflare-edge-plan.mjs";

const samplePlan = () =>
  buildCloudflareEdgePlan({
    marketingRoutes: ["/", "/features", "/tools/example"],
    documentationRoutes: ["/", "/usage/", "/usage/accounts"],
  });

test("renders ordered exact Markdown selection rules from canonical catalogues", () => {
  const plan = samplePlan();
  assert.deepEqual(
    plan.phases.map(({ phase }) => phase),
    [
      "http_request_dynamic_redirect",
      "http_request_transform",
      "http_request_cache_settings",
      "http_response_headers_transform",
    ],
  );
  assert.deepEqual(
    plan.zones.map(({ hostname }) => hostname),
    ["openpost.social", "docs.openpost.social"],
  );

  const marketing = plan.zones[0];
  const redirect = marketing.rules.http_request_dynamic_redirect[0];
  assert.match(redirect.expression, /"\/features\/"/u);
  assert.equal(redirect.action_parameters.from_value.preserve_query_string, true);

  const rewrites = marketing.rules.http_request_transform;
  assert.equal(rewrites.length, 2);
  assert.match(rewrites[0].expression, /http\.request\.method in \{"GET" "HEAD"\}/u);
  assert.match(rewrites[0].expression, /len\(http\.request\.headers\["accept"\]\) eq 1/u);
  assert.match(
    rewrites[0].expression,
    /lower\(remove_bytes\(http\.request\.headers\["accept"\]\[0\], "\\x20\\x09"\)\) eq "text\/markdown"/u,
  );
  assert.match(
    rewrites[0].expression,
    /lower\(http\.request\.headers\["accept"\]\[0\]\) wildcard "\*text\/markdown\*"/u,
  );
  assert.doesNotMatch(rewrites[0].expression, /contains/u);
  assert.deepEqual(rewrites[0].action_parameters.uri.path, { value: "/index.md" });
  assert.deepEqual(rewrites[1].action_parameters.uri.path, {
    expression: 'concat(http.request.uri.path, ".md")',
  });

  const docs = plan.zones[1];
  assert.match(docs.rules.http_request_dynamic_redirect[0].expression, /"\/usage"/u);
  assert.ok(
    docs.rules.http_request_transform.some(
      (rule) =>
        rule.action_parameters.uri.path.expression === 'concat(http.request.uri.path, "index.md")',
    ),
  );
  for (const zone of plan.zones) {
    assert.deepEqual(zone.origin_headers.canonical_html_paths, zone.canonical_routes);
    assert.equal(zone.origin_headers.markdown_pattern, "/*.md");
    assert.equal(zone.origin_headers.vary, "Accept");
    const cache = zone.rules.http_request_cache_settings[0];
    assert.match(cache.expression, /http\.request\.method in \{"GET" "HEAD"\}/u);
    assert.doesNotMatch(cache.expression, /headers\["accept"\]|text\/markdown/u);
    assert.deepEqual(cache.action_parameters.vary.headers.accept, {
      action: "normalize",
      media_types: ["text/html", "text/markdown"],
    });
    const headers = zone.rules.http_response_headers_transform[0].action_parameters.headers;
    assert.deepEqual(headers["Content-Type"], {
      operation: "set",
      value: "text/markdown; charset=utf-8",
    });
    assert.deepEqual(headers.Vary, { operation: "add", value: "Accept" });
  }
});

test("canonical path expressions exclude explicit Markdown, assets, resources, and unknown paths", () => {
  const serialized = JSON.stringify(samplePlan());
  assert.doesNotMatch(serialized, /\/features\.md"/u);
  assert.doesNotMatch(serialized, /\/assets/u);
  assert.doesNotMatch(serialized, /\/llms\.txt/u);
  assert.doesNotMatch(serialized, /\/unknown/u);
  assert.match(serialized, /"\/features"/u);
});

test("rejects Free-plan count and expression limits before an API call", async () => {
  const plan = samplePlan();
  plan.zones[0].rules.http_request_cache_settings = Array.from({ length: 11 }, (_, index) => ({
    ...plan.zones[0].rules.http_request_cache_settings[0],
    ref: `openpost:markdown:cache:${index}`,
  }));
  assert.throws(() => validateCloudflarePlan(plan), /cache rules.*Free limit 10/u);

  const tooLong = samplePlan();
  tooLong.zones[0].rules.http_request_transform[0].expression = "x".repeat(4097);
  let calls = 0;
  await assert.rejects(
    applyCloudflarePlan({
      plan: tooLong,
      confirmedDigest: planDigest(tooLong),
      evidenceDirectory: await mkdtemp(path.join(os.tmpdir(), "openpost-edge-")),
      client: { getEntrypoint: async () => (calls += 1), putEntrypoint: async () => (calls += 1) },
    }),
    /expression.*4,096/u,
  );
  assert.equal(calls, 0);

  const tooManyOriginHeaders = samplePlan();
  tooManyOriginHeaders.zones[0].origin_headers.rule_count = 101;
  assert.throws(
    () => validateCloudflarePlan(tooManyOriginHeaders),
    /101 Pages header rules exceed Cloudflare Free limit 100/u,
  );
});

test("inspection is read-only and reports unmanaged overlaps without credentials in output", async () => {
  const calls = [];
  const client = {
    getEntrypoint: async (zone, phase) => {
      calls.push(["GET", zone, phase]);
      return {
        version: "7",
        rules: [
          {
            ref: "someone-else",
            action: "rewrite",
            expression: `http.host eq "${zone === "marketing" ? "openpost.social" : "docs.openpost.social"}" and true`,
          },
        ],
      };
    },
    putEntrypoint: async () => assert.fail("inspect must not write"),
  };
  const report = await inspectCloudflarePlan({ plan: samplePlan(), client });
  assert.equal(calls.length, 8);
  assert.equal(report.conflicts.length, 8);
  assert.doesNotMatch(JSON.stringify(report), /super-secret/u);
});

test("Cloudflare boundary uses phase entrypoints and keeps credentials out of errors", async () => {
  const requests = [];
  const fetchImpl = async (url, init) => {
    requests.push([url, init]);
    if (init.method === "GET") {
      return { ok: false, status: 404, json: async () => ({ success: false }) };
    }
    return {
      ok: false,
      status: 409,
      json: async () => ({ errors: [{ message: "version conflict" }], success: false }),
    };
  };
  const client = createCloudflareClient({
    token: "super-secret",
    zoneIds: { marketing: "marketing-secret", documentation: "docs-secret" },
    fetchImpl,
  });
  assert.equal(await client.getEntrypoint("marketing", "http_request_transform"), null);
  await assert.rejects(
    client.putEntrypoint("documentation", "http_request_transform", {
      description: "desired",
      rules: [],
    }),
    (error) => {
      assert.match(error.message, /documentation\/http_request_transform.*version conflict/u);
      assert.doesNotMatch(error.message, /super-secret|docs-secret/u);
      return true;
    },
  );
  assert.match(requests[0][0], /zones\/marketing-secret\/rulesets\/phases/u);
  assert.equal(requests[0][1].headers.Authorization, "Bearer super-secret");
  assert.equal(requests[1][1].method, "PUT");
});

test("inspection includes existing rules in Free-plan capacity before apply", async () => {
  const plan = samplePlan();
  const client = {
    getEntrypoint: async (_zone, phase) => ({
      version: "1",
      rules:
        phase === "http_response_headers_transform"
          ? Array.from({ length: 9 }, (_, index) => ({
              ref: `unrelated-${index}`,
              expression: `http.request.uri.path eq "/private-${index}"`,
              action: "rewrite",
            }))
          : [],
    }),
  };
  const report = await inspectCloudflarePlan({ plan, client });
  assert.ok(
    report.conflicts.some(
      ({ reason }) => reason === "12 transform rules exceed Cloudflare Free limit 10",
    ),
  );
});

test("inspection fails closed on every unmanaged rule in an owned phase", async () => {
  const client = {
    getEntrypoint: async () => ({
      version: "1",
      rules: [
        {
          ref: "broad-private-rule",
          expression: 'starts_with(http.request.uri.path, "/private")',
          action: "rewrite",
        },
      ],
    }),
  };
  const report = await inspectCloudflarePlan({ plan: samplePlan(), client });
  assert.equal(report.conflicts.length, 8);
});

test("apply requires the rendered digest, fails closed on conflicts, and is idempotent", async () => {
  const plan = samplePlan();
  const evidenceDirectory = await mkdtemp(path.join(os.tmpdir(), "openpost-edge-"));
  const state = new Map();
  const writes = [];
  const client = {
    getEntrypoint: async (zone, phase) => state.get(`${zone}:${phase}`) ?? null,
    putEntrypoint: async (zone, phase, body) => {
      writes.push([zone, phase, body]);
      const next = {
        ...body,
        version: String(writes.length),
        id: `${zone}-${phase}`,
        source: "firewall_managed",
      };
      state.set(`${zone}:${phase}`, next);
      return next;
    },
  };

  await assert.rejects(
    applyCloudflarePlan({ plan, client, evidenceDirectory, confirmedDigest: "wrong" }),
    /confirmation digest/u,
  );
  assert.equal(writes.length, 0);

  const first = await applyCloudflarePlan({
    plan,
    client,
    evidenceDirectory,
    confirmedDigest: planDigest(plan),
  });
  assert.equal(first.changed, 8);
  assert.equal(writes.length, 8);
  for (const [, , body] of writes) {
    assert.deepEqual(Object.keys(body).sort(), ["description", "rules"]);
  }
  const rollback = JSON.parse(
    await readFile(path.join(evidenceDirectory, "rollback-plan.json"), "utf8"),
  );
  assert.equal(rollback.operations.length, 8);
  assert.ok(rollback.digest);

  const second = await applyCloudflarePlan({
    plan,
    client,
    evidenceDirectory: await mkdtemp(path.join(os.tmpdir(), "openpost-edge-")),
    confirmedDigest: planDigest(plan),
  });
  assert.equal(second.changed, 0);
  assert.equal(writes.length, 8);
});

test("apply fences every phase immediately before mutation and rollback restores captured state", async () => {
  const plan = samplePlan();
  const state = new Map();
  let reads = 0;
  const writes = [];
  const client = {
    getEntrypoint: async (zone, phase) => {
      reads += 1;
      if (reads === 9) return { version: "changed", rules: [] };
      return state.get(`${zone}:${phase}`) ?? null;
    },
    putEntrypoint: async (zone, phase, body) => {
      writes.push([zone, phase, body]);
      state.set(`${zone}:${phase}`, { ...body, version: "next" });
      return state.get(`${zone}:${phase}`);
    },
  };
  await assert.rejects(
    applyCloudflarePlan({
      plan,
      client,
      evidenceDirectory: await mkdtemp(path.join(os.tmpdir(), "openpost-edge-")),
      confirmedDigest: planDigest(plan),
    }),
    /changed after inspection/u,
  );
  assert.equal(writes.length, 0);

  const rollbackPlan = {
    schema_version: 1,
    plan_digest: planDigest(plan),
    operations: [
      {
        zone: "marketing",
        zone_id_env: "OPENPOST_CLOUDFLARE_MARKETING_ZONE_ID",
        phase: "http_request_transform",
        expected_after: { description: "applied", rules: [] },
        before: { description: "prior", rules: [] },
      },
    ],
  };
  rollbackPlan.digest = planDigest(rollbackPlan);
  reads = 0;
  client.getEntrypoint = async () => ({ description: "applied", rules: [] });
  await rollbackCloudflarePlan({
    rollbackPlan,
    confirmedDigest: rollbackPlan.digest,
    client,
  });
  assert.equal(writes.at(-1)[2].description, "prior");
});

test("apply stops and restores prior updates when a later phase changes before its PUT", async () => {
  const plan = samplePlan();
  let reads = 0;
  const state = new Map();
  const writes = [];
  const client = {
    getEntrypoint: async (zone, phase) => {
      reads += 1;
      if (reads === 18) {
        return {
          version: "concurrent",
          rules: [{ ref: "concurrent-operator", expression: "true", action: "rewrite" }],
        };
      }
      return state.get(`${zone}:${phase}`) ?? null;
    },
    putEntrypoint: async (zone, phase, body) => {
      writes.push([zone, phase, body]);
      state.set(`${zone}:${phase}`, { ...body, version: String(writes.length) });
      return state.get(`${zone}:${phase}`);
    },
  };
  await assert.rejects(
    applyCloudflarePlan({
      plan,
      client,
      evidenceDirectory: await mkdtemp(path.join(os.tmpdir(), "openpost-edge-")),
      confirmedDigest: planDigest(plan),
    }),
    /failed after 1 phase update.*restored 1.*changed immediately before its update/u,
  );
  assert.equal(writes.length, 2);
  assert.match(writes[1][2].description, /^Empty phase restored/u);
});

test("rollback refuses post-apply drift before any mutation", async () => {
  const rollbackPlan = {
    schema_version: 1,
    plan_digest: "sha256:reviewed",
    operations: [
      {
        zone: "marketing",
        zone_id_env: "OPENPOST_CLOUDFLARE_MARKETING_ZONE_ID",
        phase: "http_request_transform",
        expected_after: { description: "applied", rules: [] },
        before: { description: "prior", rules: [] },
      },
    ],
  };
  rollbackPlan.digest = planDigest(rollbackPlan);
  let writes = 0;
  await assert.rejects(
    rollbackCloudflarePlan({
      rollbackPlan,
      confirmedDigest: rollbackPlan.digest,
      client: {
        getEntrypoint: async () => ({
          description: "legitimate later change",
          rules: [{ ref: "later" }],
        }),
        putEntrypoint: async () => (writes += 1),
      },
    }),
    /no longer matches the applied state.*stopped before mutation/u,
  );
  assert.equal(writes, 0);
});

test("rollback fences each phase again immediately before its PUT", async () => {
  const rollbackPlan = {
    schema_version: 1,
    plan_digest: "sha256:reviewed",
    operations: [
      {
        zone: "marketing",
        zone_id_env: "OPENPOST_CLOUDFLARE_MARKETING_ZONE_ID",
        phase: "http_request_transform",
        expected_after: { description: "applied", rules: [] },
        before: { description: "prior", rules: [] },
      },
    ],
  };
  rollbackPlan.digest = planDigest(rollbackPlan);
  let reads = 0;
  let writes = 0;
  await assert.rejects(
    rollbackCloudflarePlan({
      rollbackPlan,
      confirmedDigest: rollbackPlan.digest,
      client: {
        getEntrypoint: async () => {
          reads += 1;
          return {
            description: reads === 1 ? "applied" : "changed after rollback inspection",
            rules: [],
            version: String(reads),
          };
        },
        putEntrypoint: async () => (writes += 1),
      },
    }),
    /changed immediately before rollback/u,
  );
  assert.equal(writes, 0);
});

test("apply restores already changed phases when a later Cloudflare write fails", async () => {
  const plan = samplePlan();
  const writes = [];
  const state = new Map();
  let attemptedDesiredWrites = 0;
  const client = {
    getEntrypoint: async (zone, phase) => state.get(`${zone}:${phase}`) ?? null,
    putEntrypoint: async (zone, phase, body) => {
      writes.push([zone, phase, body]);
      if (!body.description.startsWith("Empty phase restored")) {
        attemptedDesiredWrites += 1;
        if (attemptedDesiredWrites === 2) throw new Error("simulated Cloudflare failure");
      }
      const next = { ...body, version: String(writes.length) };
      state.set(`${zone}:${phase}`, next);
      return next;
    },
  };
  await assert.rejects(
    applyCloudflarePlan({
      plan,
      client,
      evidenceDirectory: await mkdtemp(path.join(os.tmpdir(), "openpost-edge-")),
      confirmedDigest: planDigest(plan),
    }),
    /failed after 1 phase update.*restored 1/u,
  );
  assert.equal(writes.length, 3);
  assert.match(writes[2][2].description, /^Empty phase restored/u);
});

test("apply recovery refuses to overwrite concurrent changes on an applied phase", async () => {
  const plan = samplePlan();
  const writes = [];
  const state = new Map();
  let desiredWrites = 0;
  const evidenceDirectory = await mkdtemp(path.join(os.tmpdir(), "openpost-edge-"));
  const client = {
    getEntrypoint: async (zone, phase) => state.get(`${zone}:${phase}`) ?? null,
    putEntrypoint: async (zone, phase, body) => {
      writes.push([zone, phase, body]);
      desiredWrites += 1;
      if (desiredWrites === 2) {
        state.set("marketing:http_request_dynamic_redirect", {
          description: "concurrent operator change",
          rules: [{ ref: "concurrent-operator", expression: "true", action: "redirect" }],
          version: "concurrent",
        });
        throw new Error("later phase failed");
      }
      const next = { ...body, version: String(writes.length) };
      state.set(`${zone}:${phase}`, next);
      return next;
    },
  };
  await assert.rejects(
    applyCloudflarePlan({
      plan,
      client,
      evidenceDirectory,
      confirmedDigest: planDigest(plan),
    }),
    /restored 0.*current state no longer matches.*restore skipped/u,
  );
  assert.equal(writes.length, 2);
  assert.match(
    await readFile(path.join(evidenceDirectory, "failure.json"), "utf8"),
    /current state no longer matches the applied state/u,
  );
});

test("apply restores every changed phase if after-state evidence cannot be collected", async () => {
  const plan = samplePlan();
  let reads = 0;
  const writes = [];
  const state = new Map();
  const client = {
    getEntrypoint: async (zone, phase) => {
      reads += 1;
      if (reads === 25) throw new Error("after inspection unavailable");
      return state.get(`${zone}:${phase}`) ?? null;
    },
    putEntrypoint: async (zone, phase, body) => {
      writes.push([zone, phase, body]);
      const next = { ...body, version: String(writes.length) };
      state.set(`${zone}:${phase}`, next);
      return next;
    },
  };
  const evidenceDirectory = await mkdtemp(path.join(os.tmpdir(), "openpost-edge-"));
  await assert.rejects(
    applyCloudflarePlan({
      plan,
      client,
      evidenceDirectory,
      confirmedDigest: planDigest(plan),
    }),
    /failed after 8 phase update.*restored 8.*after inspection unavailable/u,
  );
  assert.equal(writes.length, 16);
  assert.match(await readFile(path.join(evidenceDirectory, "failure.json"), "utf8"), /restored/u);
});

test("apply records mismatched after-state evidence and restores every changed phase", async () => {
  const plan = samplePlan();
  let reads = 0;
  const writes = [];
  const state = new Map();
  const client = {
    getEntrypoint: async (zone, phase) => {
      reads += 1;
      if (reads > 24 && reads <= 32) {
        return { description: "mismatched after inspection", rules: [], version: "unexpected" };
      }
      return state.get(`${zone}:${phase}`) ?? null;
    },
    putEntrypoint: async (zone, phase, body) => {
      writes.push([zone, phase, body]);
      const next = { ...body, version: String(writes.length) };
      state.set(`${zone}:${phase}`, next);
      return next;
    },
  };
  const evidenceDirectory = await mkdtemp(path.join(os.tmpdir(), "openpost-edge-"));
  await assert.rejects(
    applyCloudflarePlan({
      plan,
      client,
      evidenceDirectory,
      confirmedDigest: planDigest(plan),
    }),
    /failed after 8 phase update.*restored 8.*8 unsettled phase/u,
  );
  assert.equal(writes.length, 16);
  assert.match(
    await readFile(path.join(evidenceDirectory, "after.json"), "utf8"),
    /"changed": true/u,
  );
  assert.match(await readFile(path.join(evidenceDirectory, "failure.json"), "utf8"), /unsettled/u);
});
