import { readFileSync, readdirSync } from "node:fs";
import { extname, join, relative } from "node:path";
import { fileURLToPath } from "node:url";

const repositoryRoot = fileURLToPath(new URL("../", import.meta.url));
const inventoryPath = join(
  repositoryRoot,
  "packages/legal-policy/src/privacy-inventory.json",
);
const sourceRoots = [
  "frontend/src",
  "marketing-site/src",
  "marketing-site/functions",
  "docs-site/.vitepress",
  "backend/internal",
];
const sourceFiles = [
  "frontend/vite.config.ts",
  "marketing-site/vite.config.ts",
];
const sourceExtensions = new Set([
  ".go",
  ".html",
  ".js",
  ".mjs",
  ".svelte",
  ".ts",
]);

function isSourceFile(path) {
  const name = path.split("/").at(-1) ?? "";
  return (
    sourceExtensions.has(extname(path)) &&
    !name.endsWith(".d.ts") &&
    !name.endsWith("_test.go") &&
    !/(?:^|\.)(?:spec|test)\.[^.]+$/u.test(name) &&
    !path.includes("/.generated/") &&
    !path.includes("/.vitepress/cache/") &&
    !path.includes("/paraglide/")
  );
}

function walk(relativeRoot) {
  const absoluteRoot = join(repositoryRoot, relativeRoot);
  const results = [];
  for (const entry of readdirSync(absoluteRoot, { withFileTypes: true })) {
    const absolute = join(absoluteRoot, entry.name);
    if (entry.isDirectory()) {
      if ([".svelte-kit", "build", "dist", "node_modules"].includes(entry.name))
        continue;
      results.push(...walk(relative(repositoryRoot, absolute)));
    } else {
      const path = relative(repositoryRoot, absolute);
      if (isSourceFile(path)) results.push(path);
    }
  }
  return results;
}

function unescapeLiteral(value) {
  return value.replace(/\\([\\'"`])/gu, "$1");
}

function literalExpression(value) {
  const trimmed = value.trim();
  const quote = trimmed[0];
  if ((quote === '"' || quote === "'") && trimmed.at(-1) === quote) {
    return {
      identifier_kind: "exact",
      identifier: unescapeLiteral(trimmed.slice(1, -1)),
    };
  }
  return null;
}

function resolveTemplate(body, bindings) {
  let identifier = "";
  let cursor = 0;
  let dynamic = false;
  const interpolation = /\$\{([^}]+)\}/gu;
  for (const match of body.matchAll(interpolation)) {
    identifier += unescapeLiteral(body.slice(cursor, match.index));
    const expression = match[1].trim();
    const resolved = /^[A-Za-z_$][\w$]*$/u.test(expression)
      ? bindings.get(expression)
      : null;
    if (!resolved) {
      dynamic = true;
      break;
    }
    identifier += resolved.identifier;
    if (resolved.identifier_kind === "prefix") {
      dynamic = true;
      break;
    }
    cursor = match.index + match[0].length;
  }
  if (!dynamic) identifier += unescapeLiteral(body.slice(cursor));
  if (!identifier) return null;
  return {
    identifier_kind: dynamic ? "prefix" : "exact",
    identifier,
  };
}

function resolveExpression(value, bindings, functionReturns = new Map()) {
  const trimmed = value.trim();
  const literal = literalExpression(trimmed);
  if (literal) return literal;
  if (trimmed.startsWith("`") && trimmed.endsWith("`")) {
    return resolveTemplate(trimmed.slice(1, -1), bindings);
  }
  const functionCall = /^([A-Za-z_$][\w$]*)\(\)$/u.exec(trimmed);
  if (functionCall) return functionReturns.get(functionCall[1]) ?? null;
  if (/^[A-Za-z_$][\w$]*$/u.test(trimmed)) return bindings.get(trimmed) ?? null;
  return null;
}

function collectLocalBindings(source, seed = new Map()) {
  const bindings = new Map(seed);
  const declarations = [];
  const declarationPattern =
    /\b(?:export\s+)?const\s+([A-Za-z_$][\w$]*)\s*=\s*(`(?:\\.|[^`])*`|'(?:\\.|[^'])*'|"(?:\\.|[^"])*")/gu;
  for (const match of source.matchAll(declarationPattern)) {
    declarations.push([match[1], match[2]]);
  }
  const groupedConstants = /\bconst\s*\(([\s\S]*?)\)/gu;
  for (const group of source.matchAll(groupedConstants)) {
    const assignment =
      /^\s*([A-Za-z_$][\w$]*)\s*=\s*(`(?:\\.|[^`])*`|'(?:\\.|[^'])*'|"(?:\\.|[^"])*")/gmu;
    for (const match of group[1].matchAll(assignment)) {
      declarations.push([match[1], match[2]]);
    }
  }
  for (let pass = 0; pass < 3; pass += 1) {
    for (const [name, expression] of declarations) {
      const resolved = resolveExpression(expression, bindings);
      if (resolved) bindings.set(name, resolved);
    }
  }
  return bindings;
}

