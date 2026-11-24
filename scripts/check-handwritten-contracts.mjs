#!/usr/bin/env bun

// Checks hand-written contract mirrors against apps/web/openapi.json.
//
// check-contracts.mjs regenerates and compares generated artifacts, so a REST
// field that a hand-written type never absorbs stays silent. This script
// closes that gap for the two largest hand-written type sets and for the
// hand-maintained n8n selection:
//
// - packages/sdk/src/types.ts interfaces vs components.schemas entries.
// - apps/cli/internal/api/client.go structs (json names) vs the same schemas.
// - scripts/generate-selected-automation-contract.mjs desiredActions: every
//   automation-exposed operation must be selected or explicitly excluded.
//
// "Automation-exposed" (the issue's "publishable") means the operation
// carries x-openpost-automation with an exposure other than "disabled".
// Exposure "alpha" is currently the only non-disabled value.
//
// Intentional subsets live in EXCLUSIONS below, one table with a reason per
// entry. Unused entries fail so the table cannot rot silently. SDK phantom
// tombstones (deprecated never/undefined fields the wire format never sends)
// follow the packages/sdk/src/types-parity.test.ts convention and are not
// exclusions: they carry no readable value.
//
// Offline, local files only. No runtime dependency is added to any published
// package: typescript is already used by scripts/check-query-migration.mjs.

import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

import ts from "typescript";

import { desiredActions } from "./generate-selected-automation-contract.mjs";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

export const SDK_TYPES_PATH = "packages/sdk/src/types.ts";
export const CLI_CLIENT_PATH = "apps/cli/internal/api/client.go";
export const OPENAPI_PATH = "apps/web/openapi.json";

export const SDK_PAIRS = [
  { handType: "Publication", schema: "PublicationResponse" },
  { handType: "Rendition", schema: "RenditionResponse" },
  { handType: "SocialAccount", schema: "AccountResponse" },
  { handType: "Job", schema: "JobResponse" },
  { handType: "Workspace", schema: "WorkspaceResponse" },
];

export const CLI_PAIRS = [
  { handType: "Publication", schema: "PublicationResponse" },
  { handType: "Rendition", schema: "RenditionResponse" },
  { handType: "SocialAccount", schema: "AccountResponse" },
  { handType: "Workspace", schema: "WorkspaceResponse" },
];

// One documented exclusion table. Field entries name a hand-written type and
// a wire field it deliberately omits (or, if ever needed, a phantom field it
// deliberately keeps). n8n entries name an exposed operation deliberately
// outside the v1 n8n action set.
export const EXCLUSIONS = [
  {
    artifact: "sdk:Publication",
    field: "$schema",
    reason: "JSON-Schema document URL, not resource data; no SDK consumer reads it.",
  },
  {
    artifact: "sdk:SocialAccount",
    field: "$schema",
    reason: "JSON-Schema document URL, not resource data; no SDK consumer reads it.",
  },
  {
    artifact: "sdk:Job",
    field: "$schema",
    reason: "JSON-Schema document URL, not resource data; no SDK consumer reads it.",
  },
  {
    artifact: "cli:Publication",
    field: "$schema",
    reason: "JSON-Schema document URL, not resource data; no --json consumer needs it.",
  },
  {
    artifact: "cli:SocialAccount",
    field: "$schema",
    reason: "JSON-Schema document URL, not resource data; no --json consumer needs it.",
  },
  {
    artifact: "n8n",
    operationId: "get-analytics-overview",
    reason: "Read-only analytics insight; the v1 n8n selection covers publishing workflows.",
  },
  {
    artifact: "n8n",
    operationId: "list-engagement",
    reason: "Read-only reply/comment insight; the v1 n8n selection covers publishing workflows.",
  },
  {
    artifact: "n8n",
    operationId: "list-growth-recommendations",
    reason: "Read-only growth insight; the v1 n8n selection covers publishing workflows.",
  },
  {
    artifact: "n8n",
    operationId: "list-conversations",
    reason: "Stored conversation reads are outside the v1 n8n action set.",
  },
  {
    artifact: "n8n",
    operationId: "list-conversation-messages",
    reason: "Stored conversation reads are outside the v1 n8n action set.",
  },
  {
    artifact: "n8n",
    operationId: "list-notifications",
    reason: "Notification listing is outside the v1 n8n action set.",
  },
  {
    artifact: "n8n",
    operationId: "get-prompt-categories",
    reason: "Writing-prompt helpers are outside the v1 n8n action set.",
  },
  {
    artifact: "n8n",
    operationId: "list-prompts",
    reason: "Writing-prompt helpers are outside the v1 n8n action set.",
  },
  {
    artifact: "n8n",
    operationId: "get-random-prompt",
    reason: "Writing-prompt helpers are outside the v1 n8n action set.",
  },
  {
    artifact: "n8n",
    operationId: "get-voice-profile",
    reason: "Voice-profile reads back Create with AI and are outside the v1 n8n action set.",
  },
  {
    artifact: "n8n",
    operationId: "list-voice-profiles",
    reason: "Voice-profile reads back Create with AI and are outside the v1 n8n action set.",
  },
  {
    artifact: "n8n",
    operationId: "resolve-effective-voice-profiles",
    reason: "Voice-profile reads back Create with AI and are outside the v1 n8n action set.",
  },
  {
    artifact: "n8n",
    operationId: "get-repost-automation",
    reason: "Repost-rule reads are outside the v1 n8n action set.",
  },
  {
    artifact: "n8n",
    operationId: "list-jobs",
    reason: "Job listing is outside the v1 set; v1 covers get-job for polling a known job.",
  },
  {
    artifact: "n8n",
    operationId: "read-account-features",
    reason:
      "Account feature reads are outside the v1 set; v1 covers destination options and provider readiness.",
  },
];

