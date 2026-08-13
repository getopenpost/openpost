import assert from "node:assert/strict";
import test from "node:test";

import {
  readCompatibilityInputs,
  requiredCompatibilityEntryIDs,
  validateCompatibilityRegistry,
} from "./compatibility-surfaces.mjs";

const clone = (value) => structuredClone(value);
const currentDate = new Date("2026-08-09T00:00:00Z");

function validationProblems(registry, openapi, now = currentDate) {
  return validateCompatibilityRegistry(registry, openapi, now);
}

function entryByID(registry, id) {
  return registry.entries.find((entry) => entry.id === id);
}

function removeOperation(openapi, operation) {
  delete openapi.paths[operation.path][operation.method.toLowerCase()];
  if (Object.keys(openapi.paths[operation.path]).length === 0) {
    delete openapi.paths[operation.path];
  }
}

function makeRemovalEligible(entry, openapi) {
  entry.status = "removed";
  entry.notice = {
    announced_on: "2026-01-01",
    announced_version: "v3.6.0",
    locations: [
      "CHANGELOG.md",
      "OpenAPI deprecated marker",
      "migration documentation",
    ],
  };
  entry.removal = {
    earliest_on: "2026-04-01",
    removal_version: "v3.8.0",
    stable_releases_elapsed: ["v3.7.0", "v3.8.0"],
  };
  entry.telemetry.observation_started_on = "2026-01-01";
  entry.telemetry.observation_ended_on = "2026-04-01";
  entry.telemetry.evidence = ["Ninety-day normalized route review export."];
  for (const consumer of Object.values(entry.telemetry.consumers)) {
    consumer.status = "no-use-observed";
    consumer.evidence = "No use in the bounded normalized route review.";
  }
  for (const operation of entry.operations) removeOperation(openapi, operation);
}

test("validates every current compatibility decision against OpenAPI", () => {
  const { registry, openapi } = readCompatibilityInputs();
  assert.deepEqual(validationProblems(registry, openapi), []);
  assert.deepEqual(
    registry.entries.map((entry) => entry.id).sort(),
    requiredCompatibilityEntryIDs,
  );
});

test("refuses to hide a required candidate by deleting its registry entry", () => {
  const { registry, openapi } = readCompatibilityInputs();
  registry.entries = registry.entries.filter(
    (entry) => entry.id !== "rest.posts.legacy-write",
  );
  assert.match(
    validationProblems(registry, openapi).join("\n"),
    /missing required compatibility entry rest\.posts\.legacy-write/u,
  );
});

test("refuses source removal while the registry still retains the operation", () => {
  const { registry, openapi } = readCompatibilityInputs();
  delete openapi.paths["/posts/schedule-overview"];
  assert.match(
    validationProblems(registry, openapi).join("\n"),
    /retained operation GET \/posts\/schedule-overview is absent from OpenAPI/u,
  );
});

test("refuses schema-member removal while its compatibility entry is retained", () => {
  const { registry, openapi } = readCompatibilityInputs();
  const entry = entryByID(registry, "schema.publications.intent-alias");
  const member = entry.schema_members[0];
  delete openapi.components.schemas[member.schema].properties[member.property];
  assert.match(
    validationProblems(registry, openapi).join("\n"),
    /retained schema member CreatePublicationBody\.intent is absent from OpenAPI/u,
  );
});

test("requires OpenAPI markers on deprecated schema members", () => {
  const { registry, openapi } = readCompatibilityInputs();
  const entry = entryByID(registry, "schema.workspaces.media-cleanup-days");
  const member = entry.schema_members[0];
  delete openapi.components.schemas[member.schema].properties[member.property]
    .deprecated;
  assert.match(
    validationProblems(registry, openapi).join("\n"),
    /deprecated schema member GetWorkspaceSettingsOutputBody\.media_cleanup_days lacks the OpenAPI deprecated marker/u,
  );
});