function collectFunctionReturns(source, bindings) {
  const returns = new Map();
  const pattern =
    /\bfunction\s+([A-Za-z_$][\w$]*)\s*\([^)]*\)(?:\s*:\s*[^\{]+)?\s*\{\s*return\s+(`(?:\\.|[^`])*`|'(?:\\.|[^'])*'|"(?:\\.|[^"])*")\s*;?\s*\}/gu;
  for (const match of source.matchAll(pattern)) {
    const resolved = resolveExpression(match[2], bindings);
    if (resolved) returns.set(match[1], resolved);
  }
  return returns;
}

export function collectGlobalBindings(sources) {
  const candidates = new Map();
  for (const { source } of sources) {
    const exportedNames = new Set(
      [...source.matchAll(/\bexport\s+const\s+([A-Za-z_$][\w$]*)\b/gu)].map(
        (match) => match[1],
      ),
    );
    for (const [name, value] of collectLocalBindings(source)) {
      if (!exportedNames.has(name)) continue;
      if (!candidates.has(name)) candidates.set(name, new Map());
      candidates
        .get(name)
        .set(`${value.identifier_kind}:${value.identifier}`, value);
    }
  }
  const globals = new Map();
  for (const [name, values] of candidates) {
    if (values.size === 1) globals.set(name, [...values.values()][0]);
  }
  return globals;
}

function collectImportedBindings(source, exportedBindings) {
  const imported = new Map();
  const imports = /\bimport\s*\{([\s\S]*?)\}\s*from\s*["'][^"']+["']/gu;
  for (const match of source.matchAll(imports)) {
    for (const rawSpecifier of match[1].split(",")) {
      const specifier = rawSpecifier.trim();
      if (!specifier || specifier.startsWith("type ")) continue;
      const binding =
        /^([A-Za-z_$][\w$]*)(?:\s+as\s+([A-Za-z_$][\w$]*))?$/u.exec(specifier);
      if (!binding) continue;
      const value = exportedBindings.get(binding[1]);
      if (value) imported.set(binding[2] ?? binding[1], value);
    }
  }
  return imported;
}

function addDiscovery(discoveries, file, technology, resolved, line = 1) {
  if (!resolved?.identifier) return;
  discoveries.push({ file, line, technology, ...resolved });
}

function lineAt(source, index) {
  return source.slice(0, index).split("\n").length;
}

function storageTechnology(receiver, source) {
  if (receiver.endsWith("localStorage")) return "localStorage";
  if (receiver.endsWith("sessionStorage")) return "sessionStorage";
  const hasLocal = /(?:globalThis\.|window\.)?localStorage/u.test(source);
  const hasSession = /(?:globalThis\.|window\.)?sessionStorage/u.test(source);
  if (hasLocal !== hasSession)
    return hasLocal ? "localStorage" : "sessionStorage";
  return null;
}

export function extractBrowserStorageIdentifiers(
  source,
  file = "fixture.ts",
  globalBindings = new Map(),
) {
  const discoveries = [];
  const bindings = collectLocalBindings(source, globalBindings);
  const functionReturns = collectFunctionReturns(source, bindings);
  const expression =
    "(`(?:\\\\.|[^`])*`|'(?:\\\\.|[^'])*'|\"(?:\\\\.|[^\"])*\"|[A-Za-z_$][\\w$]*(?:\\(\\))?)";

  const keyCall = new RegExp(
    `((?:(?:window|globalThis)\\.)?(?:localStorage|sessionStorage)|[A-Za-z_$][\\w$]*)\\s*\\.\\s*(?:getItem|setItem|removeItem)\\s*\\(\\s*${expression}`,
    "gu",
  );
  for (const match of source.matchAll(keyCall)) {
    const technology = storageTechnology(match[1], source);
    if (!technology) continue;
    addDiscovery(
      discoveries,
      file,
      technology,
      resolveExpression(match[2], bindings, functionReturns),
      lineAt(source, match.index),
    );
  }

  const typedCalls = [
    [
      "IndexedDB",
      new RegExp(`\\bindexedDB\\s*\\.\\s*open\\s*\\(\\s*${expression}`, "gu"),
    ],
    [
      "IndexedDB",
      new RegExp(`\\bcreateObjectStore\\s*\\(\\s*${expression}`, "gu"),
    ],
    [
      "Cache Storage",
      new RegExp(`\\bcaches\\s*\\.\\s*open\\s*\\(\\s*${expression}`, "gu"),
    ],
    ["OPFS", new RegExp(`\\bgetDirectoryHandle\\s*\\(\\s*${expression}`, "gu")],
  ];
  for (const [technology, pattern] of typedCalls) {
    for (const match of source.matchAll(pattern)) {
      addDiscovery(
        discoveries,
        file,
        technology,
        resolveExpression(match[1], bindings, functionReturns),
        lineAt(source, match.index),
      );
    }
  }

  const cacheName = new RegExp(`\\bcacheName\\s*:\\s*${expression}`, "gu");
  for (const match of source.matchAll(cacheName)) {
    addDiscovery(
      discoveries,
      file,
      "Cache Storage",
      resolveExpression(match[1], bindings, functionReturns),
      lineAt(source, match.index),
    );
  }

  const cookieAssignment = new RegExp(
    `\\bdocument\\s*\\.\\s*cookie\\s*=\\s*${expression}`,
    "gu",
  );
  for (const match of source.matchAll(cookieAssignment)) {
    const resolved = resolveExpression(match[1], bindings, functionReturns);
    if (!resolved) continue;
    const identifier = resolved.identifier.split("=", 1)[0];
    addDiscovery(
      discoveries,
      file,
      "cookie",
      { identifier_kind: "exact", identifier },
      lineAt(source, match.index),
    );
  }

  const goCookie = new RegExp(
    `\\bhttp\\s*\\.\\s*Cookie\\s*\\{[\\s\\S]{0,700}?\\bName\\s*:\\s*${expression}`,
    "gu",
  );
  for (const match of source.matchAll(goCookie)) {
    addDiscovery(
      discoveries,
      file,
      "cookie",
      resolveExpression(match[1], bindings, functionReturns),
      lineAt(source, match.index),
    );
  }

  const staticPrefixArray =
    /\b(?:export\s+)?const\s+([A-Z][A-Z0-9_]*(?:KEYS|PREFIXES))\s*=\s*\[([^\]]+)\]/gsu;
  for (const match of source.matchAll(staticPrefixArray)) {
    const technology = storageTechnology("storage", source);
    if (!technology) continue;
    const values = match[2].match(/'(?:\\.|[^'])*'|"(?:\\.|[^"])*"/gu) ?? [];
    for (const value of values) {
      const resolved = resolveExpression(value, bindings);
      addDiscovery(
        discoveries,
        file,
        technology,
        resolved && match[1].endsWith("PREFIXES")
          ? { ...resolved, identifier_kind: "prefix" }
          : resolved,
        lineAt(source, match.index),
      );
    }
  }

  const indexedDBStores =
    /\b(?:export\s+)?const\s+[A-Z][A-Z0-9_]*_STORES\s*=\s*\[([^\]]+)\]/gsu;
  for (const match of source.matchAll(indexedDBStores)) {
    const values = match[1].match(/'(?:\\.|[^'])*'|"(?:\\.|[^"])*"/gu) ?? [];
    for (const value of values) {
      addDiscovery(
        discoveries,
        file,
        "IndexedDB",
        resolveExpression(value, bindings),
        lineAt(source, match.index),
      );
    }
  }

  const unique = new Map();
  for (const discovery of discoveries) {
    unique.set(
      `${discovery.file}:${discovery.technology}:${discovery.identifier_kind}:${discovery.identifier}`,
      discovery,
    );
  }
  return [...unique.values()];
}

