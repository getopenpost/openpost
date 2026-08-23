import { describe, expect, test } from "bun:test";

import { buildSelectedContract } from "./generate-selected-automation-contract.mjs";

const baseOperation = (operationId, metadata, extra = {}) => ({
  operationId,
  summary: operationId,
  parameters: extra.parameters ?? [],
  responses: extra.responses ?? {
    200: {
      content: { "application/json": { schema: { type: "array", items: { type: "object" } } } },
    },
  },
  "x-openpost-automation": metadata,
  ...(extra.requestBody ? { requestBody: extra.requestBody } : {}),
});

const metadata = {
  access: "read",
  exposure: "alpha",
  effect: "query",
  retry: "transient",
  idempotency: "none",
};

describe("selected automation contract generator", () => {
  test("emits only exposed selected operations from the canonical OpenAPI", () => {
    const openapi = {
      openapi: "3.1.0",
      info: { title: "OpenPost", version: "test" },
      servers: [{ url: "/api/v1" }],
      paths: {
        "/workspaces": { get: baseOperation("list-workspaces", metadata) },
        "/jobs/{id}": { get: baseOperation("get-job", { ...metadata, exposure: "disabled" }) },
      },
    };

    const contract = buildSelectedContract(openapi, [
      {
        resource: "workspace",
        operation: "getMany",
        operationIDs: ["list-workspaces"],
        synthetic: false,
        fields: [],
      },
      {
        resource: "job",
        operation: "get",
        operationIDs: ["get-job"],
        synthetic: false,
        fields: [],
      },
    ]);

    expect(contract.actions.map((action) => action.primaryOperationID)).toEqual([
      "list-workspaces",
    ]);
    expect(contract.findings).toContainEqual(
      expect.objectContaining({ code: "operation-not-exposed", operation_id: "get-job" }),
    );
  });

  test("records cursor pagination metadata gaps instead of inventing API support", () => {
    const openapi = {
      openapi: "3.1.0",
      info: { title: "OpenPost", version: "test" },
      paths: {
        "/media": {
          get: baseOperation("list-media", {
            ...metadata,
            pagination: {
              style: "cursor",
              cursor_parameter: "cursor",
              next_cursor_header: "X-Next-Cursor",
              has_more_header: "X-Has-More",
            },
          }),
        },
      },
    };

    const contract = buildSelectedContract(openapi, [
      {
        resource: "media",
        operation: "getMany",
        operationIDs: ["list-media"],
        synthetic: false,
        fields: [],
      },
    ]);

    expect(contract.actions[0].pagination?.style).toBe("cursor");
    expect(contract.findings).toContainEqual(
      expect.objectContaining({
        code: "pagination-cursor-parameter-missing",
        operation_id: "list-media",
      }),
    );
  });
});
