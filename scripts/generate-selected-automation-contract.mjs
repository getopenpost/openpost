#!/usr/bin/env bun

import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdir, readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const generatedDirectory = path.join(root, "packages/n8n-nodes-openpost/generated");
const descriptionsDirectory = path.join(
  root,
  "packages/n8n-nodes-openpost/nodes/OpenPost/v1/descriptions/generated",
);
const actionsDirectory = path.join(
  root,
  "packages/n8n-nodes-openpost/nodes/OpenPost/v1/actions/generated",
);
const reportPath = path.join(root, "packages/n8n-nodes-openpost/docs/selected-contract-report.md");

export const desiredActions = [
  action("workspace", "getMany", "list-workspaces", { fields: [] }),
  action("account", "getMany", "list-accounts", {
    fields: [workspaceField()],
  }),
  action("account", "getDestinationOptions", "get-account-destination-options", {
    fields: [
      accountField(),
      stringField("regionCode", "Region Code", "Optional provider region code."),
      stringField("language", "Language", "Optional provider language code."),
    ],
  }),
  action("account", "getProviderReadiness", "get-provider-readiness", {
    fields: [workspaceField()],
  }),
  action("socialSet", "getMany", "list-social-sets", { fields: [workspaceField()] }),
  action("socialSet", "get", "get-social-set", { fields: [socialSetField()] }),
  action("postingSchedule", "getNextAvailableSlot", "get-next-available-slot", {
    fields: [workspaceField({ required: false })],
  }),
  action("media", "getMany", "list-media", {
    fields: [
      workspaceField(),
      stringField("search", "Search", "Filter by media title or filename."),
      numberField("limit", "Limit", "Maximum items to return.", 50),
    ],
  }),
  syntheticAction(
    "media",
    "uploadBinary",
    ["create-media-upload-session", "complete-media-upload-session"],
    {
      fields: [
        workspaceField(),
        stringField(
          "binaryPropertyName",
          "Binary Property",
          "Name of the input binary property to upload.",
          { default: "data", required: true },
        ),
        stringField("fileName", "File Name", "Override the binary filename."),
        stringField("mimeType", "MIME Type", "Override the binary MIME type."),
        stringField("altText", "Alt Text", "Alt text for accessibility."),
        optionsField(
          "retentionClass",
          "Retention Class",
          [
            ["Library", "library"],
            ["Temporary", "temporary"],
          ],
          "library",
        ),
        optionsField(
          "assetKind",
          "Asset Kind",
          [
            ["Library", "library"],
            ["Brand asset", "brand_asset"],
          ],
          "library",
        ),
      ],
    },
  ),
  action("publication", "getMany", "list-publications", {
    fields: [
      workspaceField(),
      stringField("status", "Status", "Optional publication status filter."),
      stringField("search", "Search", "Search title and source text."),
      numberField("limit", "Limit", "Maximum items to return.", 50),
    ],
  }),
  action("publication", "create", "create-publication", {
    fields: [
      workspaceField({ location: "body" }),
      stringField("title", "Title", "Internal publication title.", { required: true }),
      stringField("sourceText", "Source Text", "Canonical source text.", {
        type: "string",
        required: true,
        rows: 4,
      }),
      stringField(
        "contentProfile",
        "Content Profile",
        "Content profile saved with the Publication.",
        { default: "default", required: true },
      ),
      optionsField(
        "creationPreset",
        "Creation Preset",
        [
          ["Post", "post"],
          ["Thread", "thread"],
          ["Story", "story"],
          ["Short video", "short_video"],
          ["Video", "video"],
        ],
        "post",
      ),
      accountIdsField(),
      stringField("mediaIds", "Media IDs", "Comma-separated media IDs to attach in order."),
      stringField("sourceUrl", "Source URL", "Optional source URL."),
      stringField("scheduledAt", "Scheduled At", "Optional ISO date-time schedule."),
      numberField(
        "randomDelayMinutes",
        "Random Delay Minutes",
        "Optional random schedule delay in minutes.",
        undefined,
      ),
      jsonField(
        "advancedJson",
        "Advanced JSON",
        "Additional CreatePublicationBody fields. Native fields win over conflicting keys.",
      ),
    ],
  }),
  action("publication", "get", "get-publication", { fields: [publicationField()] }),
  action("publication", "update", "update-publication", {
    fields: [
      publicationField(),
      numberField(
        "expectedRevision",
        "Expected Revision",
        "Revision loaded before updating.",
        undefined,
        { required: true },
      ),
      stringField("title", "Title", "Internal publication title."),
      stringField("sourceText", "Source Text", "Canonical source text.", { rows: 4 }),
      stringField("scheduledAt", "Scheduled At", "Optional ISO date-time schedule."),
      jsonField(
        "advancedJson",
        "Advanced JSON",
        "Additional PublicationUpdateBody fields. Native fields win over conflicting keys.",
      ),
    ],
  }),
  action("publication", "setRenditions", "upsert-publication-renditions", {
    fields: [
      publicationField(),
      numberField(
        "expectedRevision",
        "Expected Revision",
        "Revision loaded before replacing renditions.",
        undefined,
        { required: true },
      ),
      jsonField("renditionsJson", "Renditions JSON", "Array of RenditionInput objects.", {
        required: true,
      }),
    ],
  }),
  action("publication", "validate", "validate-publication", { fields: [publicationField()] }),
  action("publication", "schedule", "schedule-publication", {
    fields: [
      publicationField(),
      numberField(
        "expectedRevision",
        "Expected Revision",
        "Revision saved before scheduling.",
        undefined,
        { required: true },
      ),
    ],
  }),
  action("publication", "cancel", "cancel-publication", {
    fields: [
      publicationField(),
      numberField(
        "expectedRevision",
        "Expected Revision",
        "Revision saved before canceling.",
        undefined,
        { required: true },
      ),
    ],
  }),
  action("publication", "publishNow", "publish-publication-now", {
    fields: [
      publicationField(),
      numberField(
        "expectedRevision",
        "Expected Revision",
        "Revision saved before publishing.",
        undefined,
        { required: true },
      ),
    ],
  }),
  action("publication", "retryFailedRenditions", "retry-failed-publication-renditions", {
    fields: [publicationField()],
  }),
  action("publication", "getEvents", "list-publication-events", {
    fields: [publicationField(), numberField("limit", "Limit", "Maximum events to return.", 50)],
  }),
  action("job", "get", "get-job", {
    fields: [stringField("jobId", "Job ID", "OpenPost Job ID.", { required: true })],
  }),
];