function inventoryCovers(discovery, entry) {
  if (entry.technology !== discovery.technology) return false;
  if (entry.identifier_kind === "exact") {
    return (
      discovery.identifier_kind === "exact" &&
      entry.identifier === discovery.identifier
    );
  }
  return discovery.identifier.startsWith(entry.identifier);
}

export function findUndocumentedIdentifiers(discoveries, inventoryEntries) {
  return discoveries.filter(
    (discovery) =>
      !inventoryEntries.some((entry) => inventoryCovers(discovery, entry)),
  );
}

export function checkBrowserStorageInventory(sources, inventoryEntries) {
  const exportedBindings = collectGlobalBindings(sources);
  const discoveries = sources.flatMap(({ file, source }) => {
    const importedBindings = collectImportedBindings(source, exportedBindings);
    return extractBrowserStorageIdentifiers(source, file, importedBindings);
  });
  return {
    discoveries,
    undocumented: findUndocumentedIdentifiers(discoveries, inventoryEntries),
  };
}

function main() {
  const files = [
    ...new Set([
      ...sourceRoots.flatMap(walk),
      ...sourceFiles.filter(isSourceFile),
    ]),
  ].sort();
  const sources = files.map((file) => ({
    file,
    source: readFileSync(join(repositoryRoot, file), "utf8"),
  }));
  const inventory = JSON.parse(readFileSync(inventoryPath, "utf8"));
  const { discoveries, undocumented } = checkBrowserStorageInventory(
    sources,
    inventory.browser_storage,
  );
  if (undocumented.length > 0) {
    console.error("Undocumented first-party browser storage identifiers:");
    for (const item of undocumented) {
      console.error(
        `- ${item.file}:${item.line} ${item.technology} ${item.identifier_kind} ${JSON.stringify(item.identifier)}`,
      );
    }
    console.error(
      "Add an exact or prefix entry to packages/legal-policy/src/privacy-inventory.json.",
    );
    process.exitCode = 1;
    return;
  }
  const patterns = new Set(
    discoveries.map(
      ({ technology, identifier_kind, identifier }) =>
        `${technology}:${identifier_kind}:${identifier}`,
    ),
  );
  console.log(
    `Browser storage inventory covers ${patterns.size} source-defined identifier patterns across ${discoveries.length} uses.`,
  );
}

if (import.meta.main) main();
