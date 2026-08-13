import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

export const repositoryRoot = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "..",
);

export const requiredCompatibilityEntryIDs = [
  "rest.accounts.destination-options",
  "rest.accounts.mastodon-servers",
  "rest.auth.oidc-logout",
  "rest.billing.dual-scope",
  "rest.organizations.discovery-team",
  "rest.posts.legacy-write",
  "rest.posts.schedule-overview",
  "rest.prompts",
  "schema.publications.intent-alias",
  "schema.workspaces.media-cleanup-days",
];

const stableVersionPattern = /^v\d+\.\d+\.\d+$/u;
const commitPattern = /^[a-f0-9]{40}$/u;
const datePattern = /^\d{4}-\d{2}-\d{2}$/u;
const allowedEntryStatuses = new Set(["retained", "deprecated", "removed"]);
const allowedEntryKinds = new Set(["rest", "schema"]);
const allowedReplacementStatuses = new Set(["none", "candidate", "available"]);
const allowedConsumerStatuses = new Set([
  "pending",
  "known-use",
  "reserved-use",
  "no-use-observed",
  "not-applicable",
]);
const allowedMethods = new Set(["DELETE", "GET", "PATCH", "POST", "PUT"]);

export function readCompatibilityInputs(root = repositoryRoot) {
  const readJSON = (file) =>
    JSON.parse(readFileSync(path.join(root, file), "utf8"));
  return {
    registry: readJSON("compatibility-surfaces.json"),
    openapi: readJSON("frontend/openapi.json"),
  };
}

function validDate(value) {
  if (typeof value !== "string" || !datePattern.test(value)) return false;
  const parsed = new Date(`${value}T00:00:00Z`);
  return (
    Number.isFinite(parsed.getTime()) &&
    parsed.toISOString().slice(0, 10) === value
  );
}

function dateAtUTC(value) {
  return new Date(`${value}T00:00:00Z`);
}

function addUTCDays(value, days) {
  const date = dateAtUTC(value);
  date.setUTCDate(date.getUTCDate() + days);
  return date;
}

function normalizedTelemetryPath(apiPath) {
  return `/api/v1${apiPath.replaceAll(/\{([^}]+)\}/gu, ":$1")}`;
}

function operationAt(openapi, operation) {
  return openapi.paths?.[operation.path]?.[operation.method.toLowerCase()];
}

function schemaPropertyAt(openapi, member) {
  return openapi.components?.schemas?.[member.schema]?.properties?.[
    member.property
  ];
}

function semverTuple(version) {
  const match = /^v(\d+)\.(\d+)\.(\d+)$/u.exec(version ?? "");
  return match ? match.slice(1).map(Number) : null;
}

function compareVersions(left, right) {
  const a = semverTuple(left);
  const b = semverTuple(right);
  if (!a || !b) return Number.NaN;
  for (let index = 0; index < a.length; index += 1) {
    if (a[index] !== b[index]) return a[index] - b[index];
  }
  return 0;
}

