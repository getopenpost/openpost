#!/usr/bin/env node
/**
 * Reproducible production/test LoC counter for Video Editor vs FreeCut.
 * Matches docs/specs/freecut-depth-audit-followup.md scope:
 * - Production: .ts/.tsx/.svelte (.js/.mjs for scripts) excluding tests, stories, generated, docs
 * - Excludes FreeCut src/features/docs (in-app help) and generated types
 * - No inflation from docs/tests/generated
 *
 * Usage: node scripts/count-video-editor-loc.mjs [--json]
 */
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";

const root = join(import.meta.dirname, "..");

function walk(dir, out = []) {
  let entries;
  try {
    entries = readdirSync(dir);
  } catch {
    return out;
  }
  for (const name of entries) {
    const p = join(dir, name);
    let s;
    try {
      s = statSync(p);
    } catch {
      continue;
    }
    if (s.isDirectory()) walk(p, out);
    else out.push(p);
  }
  return out;
}

function isTestLike(path) {
  if (path.includes("__tests__")) return true;
  if (/\.test\./.test(path)) return true;
  if (/\.spec\./.test(path)) return true;
  if (/\.stories\./.test(path)) return true;
  if (path.includes("/test-helpers")) return true;
  return false;
}

function countLines(paths) {
  let total = 0;
  for (const p of paths) {
    try {
      const text = readFileSync(p, "utf8");
      total += text.split("\n").length;
    } catch {}
  }
  return total;
}

function freecutFiles() {
  const base = join(root, "references/freecut");
  if (!statSync(base, { throwIf: false })) return { prod: [], test: [] };
  const all = walk(base).filter((f) => /\.(ts|tsx)$/.test(f));
  const docsPrefix = join(base, "src/features/docs");
  const prod = [];
  const test = [];
  for (const f of all) {
    if (f.startsWith(docsPrefix)) continue;
    if (f.includes("/generated/")) continue;
    if (isTestLike(f)) test.push(f);
    else prod.push(f);
  }
  // Also include infrastructure/runtime/shared/types outside features but still production
  return { prod, test };
}

function openpostFiles() {
  const ve = join(root, "frontend/src/lib/video-editor");
  const qc = join(root, "frontend/src/lib/quick-cut");
  const pages = [
    join(root, "frontend/src/routes/video-editor"),
    join(root, "frontend/src/routes/quick-cut"),
    join(root, "frontend/src/routes/record"),
  ];
  const bases = [ve, qc, ...pages, join(root, "frontend/src/lib/video/stream-target.ts")].filter(
    (p) => {
      try {
        statSync(p);
        return true;
      } catch {
        return false;
      }
    },
  );
  // expand dirs
  const files = [];
  for (const base of bases) {
    const s = statSync(base);
    if (s.isDirectory()) walk(base, files);
    else files.push(base);
  }
  // filter to production-ish extensions
  const filtered = files.filter((f) => /\.(ts|tsx|svelte|js|mjs)$/.test(f));
  const prod = [];
  const test = [];
  for (const f of filtered) {
    if (isTestLike(f)) test.push(f);
    else if (f.includes("/generated/")) continue;
    else prod.push(f);
  }
  return { prod, test };
}

const fc = freecutFiles();
const op = openpostFiles();

const fcProd = countLines(fc.prod);
const fcTest = countLines(fc.test);
const opProd = countLines(op.prod);
const opTest = countLines(op.test);

const json = process.argv.includes("--json");
if (json) {
  console.log(
    JSON.stringify(
      {
        freecut: {
          prod: fcProd,
          test: fcTest,
          prodFiles: fc.prod.length,
          testFiles: fc.test.length,
        },
        openpost: {
          prod: opProd,
          test: opTest,
          prodFiles: op.prod.length,
          testFiles: op.test.length,
        },
        ratio: opProd / (fcProd || 1),
      },
      null,
      2,
    ),
  );
} else {
  console.log(
    `FreeCut production: ${fcProd} LoC in ${fc.prod.length} files (excl. src/features/docs)`,
  );
  console.log(`FreeCut tests:       ${fcTest} LoC in ${fc.test.length} files`);
  console.log(
    `OpenPost Video Editor+QuickCut production: ${opProd} LoC in ${op.prod.length} files`,
  );
  console.log(`OpenPost tests:      ${opTest} LoC in ${op.test.length} files`);
  console.log(
    `Ratio (OpenPost / FreeCut production): ${((opProd / (fcProd || 1)) * 100).toFixed(1)}%`,
  );
}
