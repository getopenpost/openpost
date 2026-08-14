#!/usr/bin/env bun

import { createHash } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { docsPageCatalog } from "../packages/social-images/src/docs-catalog.js";
import { marketingRouteManifest } from "../packages/social-images/src/index.js";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const blueprint = JSON.parse(await readFile(path.join(root, "cloudflare/edge-plan.json"), "utf8"));
const serverFields = new Set(["id", "last_updated", "version"]);

function compareText(left, right) {
  return left < right ? -1 : left > right ? 1 : 0;
}

function sortedUnique(values) {
  return [...new Set(values)].sort(compareText);
}

function quote(value) {
  return JSON.stringify(value);
}

function pathSet(paths, field = "http.request.uri.path") {
  if (paths.length === 0) return "false";
  return `${field} in {${sortedUnique(paths).map(quote).join(" ")}}`;
}

const safeRepresentationMethod = 'http.request.method in {"GET" "HEAD"}';
const successfulMarkdownResponse =
  'http.response.code eq 200 and http.response.content_type.media_type eq "text/markdown"';
const exactMarkdownAccept = [
  "not http.request.headers.truncated",
  'len(http.request.headers["accept"]) eq 1',
  'lower(remove_bytes(http.request.headers["accept"][0], "\\x20\\x09")) eq "text/markdown"',
  'lower(http.request.headers["accept"][0]) wildcard "*text/markdown*"',
].join(" and ");

function expressionFor(hostname, paths, { raw = false, exactMarkdown = true } = {}) {
  const field = raw ? "raw.http.request.uri.path" : "http.request.uri.path";
  const request = exactMarkdown
    ? `${safeRepresentationMethod} and ${exactMarkdownAccept}`
    : safeRepresentationMethod;
  return `(http.host eq ${quote(hostname)} and ${request} and ${pathSet(paths, field)})`;
}

function rule(ref, description, expression, action, actionParameters) {
  return {
    ref: `${blueprint.rule_ref_prefix}${ref}`,
    description,
    expression,
    action,
    action_parameters: actionParameters,
    enabled: true,
  };
}

function redirectRule(zone, paths, mode) {
  if (paths.length === 0) return [];
  const removeSlash = mode === "remove";
  return [
    rule(
      `${zone.key}:canonical-redirect`,
      removeSlash
        ? "OpenPost canonical marketing paths omit trailing slashes"
        : "OpenPost documentation section indexes end in a slash",
      `(http.host eq ${quote(zone.hostname)} and ${pathSet(paths)})`,
      "redirect",
      {
        from_value: {
          target_url: {
            expression: removeSlash
              ? `concat(${quote(`https://${zone.hostname}`)}, wildcard_replace(http.request.uri.path, "/*/", "/\${1}"))`
              : `concat(${quote(`https://${zone.hostname}`)}, http.request.uri.path, "/")`,
          },
          status_code: 308,
          preserve_query_string: true,
        },
      },
    ),
  ];
}

function rewriteRules(zone, routes) {
  const rootRoute = routes.includes("/") ? ["/"] : [];
  const sectionIndexes = routes.filter((route) => route !== "/" && route.endsWith("/"));
  const ordinary = routes.filter((route) => route !== "/" && !route.endsWith("/"));
  const rules = [];
  if (rootRoute.length) {
    rules.push(
      rule(
        `${zone.key}:root-rewrite`,
        "Select the explicit root Markdown artifact for an exact Markdown request",
        expressionFor(zone.hostname, rootRoute),
        "rewrite",
        { uri: { path: { value: "/index.md" } } },
      ),
    );
  }
  if (sectionIndexes.length) {
    rules.push(
      rule(
        `${zone.key}:section-rewrite`,
        "Select section-index Markdown artifacts for exact Markdown requests",
        expressionFor(zone.hostname, sectionIndexes),
        "rewrite",
        { uri: { path: { expression: 'concat(http.request.uri.path, "index.md")' } } },
      ),
    );
  }
  if (ordinary.length) {
    rules.push(
      rule(
        `${zone.key}:page-rewrite`,
        "Select page Markdown artifacts for exact Markdown requests",
        expressionFor(zone.hostname, ordinary),
        "rewrite",
        { uri: { path: { expression: 'concat(http.request.uri.path, ".md")' } } },
      ),
    );
  }
  return rules;
}