test("requires an OpenAPI marker and complete notice before deprecation", () => {
  const { registry, openapi } = readCompatibilityInputs();
  const entry = entryByID(registry, "rest.accounts.destination-options");
  entry.status = "deprecated";
  entry.notice.announced_on = "2026-08-09";
  entry.notice.announced_version = "v3.7.0";
  entry.removal.earliest_on = "2026-11-07";
  assert.match(
    validationProblems(registry, openapi).join("\n"),
    /deprecation notice is missing.*OpenAPI deprecated marker/u,
  );
  assert.match(
    validationProblems(registry, openapi).join("\n"),
    /lacks the OpenAPI deprecated marker/u,
  );
  assert.match(
    validationProblems(registry, openapi).join("\n"),
    /deprecation needs a telemetry observation start/u,
  );
});

test("accepts a documented deprecation while its observation remains open", () => {
  const { registry, openapi } = readCompatibilityInputs();
  const entry = entryByID(registry, "rest.accounts.destination-options");
  entry.status = "deprecated";
  entry.notice = {
    announced_on: "2026-08-09",
    announced_version: "v3.7.0",
    locations: [
      "CHANGELOG.md",
      "OpenAPI deprecated marker",
      "migration documentation",
    ],
  };
  entry.removal.earliest_on = "2026-11-07";
  entry.telemetry.observation_started_on = "2026-08-09";
  openapi.paths[entry.operations[0].path].get.deprecated = true;
  assert.deepEqual(validationProblems(registry, openapi), []);
});

test("blocks removal with known use or an incomplete observation window", () => {
  const { registry, openapi } = readCompatibilityInputs();
  const entry = entryByID(registry, "rest.accounts.destination-options");
  entry.status = "removed";
  entry.notice = {
    announced_on: "2026-01-01",
    announced_version: "v3.6.0",
    locations: [
      "CHANGELOG.md",
      "OpenAPI deprecated marker",
      "migration documentation",
    ],
  };
  entry.removal = {
    earliest_on: "2026-03-01",
    removal_version: "v3.7.0",
    stable_releases_elapsed: ["v3.7.0"],
  };
  removeOperation(openapi, entry.operations[0]);
  const problems = validationProblems(registry, openapi).join("\n");
  assert.match(problems, /earlier than the 90-day sunset/u);
  assert.match(problems, /needs 2 elapsed stable releases/u);
  assert.match(problems, /lacks no-use evidence for n8n/u);
  assert.match(problems, /needs a bounded telemetry observation/u);
});

test("accepts removal only after replacement, notices, releases, time, and no-use evidence", () => {
  const { registry, openapi } = readCompatibilityInputs();
  const entry = entryByID(registry, "rest.accounts.destination-options");
  makeRemovalEligible(entry, openapi);
  assert.deepEqual(validationProblems(registry, openapi), []);
});

test("refuses a removal date that has not arrived", () => {
  const { registry, openapi } = readCompatibilityInputs();
  const entry = entryByID(registry, "rest.accounts.destination-options");
  makeRemovalEligible(entry, openapi);
  entry.removal.earliest_on = "2027-01-01";
  assert.match(
    validationProblems(registry, openapi).join("\n"),
    /removal date has not arrived/u,
  );
});

test("accepts schema removal only after the same complete sunset gate", () => {
  const { registry, openapi } = readCompatibilityInputs();
  const entry = entryByID(registry, "schema.workspaces.media-cleanup-days");
  entry.status = "removed";
  entry.removal = {
    earliest_on: "2026-11-07",
    removal_version: "v3.2.0",
    stable_releases_elapsed: ["v3.1.0", "v3.2.0"],
  };
  entry.telemetry.observation_ended_on = "2026-11-07";
  entry.telemetry.evidence = ["Ninety-day normalized route review export."];
  for (const consumer of Object.values(entry.telemetry.consumers)) {
    consumer.status = "no-use-observed";
    consumer.evidence = "No use in the bounded normalized route review.";
  }
  for (const member of entry.schema_members) {
    delete openapi.components.schemas[member.schema].properties[
      member.property
    ];
  }
  assert.deepEqual(
    validationProblems(registry, openapi, new Date("2026-11-08T00:00:00Z")),
    [],
  );
});
