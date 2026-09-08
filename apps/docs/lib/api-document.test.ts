import { expect, test } from "bun:test";
import { operationDocument } from "./api-document";
import type { Document } from "fumadocs-openapi";

test("endpoint documents preserve shared and recursive schemas without shipping unrelated endpoints", () => {
  const contract: Document = {
    openapi: "3.2.0",
    info: { title: "Example", version: "1" },
    servers: [{ url: "https://api.example.com" }],
    security: [{ bearer: [] }],
    paths: {
      "/people/{id}": {
        parameters: [{ $ref: "#/components/parameters/id" }],
        get: {
          responses: {
            "200": {
              description: "A person",
              content: { "application/json": { schema: { $ref: "#/components/schemas/Person" } } },
            },
          },
        },
      },
      "/unrelated": { get: { responses: { "204": { description: "No content" } } } },
    },
    components: {
      securitySchemes: { bearer: { type: "http", scheme: "bearer" } },
      parameters: { id: { name: "id", in: "path", required: true, schema: { type: "string" } } },
      schemas: {
        Person: {
          type: "object",
          properties: {
            name: { type: "string" },
            manager: { $ref: "#/components/schemas/Person" },
          },
        },
        Unrelated: { type: "object", properties: { large: { type: "string" } } },
      },
    },
  };
  const page = operationDocument(contract, [{ path: "/people/{id}", method: "get" }]);
  const serialized = JSON.parse(JSON.stringify(page));
  expect(serialized.components.schemas.Person.properties.name).toEqual({ type: "string" });
  expect(serialized.components.schemas.Person.properties.manager.$ref).toBe(
    "#/components/schemas/Person",
  );
  expect(serialized.components.parameters.id.required).toBe(true);
  expect(serialized.security).toEqual([{ bearer: [] }]);
  expect(serialized.components.securitySchemes.bearer.scheme).toBe("bearer");
  expect(serialized.components.schemas.Unrelated).toBeUndefined();
  expect(serialized.paths["/unrelated"]).toBeUndefined();
  expect(contract.paths?.["/unrelated"]).toBeDefined();
});