function representationRules(zone, routes) {
  const markdownExpression = expressionFor(zone.hostname, routes, { raw: true });
  const markdownResponseExpression = `${markdownExpression} and ${successfulMarkdownResponse}`;
  const representationExpression = expressionFor(zone.hostname, routes, {
    raw: true,
    exactMarkdown: false,
  });
  return {
    http_request_cache_settings: [
      rule(
        `${zone.key}:vary-cache`,
        "Keep canonical HTML and Markdown responses in separate cache variants",
        representationExpression,
        "set_cache_settings",
        {
          cache: true,
          vary: {
            default: { action: "bypass" },
            headers: {
              accept: {
                action: "passthrough",
              },
            },
          },
        },
      ),
    ],
    http_response_headers_transform: [
      rule(
        `${zone.key}:markdown-response`,
        "Identify internally selected Markdown and declare its cache variance",
        markdownResponseExpression,
        "rewrite",
        {
          headers: {
            "Content-Type": {
              operation: "set",
              value: "text/markdown; charset=utf-8",
            },
            Vary: { operation: "add", value: "Accept" },
          },
        },
      ),
    ],
  };
}

export function buildCloudflareEdgePlan({
  marketingRoutes = marketingRouteManifest.map(({ path: route }) => route),
  documentationRoutes = docsPageCatalog.map(({ route }) => route),
} = {}) {
  const routesByZone = {
    marketing: sortedUnique(marketingRoutes),
    documentation: sortedUnique(documentationRoutes),
  };
  const zones = blueprint.zones.map((zone) => {
    const routes = routesByZone[zone.key];
    const canonicalRedirects =
      zone.key === "marketing"
        ? routes.filter((route) => route !== "/").map((route) => `${route}/`)
        : routes
            .filter((route) => route !== "/" && route.endsWith("/"))
            .map((route) => route.slice(0, -1));
    return {
      ...zone,
      canonical_routes: routes,
      origin_headers: {
        canonical_html_paths: routes,
        markdown_pattern: "/*.md",
        vary: "Accept",
        rule_count: routes.length + zone.pages_base_header_rules,
      },
      rules: {
        http_request_dynamic_redirect: redirectRule(
          zone,
          canonicalRedirects,
          zone.key === "marketing" ? "remove" : "add",
        ),
        http_request_transform: rewriteRules(zone, routes),
        ...representationRules(zone, routes),
      },
    };
  });
  const plan = {
    schema_version: blueprint.schema_version,
    owner: blueprint.owner,
    rule_ref_prefix: blueprint.rule_ref_prefix,
    limits: blueprint.limits,
    phases: blueprint.phases.map((phase, order) => ({ order: order + 1, phase })),
    zones,
  };
  validateCloudflarePlan(plan);
  return plan;
}

function walkExpressions(value, location, found = []) {
  if (Array.isArray(value)) {
    value.forEach((entry, index) => walkExpressions(entry, `${location}[${index}]`, found));
  } else if (value && typeof value === "object") {
    for (const [key, entry] of Object.entries(value)) {
      if (key === "expression" && typeof entry === "string") found.push([location, entry]);
      else walkExpressions(entry, `${location}.${key}`, found);
    }
  }
  return found;
}