function validateRemovalGate(entry, policy, openapi, now, problems) {
  const label = entry.id;
  const notice = entry.notice ?? {};
  const removal = entry.removal ?? {};
  const replacement = entry.replacement ?? {};
  const telemetry = entry.telemetry ?? {};

  if (entry.status === "retained") {
    if (
      notice.announced_on !== null ||
      notice.announced_version !== null ||
      (notice.locations?.length ?? 0) !== 0
    ) {
      problems.push(`${label} is retained but carries a deprecation notice`);
    }
    if (removal.earliest_on !== null || removal.removal_version !== null) {
      problems.push(`${label} is retained but carries removal timing`);
    }
    return;
  }

  if (!validDate(notice.announced_on)) {
    problems.push(`${label} deprecation needs an ISO announcement date`);
  }
  if (!stableVersionPattern.test(notice.announced_version ?? "")) {
    problems.push(`${label} deprecation needs a stable announced version`);
  }
  const requiredNoticeChannels = new Set(policy.required_notice_channels ?? []);
  for (const location of notice.locations ?? []) {
    requiredNoticeChannels.delete(location);
  }
  if (requiredNoticeChannels.size > 0) {
    problems.push(
      `${label} deprecation notice is missing ${[...requiredNoticeChannels].join(", ")}`,
    );
  }
  if (replacement.status !== "available") {
    problems.push(
      `${label} cannot deprecate before its replacement is available`,
    );
  }
  if (!String(entry.migration_path ?? "").trim()) {
    problems.push(`${label} cannot deprecate without a migration path`);
  }
  if (!validDate(telemetry.observation_started_on)) {
    problems.push(`${label} deprecation needs a telemetry observation start`);
  } else if (
    validDate(notice.announced_on) &&
    dateAtUTC(telemetry.observation_started_on) > dateAtUTC(notice.announced_on)
  ) {
    problems.push(`${label} telemetry starts after its deprecation notice`);
  }
  for (const operation of entry.operations ?? []) {
    const openapiOperation = operationAt(openapi, operation);
    if (
      entry.status === "deprecated" &&
      openapiOperation?.deprecated !== true
    ) {
      problems.push(
        `${label} deprecated operation ${operation.operation_id} lacks the OpenAPI deprecated marker`,
      );
    }
  }
  for (const member of entry.schema_members ?? []) {
    const property = schemaPropertyAt(openapi, member);
    if (entry.status === "deprecated" && property?.deprecated !== true) {
      problems.push(
        `${label} deprecated schema member ${member.schema}.${member.property} lacks the OpenAPI deprecated marker`,
      );
    }
  }

  if (!validDate(removal.earliest_on)) {
    problems.push(`${label} needs an ISO earliest removal date`);
  } else if (validDate(notice.announced_on)) {
    const policyEarliest = addUTCDays(
      notice.announced_on,
      policy.minimum_sunset_days,
    );
    if (dateAtUTC(removal.earliest_on) < policyEarliest) {
      problems.push(
        `${label} removal date is earlier than the ${policy.minimum_sunset_days}-day sunset`,
      );
    }
  }

  if (entry.status === "deprecated") {
    if (removal.removal_version !== null) {
      problems.push(`${label} is not removed but has a removal version`);
    }
    return;
  }

  if (!stableVersionPattern.test(removal.removal_version ?? "")) {
    problems.push(`${label} removal needs a stable removal version`);
  }
  const elapsedReleases = removal.stable_releases_elapsed ?? [];
  if (elapsedReleases.length < policy.minimum_stable_releases) {
    problems.push(
      `${label} removal needs ${policy.minimum_stable_releases} elapsed stable releases`,
    );
  }
  let previousVersion = notice.announced_version;
  for (const version of elapsedReleases) {
    if (
      !stableVersionPattern.test(version) ||
      compareVersions(version, previousVersion) <= 0
    ) {
      problems.push(`${label} has an invalid stable release sequence`);
      break;
    }
    previousVersion = version;
  }
  if (
    stableVersionPattern.test(removal.removal_version ?? "") &&
    previousVersion &&
    compareVersions(removal.removal_version, previousVersion) < 0
  ) {
    problems.push(`${label} removal version predates its elapsed releases`);
  }
  if (validDate(removal.earliest_on) && now < dateAtUTC(removal.earliest_on)) {
    problems.push(`${label} removal date has not arrived`);
  }
  if (
    !validDate(telemetry.observation_started_on) ||
    !validDate(telemetry.observation_ended_on)
  ) {
    problems.push(`${label} removal needs a bounded telemetry observation`);
  } else {
    const minimumEnd = addUTCDays(
      telemetry.observation_started_on,
      policy.minimum_sunset_days,
    );
    if (dateAtUTC(telemetry.observation_ended_on) < minimumEnd) {
      problems.push(
        `${label} telemetry window is shorter than ${policy.minimum_sunset_days} days`,
      );
    }
  }
  if ((telemetry.evidence?.length ?? 0) === 0) {
    problems.push(`${label} removal needs recorded telemetry evidence`);
  }
  for (const consumerClass of policy.required_consumer_classes ?? []) {
    const consumer = telemetry.consumers?.[consumerClass];
    if (
      !consumer ||
      !["no-use-observed", "not-applicable"].includes(consumer.status) ||
      !String(consumer.evidence ?? "").trim()
    ) {
      problems.push(
        `${label} removal lacks no-use evidence for ${consumerClass}`,
      );
    }
  }
  for (const operation of entry.operations ?? []) {
    if (operationAt(openapi, operation)) {
      problems.push(
        `${label} is marked removed but ${operation.operation_id} remains in OpenAPI`,
      );
    }
  }
  for (const member of entry.schema_members ?? []) {
    if (schemaPropertyAt(openapi, member)) {
      problems.push(
        `${label} is marked removed but ${member.schema}.${member.property} remains in OpenAPI`,
      );
    }
  }
}