const resourceLabels = {
  workspace: "Workspace",
  account: "Account",
  socialSet: "Social Set",
  postingSchedule: "Posting Schedule",
  media: "Media",
  publication: "Publication",
  job: "Job",
};

const operationLabels = {
  get: "Get",
  getMany: "Get Many",
  getDestinationOptions: "Get Destination Options",
  getProviderReadiness: "Get Provider Readiness",
  getNextAvailableSlot: "Get Next Available Slot",
  uploadBinary: "Upload Binary",
  create: "Create",
  update: "Update",
  setRenditions: "Set Renditions",
  validate: "Validate",
  schedule: "Schedule",
  cancel: "Cancel",
  publishNow: "Publish Now",
  retryFailedRenditions: "Retry Failed Renditions",
  getEvents: "Get Events",
};

export async function loadOpenApi(openApiPath = path.join(root, "frontend/openapi.json")) {
  return JSON.parse(await readFile(openApiPath, "utf8"));
}

export function buildSelectedContract(openapi, desired = desiredActions) {
  const operationIndex = indexOpenApiOperations(openapi);
  const findings = [];
  const selected = [];

  for (const wanted of desired) {
    const sourceOperations = [];
    let unavailable = false;
    for (const operationID of wanted.operationIDs) {
      const operation = operationIndex.get(operationID);
      if (!operation) {
        findings.push({
          severity: "missing",
          code: "operation-not-in-openapi",
          operation_id: operationID,
          resource: wanted.resource,
          operation: wanted.operation,
          message: `${operationID} is not available in the canonical OpenAPI automation surface.`,
        });
        unavailable = true;
        continue;
      }
      const metadata = operation.operation["x-openpost-automation"];
      if (!metadata || metadata.exposure === "disabled") {
        findings.push({
          severity: "missing",
          code: "operation-not-exposed",
          operation_id: operationID,
          resource: wanted.resource,
          operation: wanted.operation,
          message: `${operationID} is present but not exposed to automation.`,
        });
        unavailable = true;
        continue;
      }
      sourceOperations.push(operation);
    }
    if (unavailable) continue;

    const primary = sourceOperations[0];
    const contractAction = {
      resource: wanted.resource,
      resourceLabel: resourceLabels[wanted.resource] ?? titleCase(wanted.resource),
      operation: wanted.operation,
      operationLabel: operationLabels[wanted.operation] ?? titleCase(wanted.operation),
      actionKey: `${wanted.resource}.${wanted.operation}`,
      synthetic: wanted.synthetic,
      operationIDs: wanted.operationIDs,
      primaryOperationID: wanted.operationIDs[0],
      method: primary.method.toUpperCase(),
      path: primary.path,
      summary: primary.operation.summary ?? "",
      automation: primary.operation["x-openpost-automation"],
      fields: wanted.fields,
      request: buildRequestContract(primary),
      pagination: buildPaginationContract(primary, findings),
      result: buildResultContract(primary, findings),
    };
    selected.push(contractAction);
    collectSelectorFindings(contractAction, findings);
  }

  const contract = {
    generatedAt: new Date(0).toISOString(),
    source: {
      title: openapi.info?.title ?? "OpenPost",
      version: openapi.info?.version ?? "",
      openapi: openapi.openapi,
      server: openapi.servers?.[0]?.url ?? "/api/v1",
    },
    checksum: "",
    actions: selected,
    findings,
  };
  contract.checksum = createHash("sha256")
    .update(stableJson({ actions: selected, findings }))
    .digest("hex");
  return contract;
}

