import { defineRule } from "@oxlint/plugins";

import type { ESTree } from "@oxlint/plugins";

type RuntimeFunction = ESTree.ArrowFunctionExpression | ESTree.Function;

function isRuntimeFunction(node: ESTree.Node): node is RuntimeFunction {
  return (
    node.type === "ArrowFunctionExpression" ||
    node.type === "FunctionDeclaration" ||
    node.type === "FunctionExpression"
  );
}

const BOUNDARY_FUNCTION_PREFIXES = [
  "can",
  "detect",
  "directUploadSupported",
  "error",
  "format",
  "has",
  "is",
  "normalize",
  "parse",
  "problem",
  "read",
  "resolve",
  "safe",
  "supports",
  "valueAs",
];
const GLOBAL_CAPABILITY_NAMES = new Set([
  "AudioEncoder",
  "BroadcastChannel",
  "cancelAnimationFrame",
  "createImageBitmap",
  "document",
  "DOMParser",
  "IntersectionObserver",
  "MediaRecorder",
  "OffscreenCanvas",
  "VideoEncoder",
  "VideoFrame",
  "window",
  "Worker",
]);

function functionName(node: RuntimeFunction): string {
  if (node.type === "FunctionDeclaration") return node.id?.name ?? "";
  const parent = node.parent;
  if (parent.type === "VariableDeclarator" && parent.id.type === "Identifier")
    return parent.id.name;
  if (parent.type === "Property" && parent.key.type === "Identifier") return parent.key.name;
  if (parent.type === "MethodDefinition" && parent.key.type === "Identifier")
    return parent.key.name;
  return "";
}

function isInsideTypeGuard(node: ESTree.Node): boolean {
  let current: ESTree.Node | null = node.parent;
  while (current !== null && current.type !== "Program") {
    if (isRuntimeFunction(current)) {
      return current.returnType?.typeAnnotation.type === "TSTypePredicate";
    }
    current = current.parent;
  }
  return false;
}

function isInsideBoundaryFunction(node: ESTree.Node): boolean {
  let current: ESTree.Node | null = node.parent;
  while (current !== null && current.type !== "Program") {
    if (isRuntimeFunction(current)) {
      const name = functionName(current);
      return BOUNDARY_FUNCTION_PREFIXES.some((prefix) => name.startsWith(prefix));
    }
    current = current.parent;
  }
  return false;
}

function isGlobalCapabilityCheck(node: ESTree.UnaryExpression): boolean {
  return node.argument.type === "Identifier" && GLOBAL_CAPABILITY_NAMES.has(node.argument.name);
}

/** Disallow runtime typeof checks that narrow unparsed values instead of decoding them. */
export const noRuntimeTypeofRule = defineRule({
  meta: {
    type: "problem",
    docs: {
      description:
        "Disallow runtime typeof checks; external values must be decoded into meaningful types at their I/O boundary.",
    },
    messages: {
      runtimeTypeof:
        "A `typeof` check narrows a representation without establishing its contract. Parse input at its I/O boundary, then branch on the domain value.",
    },
    schema: [
      {
        type: "object",
        properties: {
          allowInTypeGuards: { type: "boolean" },
        },
        additionalProperties: false,
      },
    ],
    defaultOptions: [{ allowInTypeGuards: false }],
  },
  createOnce(context) {
    return {
      UnaryExpression(node) {
        const option = context.options?.[0];
        const allowInTypeGuards =
          typeof option === "object" &&
          option !== null &&
          !Array.isArray(option) &&
          option.allowInTypeGuards === true;
        if (node.operator !== "typeof") return;
        if (isGlobalCapabilityCheck(node) || isInsideBoundaryFunction(node)) return;
        if (allowInTypeGuards && isInsideTypeGuard(node)) return;
        context.report({ node, messageId: "runtimeTypeof" });
      },
    };
  },
});
