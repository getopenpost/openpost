import { readdirSync, readFileSync } from "node:fs";
import { extname, relative, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

import { parse } from "svelte/compiler";
import ts from "typescript";

const sourceRoots = ["frontend/src", "mobile/src"];
const sourceExtensions = new Set([".svelte", ".ts", ".tsx"]);
const webQueryAdapterPrefix = "frontend/src/lib/query/";
const mobileQueryAdapters = new Set([
  "mobile/src/lib/app-bootstrap.ts",
  "mobile/src/lib/query-api.ts",
]);

const effectHookNames = new Set(["$effect", "useEffect", "useLayoutEffect", "useFocusEffect"]);

const transportReadMethods = new Set(["GET", "POST", "PUT", "DELETE", "PATCH", "fetch"]);
const transportReadFunctions = new Set(["fetch", "apiURL"]);
const imperativeQueryMethods = new Set(["query", "fetchQuery", "prefetchQuery"]);

// Named exceptions for effect-driven reads. Additions require a reason so the
// render path stays declarative. Entries match file + read kind on purpose:
// the render path must never grow new effect-driven reads silently.
const effectReadAllowlist = [
  {
    file: "frontend/src/lib/video-editor/components/preview-layer.svelte",
    kind: "transport.fetch",
    reason:
      "local-first canvas asset load: lottie animation bytes for the preview frame, with disposal guard; not server state",
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

function isQueryAdapter(repoPath) {
  const isTest = /\.test\.[jt]sx?$/u.test(repoPath);
  return (
    !isTest && (repoPath.startsWith(webQueryAdapterPrefix) || mobileQueryAdapters.has(repoPath))
  );
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
  return segments.sort((left, right) => left.offset - right.offset);
}

function callableName(expression) {
  let current = expression;
  while (
    ts.isParenthesizedExpression(current) ||
    ts.isAsExpression(current) ||
    ts.isSatisfiesExpression(current) ||
    ts.isNonNullExpression(current)
  ) {
    current = current.expression;
  }
  if (ts.isIdentifier(current)) return { kind: "identifier", name: current.text };
  if (ts.isPropertyAccessExpression(current)) {
    return { kind: "property", name: current.name.text };
  }
  return null;
}

function isEffectHookCall(node) {
  if (!ts.isCallExpression(node)) return false;
  const target = callableName(node.expression);
  if (!target) return false;
  if (target.kind === "identifier") return effectHookNames.has(target.name);
  return target.name === "effect" || target.name === "$effect";
}

function readKindForCall(node) {
  if (!ts.isCallExpression(node)) return null;
  const target = callableName(node.expression);
  if (!target) return null;
  if (target.kind === "property") {
    if (transportReadMethods.has(target.name)) return `transport.${target.name}`;
    if (imperativeQueryMethods.has(target.name)) return `query.${target.name}`;
    return null;
  }
  if (transportReadFunctions.has(target.name)) return `transport.${target.name}`;
  return null;
}

function firstFunctionArgument(node) {
  for (const argument of node.arguments) {
    const unwrapped =
      ts.isParenthesizedExpression(argument) || ts.isAsExpression(argument)
        ? argument.expression
        : argument;
    if (
      ts.isArrowFunction(unwrapped) ||
      ts.isFunctionExpression(unwrapped) ||
      ts.isFunctionDeclaration(unwrapped)
    ) {
      return unwrapped;
    }
  }
  return null;
}

function readsInsideEffectBody(body, violations, context) {
  function visit(node, escaped) {
    if (
      !escaped &&
      (ts.isFunctionDeclaration(node) ||
        (ts.isFunctionExpression(node) && node.name) ||
        (ts.isVariableDeclaration(node) &&
          node.initializer &&
          (ts.isArrowFunction(node.initializer) || ts.isFunctionExpression(node.initializer)))) &&
      node !== body
    ) {
      escaped = true;
    }
    if (!escaped && ts.isCallExpression(node)) {
      const kind = readKindForCall(node);
      if (kind) {
        violations.push({ ...context, kind });
      }
    }
    ts.forEachChild(node, (child) => visit(child, escaped));
  }
  visit(body, false);
}

export function findEffectFetchViolations(repoRoot, { roots = sourceRoots } = {}) {
  const violations = [];
  for (const sourceRoot of roots) {
    const root = resolve(repoRoot, sourceRoot);
    for (const file of sourceFiles(root).sort()) {
      const repoPath = relative(repoRoot, file).replaceAll("\\", "/");
      if (isQueryAdapter(repoPath)) continue;
      if (/\.test\.[jt]sx?$/u.test(repoPath)) continue;
      const source = readFileSync(file, "utf8");
      for (const segment of scriptSegments(file, source)) {
        const sourceFile = ts.createSourceFile(
          file,
          segment.source,
          ts.ScriptTarget.Latest,
          true,
          file.endsWith(".tsx") ? ts.ScriptKind.TSX : ts.ScriptKind.TS,
        );
        function visit(node) {
          if (isEffectHookCall(node)) {
            const callback = firstFunctionArgument(node);
            if (callback?.body) {
              const index = segment.offset + node.getStart(sourceFile);
              readsInsideEffectBody(callback.body, violations, {
                file: repoPath,
                line: lineAt(source, index),
              });
            }
          }
          ts.forEachChild(node, visit);
        }
        visit(sourceFile);
      }
    }
  }
  const allowed = new Set(effectReadAllowlist.map((item) => `${item.file}\0${item.kind}`));
  return violations.filter((violation) => !allowed.has(`${violation.file}\0${violation.kind}`));
}

function main() {
  const repoRoot = resolve(fileURLToPath(new URL("..", import.meta.url)));
  const violations = findEffectFetchViolations(repoRoot);
  if (violations.length === 0) {
    process.stdout.write(
      "query-effects: no transport or imperative Query reads inside render-path effects\n",
    );
    return;
  }
  process.stderr.write(
    `query-effects: ${violations.length} effect-driven fetch reads outside Query adapters:\n`,
  );
  for (const violation of violations) {
    process.stderr.write(`- ${violation.file}:${violation.line} ${violation.kind}\n`);
  }
  process.exitCode = 1;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main();
}
