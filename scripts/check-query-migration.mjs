import { readdirSync, readFileSync } from "node:fs";
import { extname, relative, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

import { parse } from "svelte/compiler";
import ts from "typescript";

const sourceRoots = ["frontend/src"];
const sourceExtensions = new Set([".svelte", ".ts"]);
const queryAdapterPrefix = "frontend/src/lib/query/";

const imperativeReadAllowlist = [
  {
    file: "frontend/src/lib/components/account-data-card.svelte",
    endpoint: "/auth/account/deletion-impact",
    count: 1,
  },
  {
    file: "frontend/src/lib/components/account-management.svelte",
    endpoint: "/accounts/{platform}/auth-url",
    count: 4,
  },
  {
    file: "frontend/src/lib/components/compose-text-post.svelte",
    endpoint: "/publications/{id}",
    count: 2,
  },
  {
    file: "frontend/src/lib/components/compose-text-post.svelte",
    endpoint: "/posting-schedules/next-slot",
    count: 1,
  },
  {
    file: "frontend/src/lib/components/organization-audit-settings.svelte",
    endpoint: "/admin/audit-events/export.json",
    count: 1,
  },
  {
    file: "frontend/src/lib/components/organization-audit-settings.svelte",
    endpoint: "/admin/audit-events/export.csv",
    count: 1,
  },
  {
    file: "frontend/src/lib/components/organization-audit-settings.svelte",
    endpoint: "/organizations/{id}/audit-events/export.json",
    count: 1,
  },
  {
    file: "frontend/src/lib/components/organization-audit-settings.svelte",
    endpoint: "/organizations/{id}/audit-events/export.csv",
    count: 1,
  },
  {
    file: "frontend/src/lib/components/organization-delete-dialog.svelte",
    endpoint: "/organizations/{id}/deletion-preview",
    count: 1,
  },
  {
    file: "frontend/src/lib/components/workspace-delete-dialog.svelte",
    endpoint: "/workspaces/{id}/deletion-preview",
    count: 1,
  },
  {
    file: "frontend/src/routes/accounts/callback/accounts-callback-page.svelte",
    endpoint: "/accounts/selections/{connection_id}",
    count: 1,
  },
  {
    file: "frontend/src/routes/checkout/+page.svelte",
    endpoint: "/billing/checkout/{attempt_id}",
    count: 1,
  },
  {
    file: "frontend/src/routes/checkout/+page.svelte",
    endpoint: "/billing/checkout/{attempt_id}/return",
    count: 1,
  },
  {
    file: "frontend/src/routes/login/+page.svelte",
    endpoint: "/auth/oidc/discover",
    count: 1,
  },
  {
    file: "frontend/src/routes/ownership-transfer/+page.svelte",
    endpoint: "/organization-ownership-transfers/resolve",
    count: 1,
  },
  {
    file: "frontend/src/routes/prompts/+page.svelte",
    endpoint: "/prompts/random",
    count: 1,
  },
];

const pairingReadAllowlist = [
  {
    file: "frontend/src/routes/cli/authorize/cli-authorize-page.svelte",
    endpoint: "/cli/auth/session",
    count: 1,
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
  return repoPath.startsWith(queryAdapterPrefix) && !repoPath.endsWith(".test.ts");
}

function directCentralBoundaryNames(sourceFile) {
  const names = new Set(["queryGET", "queryTransportRequest"]);

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
  return [parsed.module, parsed.instance].flatMap((script) =>
    script
      ? [
          {
            offset: script.content.start,
            source: source.slice(script.content.start, script.content.end),
          },
        ]
      : [],
  );
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

function isUpperGetReference(expression) {
  const current = unwrapExpression(expression);
  if (propertyName(current) === "GET") return true;
  if (!ts.isCallExpression(current) || propertyName(current.expression) !== "bind") return false;

  const bindTarget = unwrapExpression(current.expression);
  return ts.isPropertyAccessExpression(bindTarget) && isUpperGetReference(bindTarget.expression);
}

function collectSimpleAliases(sourceFile) {
  const aliases = new Set();

  function visit(node) {
    if (
      ts.isVariableDeclaration(node) &&
      ts.isIdentifier(node.name) &&
      node.initializer &&
      isUpperGetReference(node.initializer)
    ) {
      aliases.add(node.name.text);
    }
    if (
      ts.isBinaryExpression(node) &&
      node.operatorToken.kind === ts.SyntaxKind.EqualsToken &&
      ts.isIdentifier(node.left) &&
      isUpperGetReference(node.right)
    ) {
      aliases.add(node.left.text);
    }
    ts.forEachChild(node, visit);
  }

  visit(sourceFile);
  return aliases;
}

function getCallKind(expression, aliases) {
  const current = unwrapExpression(expression);
  const name = propertyName(current);
  if (name === "GET") return "typed";
  if (name === "get") return "lowercase";
  if (!ts.isIdentifier(current)) return null;
  if (aliases.has(current.text) || current.text === "GET") return "typed";
  if (current.text === "get") return "lowercase";
  return null;
}

function endpointForCall(call, kind) {
  const argument = call.arguments[0];
  if (argument && (ts.isStringLiteral(argument) || ts.isNoSubstitutionTemplateLiteral(argument))) {
    return argument.text.startsWith("/") ? argument.text : null;
  }
  if (argument && ts.isTemplateExpression(argument)) {
    return argument.head.text.startsWith("/") ? "<dynamic>" : null;
  }
  return kind === "typed" ? "<dynamic>" : null;
}

function callsInSegment(file, repoPath, originalSource, segment) {
  const sourceFile = ts.createSourceFile(
    file,
    segment.source,
    ts.ScriptTarget.Latest,
    true,
    ts.ScriptKind.TS,
  );
  const aliases = collectSimpleAliases(sourceFile);
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
      if (repoPath.startsWith(queryAdapterPrefix) && repoPath.endsWith(".test.ts")) continue;
      const source = readFileSync(file, "utf8");
      for (const segment of scriptSegments(file, source)) {
        const segmentCalls = callsInSegment(file, repoPath, source, segment);
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
    if (expectedPairingCount > 0 && actualCount <= expectedPairingCount) {
      pairingCalls.push(call);
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
      `query-migration: ${adapterCalls.length} Query adapter reads cross the central transport boundary; ${imperativeCount} intentional imperative web reads and ${pairingCalls.length} pairing read match their allowlists\n`,
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
      `query-migration: ${violations.length} cache-safe web reads still bypass the Query catalog:\n`,
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