function capacityProblems(plan, rulesByPhase, location, originHeaders) {
  const problems = [];
  const ruleFamilies = [
    ["single redirect", ["http_request_dynamic_redirect"], plan.limits.single_redirect_rules],
    [
      "transform",
      ["http_request_transform", "http_response_headers_transform"],
      plan.limits.transform_rules,
    ],
    ["cache", ["http_request_cache_settings"], plan.limits.cache_rules],
  ];
  for (const [label, phases, maximum] of ruleFamilies) {
    const count = phases.reduce((total, phase) => total + (rulesByPhase[phase]?.length ?? 0), 0);
    if (count > maximum) {
      problems.push({
        phase: phases.length === 1 ? phases[0] : "transform phases",
        reason: `${count} ${label} rules exceed Cloudflare Free limit ${maximum}`,
      });
    }
  }
  for (const [phase, rules] of Object.entries(rulesByPhase)) {
    for (const [expressionLocation, expression] of walkExpressions(rules, `${location}.${phase}`)) {
      if (expression.length > plan.limits.expression_characters) {
        problems.push({
          phase,
          reason: `${expressionLocation} expression uses ${expression.length} characters; Cloudflare limit is 4,096`,
        });
      }
    }
  }
  if (originHeaders?.rule_count > plan.limits.pages_header_rules) {
    problems.push({
      phase: "origin _headers",
      reason: `${originHeaders.rule_count} Pages header rules exceed Cloudflare Free limit ${plan.limits.pages_header_rules}`,
    });
  }
  return problems;
}

export function validateCloudflarePlan(plan) {
  if (plan.schema_version !== 1) throw new Error("Cloudflare edge plan schema_version must be 1");
  const expectedPhases = blueprint.phases;
  const actualPhases = plan.phases.map(({ phase }) => phase);
  if (JSON.stringify(actualPhases) !== JSON.stringify(expectedPhases)) {
    throw new Error("Cloudflare phases are not in the required execution order");
  }
  for (const zone of plan.zones) {
    for (const cacheRule of zone.rules.http_request_cache_settings ?? []) {
      const accept = cacheRule.action_parameters?.vary?.headers?.accept;
      if (accept?.action !== "passthrough" || Object.keys(accept).some((key) => key !== "action")) {
        throw new Error(`${zone.hostname} Accept cache variance must use exact passthrough`);
      }
    }
    for (const responseRule of zone.rules.http_response_headers_transform ?? []) {
      if (
        !responseRule.expression.includes("http.response.code eq 200") ||
        !responseRule.expression.includes(
          'http.response.content_type.media_type eq "text/markdown"',
        )
      ) {
        throw new Error(
          `${zone.hostname} Markdown response transform must require a successful Markdown origin response`,
        );
      }
    }
    const [problem] = capacityProblems(plan, zone.rules, zone.key, zone.origin_headers);
    if (problem) {
      throw new Error(`${zone.hostname} ${problem.reason}`);
    }
  }
  return plan;
}

function canonicalize(value) {
  if (Array.isArray(value)) return value.map(canonicalize);
  if (value && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value)
        .sort(([left], [right]) => compareText(left, right))
        .map(([key, entry]) => [key, canonicalize(entry)]),
    );
  }
  return value;
}

function stableJSON(value) {
  return `${JSON.stringify(canonicalize(value), null, 2)}\n`;
}

export function planDigest(plan) {
  const { digest: _digest, ...unsigned } = plan;
  return `sha256:${createHash("sha256").update(stableJSON(unsigned)).digest("hex")}`;
}

function stripServerFields(value) {
  if (Array.isArray(value)) return value.map(stripServerFields);
  if (value && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value)
        .filter(([key]) => !serverFields.has(key))
        .map(([key, entry]) => [key, stripServerFields(entry)]),
    );
  }
  return value;
}

function writableEntrypoint(state) {
  return {
    description: state.description ?? "",
    rules: (state.rules ?? []).map(stripServerFields),
  };
}

function phaseBody(zone, phase, current) {
  const managedRefs = new Set(zone.rules[phase].map(({ ref }) => ref));
  const unmanaged = (current?.rules ?? []).filter(
    ({ ref = "" }) => !ref.startsWith(blueprint.rule_ref_prefix) && !managedRefs.has(ref),
  );
  return {
    description:
      current?.description ?? "OpenPost phase entry point managed with repository evidence",
    rules: [...unmanaged.map(stripServerFields), ...zone.rules[phase]],
  };
}

function stateIdentity(state) {
  if (!state) return null;
  return canonicalize(writableEntrypoint(state));
}