export async function writeSelectedContract(contract) {
  await mkdir(generatedDirectory, { recursive: true });
  await mkdir(descriptionsDirectory, { recursive: true });
  await mkdir(actionsDirectory, { recursive: true });
  await mkdir(path.dirname(reportPath), { recursive: true });

  await Bun.write(
    path.join(generatedDirectory, "selectedContract.ts"),
    generatedFile(
      `export const selectedContract = ${stableJson(contract)} as const;\n\nexport type SelectedContract = typeof selectedContract;\nexport type SelectedAction = SelectedContract["actions"][number];\n`,
    ),
  );

  await Bun.write(
    path.join(descriptionsDirectory, "descriptions.ts"),
    generatedFile(
      `import type { INodeProperties } from "n8n-workflow";\n\nexport const generatedDescriptionProperties = ${stableJson(buildDescriptionProperties(contract))} satisfies INodeProperties[];\n`,
    ),
  );

  await Bun.write(
    path.join(actionsDirectory, "requestMappers.ts"),
    generatedFile(
      `export const generatedActionRequestMappers = ${stableJson(buildRequestMappers(contract))} as const;\n\nexport function findGeneratedAction(resource: string, operation: string) {\n\treturn generatedActionRequestMappers.find((action) => action.actionKey === resource + "." + operation);\n}\n`,
    ),
  );

  await Bun.write(reportPath, buildReport(contract));
  formatGeneratedFiles();
}

export async function checkGeneratedContract(contract) {
  const before = await generatedFileHashes();
  await writeSelectedContract(contract);
  const after = await generatedFileHashes();
  return [...after.keys()].filter((file) => before.get(file) !== after.get(file));
}

async function generatedFileHashes() {
  const entries = await Promise.all(
    outputFiles().map(async (file) => {
      let contents = "";
      try {
        contents = await readFile(file, "utf8");
      } catch (error) {
        if (error?.code !== "ENOENT") throw error;
      }
      return [path.relative(root, file), createHash("sha256").update(contents).digest("hex")];
    }),
  );
  return new Map(entries);
}

function outputFiles() {
  return [
    path.join(generatedDirectory, "selectedContract.ts"),
    path.join(descriptionsDirectory, "descriptions.ts"),
    path.join(actionsDirectory, "requestMappers.ts"),
    reportPath,
  ];
}

