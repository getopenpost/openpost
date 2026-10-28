import assert from "node:assert/strict";
import test from "node:test";

import type { ESTree } from "@oxlint/plugins";
import { referencedAliasName } from "./type-references.ts";

function node(value: unknown): ESTree.TSType {
  return value as ESTree.TSType;
}

test("returns the name of a plain type reference", () => {
  assert.equal(
    referencedAliasName(
      node({ type: "TSTypeReference", typeName: { type: "Identifier", name: "Foo" } }),
    ),
    "Foo",
  );
});

test("rejects generic references and non-references", () => {
  assert.equal(
    referencedAliasName(
      node({
        type: "TSTypeReference",
        typeName: { type: "Identifier", name: "Box" },
        typeArguments: {
          type: "TSTypeParameterInstantiation",
          params: [{ type: "TSStringKeyword" }],
        },
      }),
    ),
    null,
  );
  assert.equal(referencedAliasName(node({ type: "TSStringKeyword" })), null);
  assert.equal(
    referencedAliasName(node({ type: "TSTypeReference", typeName: { type: "TSQualifiedName" } })),
    null,
  );
});