function sameWritableState(left, right) {
  return JSON.stringify(stateIdentity(left)) === JSON.stringify(stateIdentity(right));
}

function unmanagedConflicts(zone, phase, state) {
  return (state?.rules ?? [])
    .filter(({ ref = "" }) => !ref.startsWith(blueprint.rule_ref_prefix))
    .map((candidate) => ({
      zone: zone.key,
      phase,
      ref: candidate.ref ?? null,
      description: candidate.description ?? null,
      reason: "unmanaged rule shares an OpenPost-owned phase; resolve its ownership before apply",
    }));
}

export async function inspectCloudflarePlan({ plan = buildCloudflareEdgePlan(), client }) {
  validateCloudflarePlan(plan);
  const entries = [];
  const conflicts = [];
  for (const zone of plan.zones) {
    for (const { phase } of plan.phases) {
      const current = await client.getEntrypoint(zone.key, phase, zone.zone_id_env);
      const desired = phaseBody(zone, phase, current);
      const phaseConflicts = unmanagedConflicts(zone, phase, current);
      conflicts.push(...phaseConflicts);
      entries.push({
        zone: zone.key,
        hostname: zone.hostname,
        zone_id_env: zone.zone_id_env,
        phase,
        current,
        desired,
        changed: !sameWritableState(current, desired),
        unmanaged_rules: (current?.rules ?? []).filter(
          ({ ref = "" }) => !ref.startsWith(plan.rule_ref_prefix),
        ).length,
        conflicts: phaseConflicts,
      });
    }
  }
  for (const zone of plan.zones) {
    const zoneEntries = entries.filter((entry) => entry.zone === zone.key);
    const desiredRules = Object.fromEntries(
      zoneEntries.map(({ phase, desired }) => [phase, desired.rules]),
    );
    for (const problem of capacityProblems(plan, desiredRules, zone.key, zone.origin_headers)) {
      conflicts.push({
        zone: zone.key,
        phase: problem.phase,
        ref: null,
        description: null,
        reason: problem.reason,
      });
    }
  }
  return { schema_version: 1, plan_digest: planDigest(plan), entries, conflicts };
}

function snapshotVersion(state) {
  return state
    ? { id: state.id ?? null, version: state.version ?? null, state: stateIdentity(state) }
    : null;
}

function sameSnapshot(left, right) {
  return JSON.stringify(snapshotVersion(left)) === JSON.stringify(snapshotVersion(right));
}

async function writeEvidence(directory, name, value) {
  await mkdir(directory, { recursive: true });
  await writeFile(path.join(directory, name), stableJSON(value), { flag: "wx" });
}