function formatGeneratedFiles() {
  const result = spawnSync("bunx", ["oxfmt", "--write", ...outputFiles()], {
    cwd: root,
    stdio: "inherit",
  });
  if (result.status !== 0) process.exit(result.status ?? 1);
}

function indexOpenApiOperations(openapi) {
  const index = new Map();
  for (const [operationPath, pathItem] of Object.entries(openapi.paths ?? {})) {
    for (const [method, operation] of Object.entries(pathItem ?? {})) {
      if (!operation?.operationId) continue;
      index.set(operation.operationId, { path: operationPath, method, operation });
    }
  }
  return index;
}

function buildRequestContract(source) {
  const parameters = (source.operation.parameters ?? []).map((parameter) => ({
    name: parameter.name,
    in: parameter.in,
    required: Boolean(parameter.required),
    type: schemaType(parameter.schema),
  }));
  const bodySchema = source.operation.requestBody?.content?.["application/json"]?.schema;
  return {
    parameters,
    bodySchemaRef: bodySchema?.$ref ?? "",
    bodyRequired: Boolean(source.operation.requestBody?.required),
  };
}

function buildPaginationContract(source, findings) {
  const metadata = source.operation["x-openpost-automation"];
  if (!metadata?.pagination) return null;
  const cursorParameter = metadata.pagination.cursor_parameter;
  const hasCursorParameter = (source.operation.parameters ?? []).some(
    (parameter) => parameter.in === "query" && parameter.name === cursorParameter,
  );
  if (cursorParameter && !hasCursorParameter) {
    findings.push({
      severity: "warning",
      code: "pagination-cursor-parameter-missing",
      operation_id: source.operation.operationId,
      message: `${source.operation.operationId} declares cursor pagination metadata but the OpenAPI operation has no ${cursorParameter} query parameter.`,
    });
  }
  return metadata.pagination;
}

function buildResultContract(source, findings) {
  const metadata = source.operation["x-openpost-automation"];
  if (metadata?.result) return metadata.result;
  const response =
    source.operation.responses?.["200"] ??
    source.operation.responses?.["201"] ??
    source.operation.responses?.["202"];
  const schema = response?.content?.["application/json"]?.schema;
  const inferred = inferResult(schema);
  if (inferred.body_path) {
    findings.push({
      severity: "warning",
      code: "result-extraction-metadata-missing",
      operation_id: source.operation.operationId,
      inferred_body_path: inferred.body_path,
      message: `${source.operation.operationId} needs result extraction metadata for wrapped response items.`,
    });
  }
  return inferred;
}

function inferResult(schema) {
  if (!schema) return {};
  if (Array.isArray(schema.type) && schema.type.includes("array")) return { body_path: "" };
  if (schema.type === "array") return { body_path: "" };
  const ref = schema.$ref ?? "";
  if (ref.endsWith("ListMediaOutputBody")) return { body_path: "media" };
  if (ref.endsWith("ActionOutputBody")) return { job_id_path: "job_id" };
  if (ref.endsWith("CreateMediaUploadSessionOutputBody")) return { id_path: "media_id" };
  if (ref.endsWith("MediaUploadResult")) return { id_path: "id" };
  return { id_path: "id" };
}

function collectSelectorFindings(contractAction, findings) {
  for (const field of contractAction.fields) {
    if (!field.selector) continue;
    const selectors = contractAction.automation?.selectors ?? [];
    const hasCatalogSelector = selectors.some((selector) => selector.parameter === field.apiName);
    if (!hasCatalogSelector) {
      findings.push({
        severity: "warning",
        code: "selector-metadata-missing",
        operation_id: contractAction.primaryOperationID,
        parameter: field.apiName,
        selector: field.selector,
        message: `${contractAction.primaryOperationID} relies on n8n presentation metadata for ${field.apiName}; the automation catalog does not provide a selector hint.`,
      });
    }
  }
}