export function validateCompatibilityRegistry(
  registry,
  openapi,
  now = new Date(),
) {
  const problems = [];
  if (registry.schema_version !== 1) problems.push("schema_version must be 1");
  const policy = registry.policy ?? {};
  if (
    !Number.isInteger(policy.minimum_sunset_days) ||
    policy.minimum_sunset_days < 90
  ) {
    problems.push("minimum_sunset_days must be at least 90");
  }
  if (
    !Number.isInteger(policy.minimum_stable_releases) ||
    policy.minimum_stable_releases < 2
  ) {
    problems.push("minimum_stable_releases must be at least 2");
  }
  const requiredConsumers = policy.required_consumer_classes ?? [];
  if (
    new Set(requiredConsumers).size !== requiredConsumers.length ||
    requiredConsumers.length === 0
  ) {
    problems.push("required_consumer_classes must be a non-empty unique list");
  }

  const entries = registry.entries ?? [];
  const entriesByID = new Map();
  const operationIDs = new Set();
  const schemaMemberIDs = new Set();
  for (const entry of entries) {
    const label = entry.id ?? "unnamed compatibility entry";
    if (!/^[a-z][a-z0-9.-]+$/u.test(label)) {
      problems.push(`invalid compatibility entry id ${JSON.stringify(label)}`);
    }
    if (entriesByID.has(label))
      problems.push(`duplicate compatibility entry ${label}`);
    entriesByID.set(label, entry);
    if (!allowedEntryKinds.has(entry.kind)) {
      problems.push(`${label} has invalid kind ${JSON.stringify(entry.kind)}`);
    }
    if (!allowedEntryStatuses.has(entry.status)) {
      problems.push(
        `${label} has invalid status ${JSON.stringify(entry.status)}`,
      );
    }
    if (!String(entry.owner ?? "").trim())
      problems.push(`${label} needs an owner`);
    if (!String(entry.decision ?? "").trim()) {
      problems.push(`${label} needs a recorded decision`);
    }
    if (!String(entry.migration_path ?? "").trim()) {
      problems.push(`${label} needs a migration path`);
    }
    if (!allowedReplacementStatuses.has(entry.replacement?.status)) {
      problems.push(`${label} has an invalid replacement status`);
    }
    if (!String(entry.replacement?.notes ?? "").trim()) {
      problems.push(`${label} needs replacement notes`);
    }
    if (
      entry.kind === "rest" &&
      ((entry.operations?.length ?? 0) === 0 ||
        (entry.schema_members?.length ?? 0) !== 0)
    ) {
      problems.push(`${label} needs REST operations and no schema members`);
    }
    if (
      entry.kind === "schema" &&
      ((entry.schema_members?.length ?? 0) === 0 ||
        (entry.operations?.length ?? 0) !== 0)
    ) {
      problems.push(`${label} needs schema members and no REST operations`);
    }

    const expectedTelemetryPaths = new Set();
    for (const operation of entry.operations ?? []) {
      if (!allowedMethods.has(operation.method)) {
        problems.push(`${label} has invalid method ${operation.method}`);
      }
      if (!String(operation.path ?? "").startsWith("/")) {
        problems.push(`${label} has invalid operation path ${operation.path}`);
      }
      if (!String(operation.operation_id ?? "").trim()) {
        problems.push(`${label} operation is missing operation_id`);
      } else if (operationIDs.has(operation.operation_id)) {
        problems.push(`duplicate operation_id ${operation.operation_id}`);
      } else {
        operationIDs.add(operation.operation_id);
      }
      if (!stableVersionPattern.test(operation.introduced_version ?? "")) {
        problems.push(`${label} operation needs a stable introduced version`);
      }
      if (!commitPattern.test(operation.introduced_commit ?? "")) {
        problems.push(`${label} operation needs an exact introduced commit`);
      }
      expectedTelemetryPaths.add(normalizedTelemetryPath(operation.path));
      const openapiOperation = operationAt(openapi, operation);
      if (entry.status !== "removed") {
        if (!openapiOperation) {
          problems.push(
            `${label} retained operation ${operation.method} ${operation.path} is absent from OpenAPI`,
          );
        } else if (openapiOperation.operationId !== operation.operation_id) {
          problems.push(
            `${label} operation id drifted: expected ${operation.operation_id}, found ${openapiOperation.operationId}`,
          );
        }
      }
    }
    for (const member of entry.schema_members ?? []) {
      const memberID = `${member.schema}.${member.property}`;
      if (
        !String(member.schema ?? "").trim() ||
        !String(member.property ?? "").trim()
      ) {
        problems.push(`${label} has an invalid schema member`);
      } else if (schemaMemberIDs.has(memberID)) {
        problems.push(`duplicate schema member ${memberID}`);
      } else {
        schemaMemberIDs.add(memberID);
      }
      if (!stableVersionPattern.test(member.introduced_version ?? "")) {
        problems.push(
          `${label} schema member needs a stable introduced version`,
        );
      }
      if (!commitPattern.test(member.introduced_commit ?? "")) {
        problems.push(
          `${label} schema member needs an exact introduced commit`,
        );
      }
      const property = schemaPropertyAt(openapi, member);
      if (entry.status !== "removed" && !property) {
        problems.push(
          `${label} retained schema member ${memberID} is absent from OpenAPI`,
        );
      }
    }
    const actualTelemetryPaths = new Set(entry.telemetry?.route_patterns ?? []);
    if (actualTelemetryPaths.size === 0) {
      problems.push(`${label} needs at least one normalized telemetry route`);
    }
    for (const telemetryPath of expectedTelemetryPaths) {
      if (!actualTelemetryPaths.has(telemetryPath)) {
        problems.push(`${label} telemetry is missing ${telemetryPath}`);
      }
    }
    for (const consumerClass of requiredConsumers) {
      const consumer = entry.telemetry?.consumers?.[consumerClass];
      if (!consumer) {
        problems.push(`${label} is missing ${consumerClass} consumer review`);
        continue;
      }
      if (!allowedConsumerStatuses.has(consumer.status)) {
        problems.push(`${label} has invalid ${consumerClass} consumer status`);
      }
      if (
        consumer.status !== "pending" &&
        !String(consumer.evidence ?? "").trim()
      ) {
        problems.push(`${label} ${consumerClass} review needs evidence`);
      }
    }
    validateRemovalGate(entry, policy, openapi, now, problems);
  }

  for (const id of requiredCompatibilityEntryIDs) {
    if (!entriesByID.has(id))
      problems.push(`missing required compatibility entry ${id}`);
  }
  for (const id of entriesByID.keys()) {
    if (!requiredCompatibilityEntryIDs.includes(id)) {
      problems.push(`unregistered compatibility candidate ${id}`);
    }
  }
  return problems;
}

function main() {
  const { registry, openapi } = readCompatibilityInputs();
  const problems = validateCompatibilityRegistry(registry, openapi);
  if (problems.length > 0) {
    console.error(
      `Compatibility retirement check failed:\n${problems.map((problem) => `- ${problem}`).join("\n")}`,
    );
    process.exit(1);
  }
  const counts = Object.groupBy(registry.entries, (entry) => entry.status);
  console.log(
    `Compatibility registry is valid: ${registry.entries.length} entries (${counts.retained?.length ?? 0} retained, ${counts.deprecated?.length ?? 0} deprecated, ${counts.removed?.length ?? 0} removed).`,
  );
}

if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href
) {
  main();
}