export async function applyCloudflarePlan({
  plan = buildCloudflareEdgePlan(),
  client,
  confirmedDigest,
  evidenceDirectory,
}) {
  validateCloudflarePlan(plan);
  const digest = planDigest(plan);
  if (confirmedDigest !== digest) {
    throw new Error(`apply confirmation digest must equal ${digest}`);
  }
  if (!evidenceDirectory) throw new Error("apply requires an evidence directory");
  const inspection = await inspectCloudflarePlan({ plan, client });
  await writeEvidence(evidenceDirectory, "before.json", inspection);
  if (inspection.conflicts.length) {
    throw new Error(
      `apply stopped: ${inspection.conflicts.length} unmanaged conflict(s); review before.json`,
    );
  }

  // Re-read every phase before the first write so a stale inspection cannot overwrite operator work.
  for (const entry of inspection.entries) {
    const current = await client.getEntrypoint(entry.zone, entry.phase, entry.zone_id_env);
    if (!sameSnapshot(current, entry.current)) {
      throw new Error(
        `${entry.zone} ${entry.phase} changed after inspection; no mutation performed`,
      );
    }
  }

  const rollbackPlan = {
    schema_version: 1,
    plan_digest: digest,
    operations: inspection.entries
      .filter((entry) => entry.changed)
      .map((entry) => ({
        zone: entry.zone,
        zone_id_env: entry.zone_id_env,
        phase: entry.phase,
        expected_after: entry.desired,
        before:
          entry.current === null
            ? {
                description: "Empty phase restored after OpenPost edge-plan rollback",
                rules: [],
              }
            : writableEntrypoint(entry.current),
      })),
  };
  rollbackPlan.digest = planDigest(rollbackPlan);
  await writeEvidence(evidenceDirectory, "rollback-plan.json", rollbackPlan);

  let changed = 0;
  let after;
  const applied = [];
  try {
    for (const entry of inspection.entries) {
      if (!entry.changed) continue;
      const current = await client.getEntrypoint(entry.zone, entry.phase, entry.zone_id_env);
      if (!sameSnapshot(current, entry.current)) {
        throw new Error(
          `${entry.zone} ${entry.phase} changed immediately before its update; apply stopped`,
        );
      }
      const conflicts = unmanagedConflicts(
        plan.zones.find((zone) => zone.key === entry.zone),
        entry.phase,
        current,
      );
      if (conflicts.length) {
        throw new Error(
          `${entry.zone} ${entry.phase} gained ${conflicts.length} unmanaged conflict(s) immediately before its update`,
        );
      }
      await client.putEntrypoint(entry.zone, entry.phase, entry.desired, entry.zone_id_env);
      applied.push(
        rollbackPlan.operations.find(
          (operation) => operation.zone === entry.zone && operation.phase === entry.phase,
        ),
      );
      changed += 1;
    }
    after = await inspectCloudflarePlan({ plan, client });
    await writeEvidence(evidenceDirectory, "after.json", after);
    const unsettled = after.entries.filter((entry) => entry.changed);
    if (after.conflicts.length || unsettled.length) {
      throw new Error(
        `after inspection did not match the reviewed plan (${after.conflicts.length} conflict(s), ${unsettled.length} unsettled phase(s))`,
      );
    }
  } catch (error) {
    let restored = 0;
    const rollbackErrors = [];
    for (const operation of [...applied].reverse()) {
      try {
        const current = await client.getEntrypoint(
          operation.zone,
          operation.phase,
          operation.zone_id_env,
        );
        if (!sameWritableState(current, operation.expected_after)) {
          throw new Error("current state no longer matches the applied state; restore skipped");
        }
        await client.putEntrypoint(
          operation.zone,
          operation.phase,
          operation.before,
          operation.zone_id_env,
        );
        restored += 1;
      } catch (rollbackError) {
        rollbackErrors.push(`${operation.zone}/${operation.phase}: ${rollbackError.message}`);
      }
    }
    await writeEvidence(evidenceDirectory, "failure.json", {
      schema_version: 1,
      plan_digest: digest,
      failed_after_phase_updates: changed,
      restored_phase_updates: restored,
      rollback_errors: rollbackErrors,
      error: error.message,
    });
    const rollbackSuffix = rollbackErrors.length
      ? `; rollback errors: ${rollbackErrors.join("; ")}`
      : "";
    throw new Error(
      `apply failed after ${changed} phase update(s); restored ${restored}${rollbackSuffix}: ${error.message}`,
    );
  }
  return { plan_digest: digest, rollback_digest: rollbackPlan.digest, changed, after };
}

export async function rollbackCloudflarePlan({ rollbackPlan, confirmedDigest, client }) {
  const digest = planDigest(rollbackPlan);
  if (rollbackPlan.digest !== digest || confirmedDigest !== digest) {
    throw new Error(`rollback confirmation digest must equal ${digest}`);
  }
  const inspected = [];
  for (const operation of rollbackPlan.operations) {
    const current = await client.getEntrypoint(
      operation.zone,
      operation.phase,
      operation.zone_id_env,
    );
    if (!sameWritableState(current, operation.expected_after)) {
      throw new Error(
        `${operation.zone} ${operation.phase} no longer matches the applied state; rollback stopped before mutation`,
      );
    }
    inspected.push({ operation, current });
  }
  for (const { operation, current: inspectedCurrent } of inspected) {
    const current = await client.getEntrypoint(
      operation.zone,
      operation.phase,
      operation.zone_id_env,
    );
    if (!sameSnapshot(current, inspectedCurrent)) {
      throw new Error(
        `${operation.zone} ${operation.phase} changed immediately before rollback; rollback stopped`,
      );
    }
    await client.putEntrypoint(
      operation.zone,
      operation.phase,
      operation.before,
      operation.zone_id_env,
    );
  }
  return { restored: rollbackPlan.operations.length, rollback_digest: digest };
}

