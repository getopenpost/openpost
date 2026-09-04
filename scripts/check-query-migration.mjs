import { readdirSync, readFileSync } from "node:fs";
import { extname, relative, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

import { parse } from "svelte/compiler";
import ts from "typescript";

const sourceRoots = ["frontend/src", "mobile/src"];
const sourceExtensions = new Set([".svelte", ".ts", ".tsx"]);
const rawFetchMutationMethods = new Set(["DELETE", "PATCH", "POST", "PUT"]);
const webQueryAdapterPrefix = "frontend/src/lib/query/";
const mobileQueryAdapters = new Set([
  "mobile/src/lib/app-bootstrap.ts",
  "mobile/src/lib/query-api.ts",
]);

const imperativeReadAllowlist = [
  {
    file: "frontend/src/lib/components/account-data-card.svelte",
    endpoint: "/auth/account/deletion-impact",
    count: 1,
    reason: "one-shot deletion-impact preview for the account delete confirmation",
  },
  {
    file: "frontend/src/lib/components/account-management.svelte",
    endpoint: "/accounts/{platform}/auth-url",
    count: 4,
    reason: "user-triggered OAuth connect URL fetch consumed immediately by the connect flow",
  },
  {
    file: "frontend/src/lib/components/compose-text-post.svelte",
    endpoint: "/publications/{id}",
    count: 2,
    reason:
      "event-driven handoff and draft-conflict reload consumed immediately by the editor session",
  },
  {
    file: "frontend/src/lib/components/compose-text-post.svelte",
    endpoint: "/posting-schedules/next-slot",
    count: 1,
    reason: "user-triggered schedule-slot lookup consumed immediately by the composer",
  },
  {
    file: "frontend/src/lib/media-upload-client.ts",
    endpoint: "/media/metadata",
    count: 1,
    reason: "bounded post-upload processing poll with caller-owned cancellation",
  },
  {
    file: "frontend/src/lib/post-builder/client.ts",
    endpoint: "/publication-builds/{id}",
    count: 1,
    reason: "bounded live build-status poll resumed from a persisted operation",
  },
  {
    file: "frontend/src/lib/telemetry.ts",
    endpoint: "/telemetry/config",
    count: 1,
    reason: "one-shot runtime initialization applied to the telemetry module",
  },
  {
    file: "mobile/src/app/publications/[id]/edit.tsx",
    endpoint: "/posting-schedules/next-slot",
    count: 2,
    reason: "user-triggered current-slot lookup consumed immediately by the editor mutation",
  },
  {
    file: "mobile/src/lib/server.ts",
    endpoint: "/ready",
    count: 1,
    reason: "one-shot probe of a candidate server before it becomes application state",
  },
  {
    file: "frontend/src/lib/components/organization-audit-settings.svelte",
    endpoint: "/admin/audit-events/export.json",
    count: 1,
    reason: "user-triggered audit export download, not render-path state",
  },
  {
    file: "frontend/src/lib/components/organization-audit-settings.svelte",
    endpoint: "/admin/audit-events/export.csv",
    count: 1,
    reason: "user-triggered audit export download, not render-path state",
  },
  {
    file: "frontend/src/lib/components/organization-audit-settings.svelte",
    endpoint: "/organizations/{id}/audit-events/export.json",
    count: 1,
    reason: "user-triggered audit export download, not render-path state",
  },
  {
    file: "frontend/src/lib/components/organization-audit-settings.svelte",
    endpoint: "/organizations/{id}/audit-events/export.csv",
    count: 1,
    reason: "user-triggered audit export download, not render-path state",
  },
  {
    file: "frontend/src/lib/components/organization-delete-dialog.svelte",
    endpoint: "/organizations/{id}/deletion-preview",
    count: 1,
    reason: "one-shot deletion preview for the organization delete confirmation",
  },
  {
    file: "frontend/src/lib/components/workspace-delete-dialog.svelte",
    endpoint: "/workspaces/{id}/deletion-preview",
    count: 1,
    reason: "one-shot deletion preview for the workspace delete confirmation",
  },
  {
    file: "frontend/src/routes/accounts/callback/accounts-callback-page.svelte",
    endpoint: "/accounts/selections/{connection_id}",
    count: 1,
    reason: "OAuth callback one-shot load of the pending selection before app state exists",
  },
  {
    file: "frontend/src/routes/checkout/+page.svelte",
    endpoint: "/billing/checkout/{attempt_id}",
    count: 1,
    reason: "checkout attempt lookup for the Paddle return flow, outside workspace state",
  },
  {
    file: "frontend/src/routes/checkout/+page.svelte",
    endpoint: "/billing/checkout/{attempt_id}/return",
    count: 1,
    reason: "checkout return handling for the Paddle return flow, outside workspace state",
  },
  {
    file: "frontend/src/routes/login/+page.svelte",
    endpoint: "/auth/oidc/discover",
    count: 1,
    reason: "OIDC discovery on login submit, before any session exists",
  },
  {
    file: "frontend/src/routes/ownership-transfer/+page.svelte",
    endpoint: "/organization-ownership-transfers/resolve",
    count: 1,
    reason: "transfer-token resolve from the invitation link, before workspace state exists",
  },
  {
    file: "frontend/src/routes/prompts/+page.svelte",
    endpoint: "/prompts/random",
    count: 1,
    reason: "user-triggered random prompt fetch for the prompt button",
  },
];

const pairingReadAllowlist = [
  {
    file: "frontend/src/routes/cli/authorize/cli-authorize-page.svelte",
    endpoint: "/cli/auth/session",
    count: 1,
    reason: "CLI pairing session poll, outside workspace query state",
  },
];

function sourceFiles(directory) {
  const files = [];
  for (const entry of readdirSync(directory, { withFileTypes: true })) {
    const path = resolve(directory, entry.name);
    if (entry.isDirectory()) {
      if (entry.name.startsWith(".")) continue;
      files.push(...sourceFiles(path));
      continue;
    }
    if (entry.isFile() && sourceExtensions.has(extname(entry.name))) files.push(path);
  }
  return files;
}

function lineAt(source, index) {
  return source.slice(0, index).split("\n").length;
}

function allowlistKey(file, endpoint) {
  return `${file}\0${endpoint}`;
}

function isQueryAdapter(repoPath) {
  const isTest = /\.test\.[jt]sx?$/u.test(repoPath);
  return (
    !isTest && (repoPath.startsWith(webQueryAdapterPrefix) || mobileQueryAdapters.has(repoPath))
  );
}

function directCentralBoundaryNames(sourceFile) {
  const names = new Set(["mobileQueryTransportRequest", "queryGET", "queryTransportRequest"]);

  function containsCentralBoundary(node, root) {
    let found = false;
    function visit(current) {
      if (found) return;
      if (current !== root && ts.isFunctionLike(current)) return;
      if (ts.isCallExpression(current)) {
        const expression = unwrapExpression(current.expression);
        if (ts.isIdentifier(expression) && names.has(expression.text)) {
          found = true;
          return;
        }
      }
      ts.forEachChild(current, visit);
    }
    visit(node);
    return found;
  }

  function visit(node) {
    if (
      ts.isFunctionDeclaration(node) &&
      node.name &&
      node.body &&
      containsCentralBoundary(node.body, node)
    ) {
      names.add(node.name.text);
    }
    if (
      ts.isVariableDeclaration(node) &&
      ts.isIdentifier(node.name) &&
      node.initializer &&
      ts.isFunctionLike(node.initializer) &&
      containsCentralBoundary(node.initializer, node.initializer)
    ) {
      names.add(node.name.text);
    }
    ts.forEachChild(node, visit);
  }

  visit(sourceFile);
  return names;
}

function isCentralizedQueryRead(node, boundaryNames) {
  let current = node.parent;
  while (current) {
    if (ts.isCallExpression(current)) {
      const expression = unwrapExpression(current.expression);
      if (ts.isIdentifier(expression) && boundaryNames.has(expression.text)) return true;
    }
    current = current.parent;
  }
  return false;
}

function scriptSegments(file, source) {
  if (!file.endsWith(".svelte")) return [{ offset: 0, source }];

  const parsed = parse(source, { filename: file, modern: true });
  const segments = [parsed.module, parsed.instance].flatMap((script) =>
    script
      ? [
          {
            offset: script.content.start,
            source: source.slice(script.content.start, script.content.end),
          },
        ]
      : [],
  );

  const visited = new WeakSet();
  function collectMarkupExpressions(value) {
    if (!value || typeof value !== "object" || visited.has(value)) return;
    visited.add(value);
    if (
      value !== parsed.fragment &&
      value.loc &&
      Number.isInteger(value.start) &&
      Number.isInteger(value.end)
    ) {
      segments.push({
        offset: value.start,
        source: source.slice(value.start, value.end),
      });
      return;
    }
    for (const child of Object.values(value)) {
      if (Array.isArray(child)) {
        for (const item of child) collectMarkupExpressions(item);
      } else {
        collectMarkupExpressions(child);
      }
    }
  }

  collectMarkupExpressions(parsed.fragment);
  return segments.sort((left, right) => left.offset - right.offset);
}

function unwrapExpression(expression) {
  let current = expression;
  while (
    ts.isParenthesizedExpression(current) ||
    ts.isAsExpression(current) ||
    ts.isTypeAssertionExpression(current) ||
    ts.isNonNullExpression(current) ||
    ts.isSatisfiesExpression(current)
  ) {
    current = current.expression;
  }
  return current;
}

function propertyName(expression) {
  const current = unwrapExpression(expression);
  if (ts.isPropertyAccessExpression(current)) return current.name.text;
  if (
    ts.isElementAccessExpression(current) &&
    current.argumentExpression &&
    (ts.isStringLiteral(current.argumentExpression) ||
      ts.isNoSubstitutionTemplateLiteral(current.argumentExpression))
  ) {
    return current.argumentExpression.text;
  }
  return null;
}

function callableName(expression) {
  const current = unwrapExpression(expression);
  return ts.isIdentifier(current) ? current.text : propertyName(current);
}

function isUpperGetReference(expression) {
  const current = unwrapExpression(expression);
  if (propertyName(current) === "GET") return true;
  if (!ts.isCallExpression(current) || propertyName(current.expression) !== "bind") return false;

  const bindTarget = unwrapExpression(current.expression);
  return ts.isPropertyAccessExpression(bindTarget) && isUpperGetReference(bindTarget.expression);
}

function isNativeFetchReference(expression) {
  const current = unwrapExpression(expression);
  if (ts.isIdentifier(current)) return current.text === "fetch";
  if (
    (ts.isPropertyAccessExpression(current) || ts.isElementAccessExpression(current)) &&
    propertyName(current) === "fetch"
  ) {
    const receiver = unwrapExpression(current.expression);
    return (
      ts.isIdentifier(receiver) &&
      (receiver.text === "globalThis" || receiver.text === "window" || receiver.text === "self")
    );
  }
  if (!ts.isCallExpression(current) || propertyName(current.expression) !== "bind") return false;

  const bindTarget = unwrapExpression(current.expression);
  return ts.isPropertyAccessExpression(bindTarget) && isNativeFetchReference(bindTarget.expression);
}

function collectSimpleAliases(sourceFile) {
  const typedGET = new Set();
  const rawFetch = new Set();

  function visit(node) {
    if (
      (ts.isVariableDeclaration(node) || ts.isParameter(node)) &&
      ts.isIdentifier(node.name) &&
      node.initializer
    ) {
      if (isUpperGetReference(node.initializer)) typedGET.add(node.name.text);
      if (isNativeFetchReference(node.initializer)) rawFetch.add(node.name.text);
    }
    if (
      ts.isBinaryExpression(node) &&
      node.operatorToken.kind === ts.SyntaxKind.EqualsToken &&
      ts.isIdentifier(node.left)
    ) {
      if (isUpperGetReference(node.right)) typedGET.add(node.left.text);
      if (isNativeFetchReference(node.right)) rawFetch.add(node.left.text);
    }
    ts.forEachChild(node, visit);
  }

  visit(sourceFile);
  return { rawFetch, typedGET };
}

function getCallKind(expression, aliases) {
  const current = unwrapExpression(expression);
  const name = propertyName(current);
  if (name === "GET") return "typed";
  if (name === "get") return "lowercase";
  if (isNativeFetchReference(current)) return "raw-fetch";
  if (!ts.isIdentifier(current)) return null;
  if (aliases.typedGET.has(current.text) || current.text === "GET") return "typed";
  if (aliases.rawFetch.has(current.text)) return "raw-fetch";
  if (current.text === "get") return "lowercase";
  return null;
}

function propertyAssignmentName(property) {
  if (!property.name) return null;
  if (ts.isIdentifier(property.name) || ts.isStringLiteral(property.name))
    return property.name.text;
  return null;
}

function rawFetchIsRead(call) {
  const init = call.arguments[1];
  if (!init) return true;
  const current = unwrapExpression(init);
  if (!ts.isObjectLiteralExpression(current)) return true;

  for (const property of [...current.properties].reverse()) {
    if (ts.isSpreadAssignment(property)) return true;

    const name = propertyAssignmentName(property);
    if (name === null) {
      if (property.name && ts.isComputedPropertyName(property.name)) return true;
      continue;
    }
    if (name !== "method") continue;
    if (!ts.isPropertyAssignment(property)) return true;

    const method = unwrapExpression(property.initializer);
    if (!ts.isStringLiteral(method) && !ts.isNoSubstitutionTemplateLiteral(method)) return true;
    return !rawFetchMutationMethods.has(method.text.toUpperCase());
  }
  return true;
}

function dynamicPlaceholder(expression) {
  const current = unwrapExpression(expression);
  if (ts.isIdentifier(current)) return current.text;
  if (ts.isPropertyAccessExpression(current)) return current.name.text;
  if (ts.isCallExpression(current) && current.arguments[0]) {
    return dynamicPlaceholder(current.arguments[0]);
  }
  return "dynamic";
}

function literalPathPattern(expression) {
  const current = unwrapExpression(expression);
  if (ts.isStringLiteral(current) || ts.isNoSubstitutionTemplateLiteral(current)) {
    return current.text;
  }
  if (!ts.isTemplateExpression(current)) return null;

  let value = current.head.text;
  for (const span of current.templateSpans) {
    value += `{${dynamicPlaceholder(span.expression)}}${span.literal.text}`;
  }
  return value;
}

function normalizeRawAPIEndpoint(path, acceptsAPIHelperPath) {
  let endpoint = path;
  if (!acceptsAPIHelperPath) {
    const apiPrefixIndex = endpoint.indexOf("/api/v1");
    if (apiPrefixIndex < 0) return null;
    const apiPath = endpoint.slice(apiPrefixIndex);
    if (apiPath !== "/api/v1" && !apiPath.startsWith("/api/v1/")) return null;
    endpoint = apiPath.slice("/api/v1".length) || "/";
  }
  endpoint = endpoint.split(/[?#]/u, 1)[0];
  return endpoint.startsWith("/") ? endpoint : null;
}

function rawFetchEndpoint(call) {
  if (!rawFetchIsRead(call)) return null;
  const resource = call.arguments[0];
  if (!resource) return null;
  const current = unwrapExpression(resource);
  if (ts.isCallExpression(current) && callableName(current.expression) === "apiURL") {
    const path = current.arguments[0] ? literalPathPattern(current.arguments[0]) : null;
    return path ? normalizeRawAPIEndpoint(path, true) : null;
  }
  const path = literalPathPattern(current);
  return path ? normalizeRawAPIEndpoint(path, false) : null;
}

function endpointForCall(call, kind) {
  if (kind === "raw-fetch") return rawFetchEndpoint(call);
  const argument = call.arguments[0];
  if (argument && (ts.isStringLiteral(argument) || ts.isNoSubstitutionTemplateLiteral(argument))) {
    return argument.text.startsWith("/") ? argument.text : null;
  }
  if (argument && ts.isTemplateExpression(argument)) {
    return argument.head.text.startsWith("/") ? "<dynamic>" : null;
  }
  return kind === "typed" ? "<dynamic>" : null;
}

function callsInSegment(file, repoPath, originalSource, segment, fileAliases) {
  const sourceFile = ts.createSourceFile(
    file,
    segment.source,
    ts.ScriptTarget.Latest,
    true,
    file.endsWith(".tsx") ? ts.ScriptKind.TSX : ts.ScriptKind.TS,
  );
  const aliases = collectSimpleAliases(sourceFile);
  for (const name of fileAliases.typedGET) aliases.typedGET.add(name);
  for (const name of fileAliases.rawFetch) aliases.rawFetch.add(name);
  const boundaryNames = directCentralBoundaryNames(sourceFile);
  const calls = [];

  function visit(node) {
    if (ts.isCallExpression(node)) {
      const kind = getCallKind(node.expression, aliases);
      if (kind) {
        const endpoint = endpointForCall(node, kind);
        if (endpoint) {
          const index = segment.offset + node.getStart(sourceFile);
          calls.push({
            file: repoPath,
            endpoint,
            line: lineAt(originalSource, index),
            centralized: isCentralizedQueryRead(node, boundaryNames),
          });
        }
      }
    }
    ts.forEachChild(node, visit);
  }

  visit(sourceFile);
  return calls;
}

function expectedCountMap(allowlist) {
  return new Map(
    allowlist.map(({ file, endpoint, count }) => [allowlistKey(file, endpoint), count]),
  );
}

function missingReads(allowlist, actualCounts) {
  return allowlist.flatMap(({ file, endpoint, count }) => {
    const actual = actualCounts.get(allowlistKey(file, endpoint)) ?? 0;
    return actual === count ? [] : [{ file, endpoint, expected: count, actual }];
  });
}

export function findImperativeQueryViolations(
  repoRoot,
  {
    roots = sourceRoots,
    allowlist = imperativeReadAllowlist,
    pairingAllowlist = pairingReadAllowlist,
  } = {},
) {
  const adapterCalls = [];
  const calls = [];
  for (const sourceRoot of roots) {
    const root = resolve(repoRoot, sourceRoot);
    for (const file of sourceFiles(root).sort()) {
      const repoPath = relative(repoRoot, file).replaceAll("\\", "/");
      if (repoPath.startsWith(webQueryAdapterPrefix) && /\.test\.[jt]sx?$/u.test(repoPath)) {
        continue;
      }
      const source = readFileSync(file, "utf8");
      const segments = scriptSegments(file, source);
      const fileAliases = { rawFetch: new Set(), typedGET: new Set() };
      for (const segment of segments) {
        const sourceFile = ts.createSourceFile(
          file,
          segment.source,
          ts.ScriptTarget.Latest,
          true,
          file.endsWith(".tsx") ? ts.ScriptKind.TSX : ts.ScriptKind.TS,
        );
        const aliases = collectSimpleAliases(sourceFile);
        for (const name of aliases.typedGET) fileAliases.typedGET.add(name);
        for (const name of aliases.rawFetch) fileAliases.rawFetch.add(name);
      }
      for (const segment of segments) {
        const segmentCalls = callsInSegment(file, repoPath, source, segment, fileAliases);
        if (isQueryAdapter(repoPath)) adapterCalls.push(...segmentCalls);
        else calls.push(...segmentCalls);
      }
    }
  }

  const expectedCounts = expectedCountMap(allowlist);
  const expectedPairingCounts = expectedCountMap(pairingAllowlist);
  const actualCounts = new Map();
  const violations = [];
  const pairingCalls = [];

  for (const call of calls) {
    const key = allowlistKey(call.file, call.endpoint);
    const actualCount = (actualCounts.get(key) ?? 0) + 1;
    actualCounts.set(key, actualCount);
    const expectedPairingCount = expectedPairingCounts.get(key) ?? 0;
    if (expectedPairingCount > 0) {
      pairingCalls.push(call);
      if (actualCount > expectedPairingCount) violations.push(call);
      continue;
    }
    if (actualCount > (expectedCounts.get(key) ?? 0)) violations.push(call);
  }

  return {
    adapterCalls,
    adapterViolations: adapterCalls.filter((call) => !call.centralized),
    calls,
    missing: missingReads(allowlist, actualCounts),
    pairingCalls,
    pairingMissing: missingReads(pairingAllowlist, actualCounts),
    violations,
  };
}

function printMissing(label, items) {
  if (items.length === 0) return;
  process.stderr.write(`query-migration: ${label} contract changed:\n`);
  for (const item of items) {
    process.stderr.write(
      `- ${item.file} ${item.endpoint}: expected ${item.expected}, found ${item.actual}\n`,
    );
  }
}

function main() {
  const repoRoot = resolve(fileURLToPath(new URL("..", import.meta.url)));
  const { adapterCalls, adapterViolations, missing, pairingCalls, pairingMissing, violations } =
    findImperativeQueryViolations(repoRoot);
  if (
    adapterViolations.length === 0 &&
    missing.length === 0 &&
    pairingMissing.length === 0 &&
    violations.length === 0
  ) {
    const imperativeCount = imperativeReadAllowlist.reduce((total, item) => total + item.count, 0);
    process.stdout.write(
      `query-migration: ${adapterCalls.length} Query adapter reads cross the central transport boundary; ${imperativeCount} intentional imperative app reads and ${pairingCalls.length} pairing read match their allowlists\n`,
    );
    return;
  }

  if (adapterViolations.length > 0) {
    process.stderr.write(
      `query-migration: ${adapterViolations.length} Query adapter reads bypass the central transport boundary:\n`,
    );
    for (const violation of adapterViolations) {
      process.stderr.write(`- ${violation.file}:${violation.line} ${violation.endpoint}\n`);
    }
  }

  if (violations.length > 0) {
    process.stderr.write(
      `query-migration: ${violations.length} cache-safe app reads still bypass the Query catalog:\n`,
    );
    for (const violation of violations) {
      process.stderr.write(`- ${violation.file}:${violation.line} ${violation.endpoint}\n`);
    }
  }
  printMissing("intentional imperative-read", missing);
  printMissing("pairing-read", pairingMissing);
  process.exitCode = 1;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main();
}