export function loadSchemas(spec) {
  const schemas = spec?.components?.schemas;
  if (!schemas) throw new Error("openapi.json has no components.schemas");
  const out = new Map();
  for (const [name, schema] of Object.entries(schemas)) {
    out.set(name, Object.keys(schema?.properties ?? {}));
  }
  return out;
}

// Declared SDK properties for one interface, mirroring the
// types-parity.test.ts reader so both gates see the same shape.
function parseSdkInterface(sourceText, typeName) {
  const source = ts.createSourceFile("types.ts", sourceText, ts.ScriptTarget.Latest, true);
  for (const statement of source.statements) {
    if (!ts.isInterfaceDeclaration(statement) || statement.name.text !== typeName) continue;
    const props = [];
    for (const member of statement.members) {
      if (!ts.isPropertySignature(member) || !member.type) continue;
      props.push({
        name: member.name.getText(source).replace(/^["']|["']$/g, ""),
        typeText: member.type.getText(source),
        deprecated: ts.getJSDocTags(member).some((tag) => tag.tagName.text === "deprecated"),
      });
    }
    return props;
  }
  throw new Error(`SDK interface ${typeName} not found`);
}

// Phantom tombstones: a key the wire format never sends may stay declared
// only when documented deprecated and typed so no value can be read.
export function isTombstone(prop) {
  if (!prop.deprecated) return false;
  const type = prop.typeText.trim();
  return type === "never" || type === "undefined" || type.includes("never");
}

// Wire names of one Go struct from its json tags. Untagged exported fields
// are reported under their Go name so an accidental untagged addition fails
// instead of slipping through; json:"-" fields are skipped.
export function parseGoStruct(sourceText, typeName) {
  const lines = sourceText.split("\n");
  const start = lines.findIndex((line) =>
    new RegExp(`^type\\s+${typeName}\\s+struct\\s*\\{`).test(line),
  );
  if (start < 0) throw new Error(`Go struct ${typeName} not found`);
  const names = [];
  for (let index = start + 1; index < lines.length; index += 1) {
    const line = lines[index];
    if (/^\}/.test(line)) break;
    const tag = line.match(/json:"([^"]+)"/);
    if (!tag) {
      const code = line.split("//")[0].trim();
      if (!code) continue;
      const field = code.match(/^([A-Za-z_][A-Za-z0-9_]*)\b/);
      if (field && /^[A-Z]/.test(field[1])) names.push(field[1]);
      continue;
    }
    const name = tag[1].split(",")[0];
    if (name === "-" || name === "") continue;
    names.push(name);
  }
  return names;
}

// An operation is publishable when the automation catalog exposes it.
export function exposedOperationIds(spec) {
  const out = new Set();
  for (const pathItem of Object.values(spec?.paths ?? {})) {
    for (const operation of Object.values(pathItem ?? {})) {
      if (!operation || typeof operation !== "object" || !operation.operationId) continue;
      const exposure = operation["x-openpost-automation"]?.exposure;
      if (exposure && exposure !== "disabled") out.add(operation.operationId);
    }
  }
  return out;
}

export function selectedOperationIds(desired = desiredActions) {
  return new Set(desired.flatMap((action) => action.operationIDs ?? []));
}

function fieldExclusionsFor(artifact, exclusions = EXCLUSIONS) {
  return exclusions.filter((entry) => entry.artifact === artifact && entry.field !== undefined);
}