export function createCloudflareClient({ token, zoneIds, fetchImpl = fetch }) {
  if (!token) throw new Error("OPENPOST_CLOUDFLARE_EDGE_API_TOKEN is required");
  for (const zone of blueprint.zones) {
    if (!zoneIds[zone.key]) throw new Error(`${zone.zone_id_env} is required`);
  }
  async function request(method, zone, phase, body) {
    const zoneId = zoneIds[zone];
    const response = await fetchImpl(
      `${blueprint.api_base_url}/zones/${encodeURIComponent(zoneId)}/rulesets/phases/${phase}/entrypoint`,
      {
        method,
        headers: {
          Authorization: `Bearer ${token}`,
          "Content-Type": "application/json",
        },
        body: body ? JSON.stringify(body) : undefined,
      },
    );
    const payload = await response.json().catch(() => ({}));
    if (method === "GET" && response.status === 404) return null;
    if (!response.ok || payload.success === false) {
      const messages = [...(payload.errors ?? []), ...(payload.messages ?? [])]
        .map(({ message }) => message)
        .filter(Boolean)
        .join("; ");
      throw new Error(
        `Cloudflare ${method} ${zone}/${phase} failed (${response.status}): ${messages}`,
      );
    }
    return payload.result;
  }
  return {
    getEntrypoint: (zone, phase) => request("GET", zone, phase),
    putEntrypoint: (zone, phase, body) => request("PUT", zone, phase, body),
  };
}

function option(name) {
  const index = process.argv.indexOf(name);
  return index === -1 ? undefined : process.argv[index + 1];
}

function operatorClient() {
  return createCloudflareClient({
    token: process.env.OPENPOST_CLOUDFLARE_EDGE_API_TOKEN,
    zoneIds: {
      marketing: process.env.OPENPOST_CLOUDFLARE_MARKETING_ZONE_ID,
      documentation: process.env.OPENPOST_CLOUDFLARE_DOCUMENTATION_ZONE_ID,
    },
  });
}

async function main() {
  const command = process.argv[2];
  const plan = buildCloudflareEdgePlan();
  if (command === "render") {
    const rendered = { ...plan, digest: planDigest(plan) };
    const output = option("--output");
    if (output) await writeFile(path.resolve(output), stableJSON(rendered));
    else process.stdout.write(stableJSON(rendered));
    return;
  }
  if (command === "inspect") {
    const report = await inspectCloudflarePlan({ plan, client: operatorClient() });
    process.stdout.write(stableJSON(report));
    if (report.conflicts.length) process.exitCode = 2;
    return;
  }
  if (command === "apply") {
    const result = await applyCloudflarePlan({
      plan,
      client: operatorClient(),
      confirmedDigest: option("--confirm"),
      evidenceDirectory: option("--evidence"),
    });
    process.stdout.write(stableJSON(result));
    return;
  }
  if (command === "rollback") {
    const file = option("--file");
    if (!file) throw new Error("rollback requires --file ROLLBACK_PLAN");
    const rollbackPlan = JSON.parse(await readFile(path.resolve(file), "utf8"));
    const result = await rollbackCloudflarePlan({
      rollbackPlan,
      confirmedDigest: option("--confirm"),
      client: operatorClient(),
    });
    process.stdout.write(stableJSON(result));
    return;
  }
  throw new Error(
    "usage: cloudflare-edge-plan.mjs render [--output FILE] | inspect | apply --confirm DIGEST --evidence DIR | rollback --file FILE --confirm DIGEST",
  );
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    await main();
  } catch (error) {
    console.error(`cloudflare-edge-plan: ${error.message}`);
    process.exitCode = 1;
  }
}