function buildDescriptionProperties(contract) {
  const resources = unique(contract.actions.map((item) => item.resource)).map((resource) => ({
    name: resourceLabels[resource] ?? titleCase(resource),
    value: resource,
  }));
  const properties = [
    {
      displayName: "Resource",
      name: "resource",
      type: "options",
      noDataExpression: true,
      options: resources,
      default: resources[0]?.value ?? "workspace",
    },
  ];
  for (const resource of resources.map((item) => item.value)) {
    const operations = contract.actions
      .filter((item) => item.resource === resource)
      .map((item) => ({
        name: item.operationLabel,
        value: item.operation,
        action: `${item.operationLabel} ${resourceLabels[resource] ?? resource}`,
      }));
    properties.push({
      displayName: "Operation",
      name: "operation",
      type: "options",
      noDataExpression: true,
      displayOptions: { show: { resource: [resource] } },
      options: operations,
      default: operations[0]?.value,
    });
  }
  for (const contractAction of contract.actions) {
    for (const field of contractAction.fields) {
      properties.push(toNodeProperty(contractAction, field));
    }
    if (contractAction.automation?.idempotency === "required") {
      properties.push(idempotencyProperty(contractAction));
    }
  }
  return properties;
}

function toNodeProperty(contractAction, field) {
  const base = {
    displayName: field.displayName,
    name: field.name,
    type: field.nodeType,
    default: field.default ?? defaultForType(field.nodeType),
    required: field.required,
    description: field.description,
    displayOptions: {
      show: { resource: [contractAction.resource], operation: [contractAction.operation] },
    },
  };
  if (field.rows) base.typeOptions = { rows: field.rows };
  if (field.options) base.options = field.options.map(([name, value]) => ({ name, value }));
  if (field.selector) {
    base.type = "resourceLocator";
    base.modes = [
      {
        displayName: "From List",
        name: "list",
        type: "list",
        typeOptions: { searchListMethod: field.selector },
      },
      { displayName: "By ID", name: "id", type: "string" },
    ];
    base.default = { mode: "list", value: "" };
  }
  return base;
}

function idempotencyProperty(contractAction) {
  return {
    displayName: "Idempotency Key",
    name: "idempotencyKey",
    type: "string",
    default: "",
    placeholder: "Leave empty to use the n8n execution ID and item index",
    description: "Use a stable upstream event ID when retrying a write across workflow executions.",
    displayOptions: {
      show: { resource: [contractAction.resource], operation: [contractAction.operation] },
    },
  };
}

function buildRequestMappers(contract) {
  return contract.actions.map((action) => ({
    actionKey: action.actionKey,
    operationIDs: action.operationIDs,
    synthetic: action.synthetic,
    method: action.method,
    path: action.path,
    request: action.request,
    pagination: action.pagination,
    result: action.result,
    fields: action.fields.map((field) => ({
      name: field.name,
      apiName: field.apiName,
      location: field.location,
      body: field.body,
    })),
    retry: action.automation.retry,
    idempotency: action.automation.idempotency,
    effect: action.automation.effect,
  }));
}

function buildReport(contract) {
  const lines = [
    "# Selected OpenPost automation contract",
    "",
    "Generated from the canonical OpenAPI `x-openpost-automation` metadata.",
    "",
    `- Source version: ${contract.source.version || "unknown"}`,
    `- Actions emitted: ${contract.actions.length}`,
    `- Checksum: ${contract.checksum}`,
    "",
    "## Actions",
    "",
    "| Resource | Operation | OpenAPI operation | Effect | Retry | Idempotency |",
    "|---|---|---|---|---|---|",
  ];
  for (const action of contract.actions) {
    lines.push(
      `| ${action.resourceLabel} | ${action.operationLabel} | ${action.operationIDs.join(", ")} | ${action.automation.effect} | ${action.automation.retry} | ${action.automation.idempotency} |`,
    );
  }
  lines.push("", "## Findings", "");
  if (contract.findings.length === 0) {
    lines.push("No findings.");
  } else {
    for (const finding of contract.findings) {
      lines.push(`- ${finding.severity}: ${finding.code}: ${finding.message}`);
    }
  }
  lines.push("");
  return lines.join("\n");
}

function action(resource, operation, operationID, options = {}) {
  return {
    resource,
    operation,
    operationIDs: [operationID],
    synthetic: false,
    fields: options.fields ?? [],
  };
}

function syntheticAction(resource, operation, operationIDs, options = {}) {
  return {
    resource,
    operation,
    operationIDs,
    synthetic: true,
    fields: options.fields ?? [],
  };
}