function n8nExclusions(exclusions = EXCLUSIONS) {
  return exclusions.filter((entry) => entry.artifact === "n8n" && entry.operationId !== undefined);
}

export function checkTypePair({
  artifact,
  declared,
  tombstone,
  schemaProps,
  exclusions = EXCLUSIONS,
}) {
  const problems = [];
  const excluded = new Set(
    fieldExclusionsFor(artifact, exclusions)
      .filter((entry) => entry.field)
      .map((entry) => entry.field),
  );
  const declaredNames = new Set();
  for (const prop of declared) {
    if (tombstone?.(prop)) continue;
    declaredNames.add(prop.name);
  }
  for (const field of schemaProps) {
    if (declaredNames.has(field) || excluded.has(field)) continue;
    problems.push(
      `${artifact} is missing wire field ${field}: the schema sends it but the hand-written type cannot carry it.`,
    );
  }
  const schemaNames = new Set(schemaProps);
  for (const name of declaredNames) {
    if (schemaNames.has(name) || excluded.has(name)) continue;
    problems.push(
      `${artifact} declares invented field ${name}: no schema sends it, so consumers read a value the API never provides.`,
    );
  }
  const used = new Set([
    ...schemaProps.filter((f) => !declaredNames.has(f)),
    ...[...declaredNames].filter((n) => !schemaNames.has(n)),
  ]);
  for (const entry of fieldExclusionsFor(artifact, exclusions)) {
    if (!used.has(entry.field)) {
      problems.push(
        `${artifact} has a stale exclusion for ${entry.field}: neither missing nor invented anymore; remove the entry.`,
      );
    }
  }
  return problems;
}

export function checkN8nSelection({ spec, desired = desiredActions, exclusions = EXCLUSIONS }) {
  const problems = [];
  const exposed = exposedOperationIds(spec);
  const selected = selectedOperationIds(desired);
  const excluded = new Set(n8nExclusions(exclusions).map((entry) => entry.operationId));
  for (const operationId of [...exposed].sort()) {
    if (selected.has(operationId) || excluded.has(operationId)) continue;
    problems.push(
      `n8n selection omits exposed operation ${operationId}: select it in desiredActions or record it in EXCLUSIONS with a reason.`,
    );
  }
  for (const operationId of [...excluded].sort()) {
    if (exposed.has(operationId)) continue;
    problems.push(
      `n8n has a stale exclusion for ${operationId}: no longer automation-exposed; remove the entry.`,
    );
  }
  return problems;
}

export function checkHandwrittenContracts({
  directory = root,
  openApi = path.join(directory, OPENAPI_PATH),
  sdkTypes = path.join(directory, SDK_TYPES_PATH),
  cliClient = path.join(directory, CLI_CLIENT_PATH),
  desired = desiredActions,
  exclusions = EXCLUSIONS,
} = {}) {
  const spec = JSON.parse(readFileSync(openApi, "utf8"));
  const schemas = loadSchemas(spec);
  const problems = [];
  const sdkSource = readFileSync(sdkTypes, "utf8");
  for (const { handType, schema } of SDK_PAIRS) {
    const schemaProps = schemas.get(schema);
    if (!schemaProps) throw new Error(`schema ${schema} missing from openapi.json`);
    problems.push(
      ...checkTypePair({
        artifact: `sdk:${handType}`,
        declared: parseSdkInterface(sdkSource, handType),
        tombstone: isTombstone,
        schemaProps,
        exclusions,
      }),
    );
  }
  const cliSource = readFileSync(cliClient, "utf8");
  for (const { handType, schema } of CLI_PAIRS) {
    const schemaProps = schemas.get(schema);
    if (!schemaProps) throw new Error(`schema ${schema} missing from openapi.json`);
    problems.push(
      ...checkTypePair({
        artifact: `cli:${handType}`,
        declared: parseGoStruct(cliSource, handType).map((name) => ({ name })),
        schemaProps,
        exclusions,
      }),
    );
  }
  problems.push(...checkN8nSelection({ spec, desired, exclusions }));
  return {
    problems,
    pairs: SDK_PAIRS.length + CLI_PAIRS.length,
    exposed: exposedOperationIds(spec).size,
  };
}

if (import.meta.main) {
  const { problems, pairs, exposed } = checkHandwrittenContracts();
  if (problems.length > 0) {
    console.error(problems.join("\n"));
    process.exit(1);
  }
  console.log(
    `Hand-written SDK, CLI, and n8n contracts match the served OpenAPI surface (${pairs} type pairs, ${exposed} exposed operations).`,
  );
}
