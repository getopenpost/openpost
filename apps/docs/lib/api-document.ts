import { resolveAndCopyReferences } from "@scalar/json-magic/bundle";
import type { Document, OperationItem } from "fumadocs-openapi";

/** Keep endpoint pages independent of unrelated schemas in the full API contract. */
export function operationDocument(document: Document, operations: OperationItem[]): Document {
  const result: Document = {
    ...document,
    paths: {},
    components: { securitySchemes: document.components?.securitySchemes },
    webhooks: undefined,
  };
  for (const { path } of operations) {
    const pointer = path.replaceAll("~", "~0").replaceAll("/", "~1");
    resolveAndCopyReferences(result, document, `/paths/${pointer}`, "x-ext", "", true);
  }
  return result;
}