function workspaceField(options = {}) {
  return field("workspaceId", "workspace_id", "Workspace", "Workspace ID.", {
    required: true,
    selector: "searchWorkspaces",
    ...options,
  });
}

function accountField(options = {}) {
  return field("accountId", "account_id", "Account", "Connected account ID.", {
    required: true,
    selector: "searchAccounts",
    location: "path",
    ...options,
  });
}

function publicationField(options = {}) {
  return field("publicationId", "id", "Publication", "Publication ID.", {
    required: true,
    selector: "searchPublications",
    location: "path",
    ...options,
  });
}

function socialSetField(options = {}) {
  return field("socialSetId", "id", "Social Set", "Social Set ID.", {
    required: true,
    selector: "searchSocialSets",
    location: "path",
    ...options,
  });
}

function accountIdsField() {
  return field(
    "accountIds",
    "social_account_ids",
    "Account IDs",
    "Comma-separated connected account IDs.",
    { location: "body" },
  );
}

function stringField(name, displayName, description, options = {}) {
  return field(name, snake(name), displayName, description, { nodeType: "string", ...options });
}

function numberField(name, displayName, description, defaultValue, options = {}) {
  return field(name, snake(name), displayName, description, {
    nodeType: "number",
    default: defaultValue,
    ...options,
  });
}

function optionsField(name, displayName, options, defaultValue) {
  return field(name, snake(name), displayName, `${displayName}.`, {
    nodeType: "options",
    options,
    default: defaultValue,
  });
}

function jsonField(name, displayName, description, options = {}) {
  return field(name, snake(name), displayName, description, {
    nodeType: "json",
    default: "{}",
    location: "body",
    ...options,
  });
}

function field(name, apiName, displayName, description, options = {}) {
  return {
    name,
    apiName,
    displayName,
    description,
    nodeType: options.nodeType ?? "string",
    default: options.default,
    required: Boolean(options.required),
    rows: options.rows,
    options: options.options,
    selector: options.selector,
    location: options.location ?? inferLocation(apiName),
    body: options.body ?? (options.location ?? inferLocation(apiName)) === "body",
  };
}

function inferLocation(apiName) {
  if (["id", "account_id"].includes(apiName)) return "path";
  if (
    [
      "workspace_id",
      "cursor",
      "limit",
      "offset",
      "search",
      "status",
      "region_code",
      "language",
    ].includes(apiName)
  )
    return "query";
  return "body";
}

function schemaType(schema) {
  if (!schema) return "unknown";
  if (Array.isArray(schema.type))
    return schema.type.filter((type) => type !== "null").join("|") || "unknown";
  return schema.type ?? (schema.$ref ? "object" : "unknown");
}

function titleCase(value) {
  return value
    .replace(/([A-Z])/g, " $1")
    .replace(/^./, (letter) => letter.toUpperCase())
    .trim();
}

function snake(value) {
  return value.replace(/[A-Z]/g, (letter) => `_${letter.toLowerCase()}`);
}

function unique(values) {
  return [...new Set(values)];
}

function defaultForType(type) {
  if (type === "number") return 0;
  if (type === "boolean") return false;
  if (type === "json") return "{}";
  return "";
}

function generatedFile(contents) {
  return `// Generated by scripts/generate-selected-automation-contract.mjs. Do not edit.\n${contents}`;
}

function stableJson(value) {
  return JSON.stringify(sortKeys(value), null, 2);
}

function sortKeys(value) {
  if (Array.isArray(value)) return value.map(sortKeys);
  if (!value || typeof value !== "object") return value;
  return Object.fromEntries(
    Object.keys(value)
      .sort()
      .map((key) => [key, sortKeys(value[key])]),
  );
}

if (import.meta.main) {
  const check = process.argv.includes("--check");
  const openapi = await loadOpenApi();
  const contract = buildSelectedContract(openapi);
  if (check) {
    const stale = await checkGeneratedContract(contract);
    if (stale.length > 0) {
      console.error(`Selected automation contract is stale: ${stale.join(", ")}`);
      process.exit(1);
    }
  } else {
    await writeSelectedContract(contract);
  }
}
