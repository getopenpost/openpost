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

test("check reports stale output without overwriting authored changes", async () => {
  const { mkdtemp, mkdir, copyFile, readFile, writeFile, symlink, rm } =
    await import("node:fs/promises");
  const { tmpdir } = await import("node:os");
  const path = await import("node:path");
  const { pathToFileURL, fileURLToPath } = await import("node:url");
  const sourceRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
  const fixtureRoot = await mkdtemp(path.join(tmpdir(), "selected-contract-test-"));
  try {
    await mkdir(path.join(fixtureRoot, "scripts"));
    const fixtureScript = path.join(
      fixtureRoot,
      "scripts/generate-selected-automation-contract.mjs",
    );
    await copyFile(
      path.join(sourceRoot, "scripts/generate-selected-automation-contract.mjs"),
      fixtureScript,
    );
    await symlink(
      path.join(sourceRoot, "node_modules"),
      path.join(fixtureRoot, "node_modules"),
      "dir",
    );
    const generator = await import(pathToFileURL(fixtureScript).href);
    const contract = generator.buildSelectedContract(
      { info: { version: "fixture" }, paths: {} },
      [],
    );
    await generator.writeSelectedContract(contract);
    expect(await generator.checkGeneratedContract(contract)).toEqual([]);
    const output = path.join(
      fixtureRoot,
      "packages/n8n-nodes-openpost/generated/selectedContract.ts",
    );
    const authored = (await readFile(output, "utf8")) + "\n// Concurrent authored change\n";
    await writeFile(output, authored);
    const stale = await generator.checkGeneratedContract(contract);
    expect(stale).toEqual(["packages/n8n-nodes-openpost/generated/selectedContract.ts"]);
    expect(await readFile(output, "utf8")).toBe(authored);
  } finally {
    await rm(fixtureRoot, { recursive: true, force: true });
  }
});
