import { describe, expect, test } from "bun:test";
import { mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

import {
  checkHandwrittenContracts,
  checkN8nSelection,
  checkTypePair,
  exposedOperationIds,
  isTombstone,
  parseGoStruct,
  parseSdkInterface,
} from "./check-handwritten-contracts.mjs";

const scriptsDir = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(scriptsDir, "..");

const pair = (overrides = {}) => ({
  artifact: "sdk:Example",
  declared: [{ name: "id" }, { name: "title" }],
  schemaProps: ["id", "title"],
  ...overrides,
});

describe("hand-written contract field parity", () => {
  test("fails naming the artifact and field when a declared field is invented", () => {
    const problems = checkTypePair(
      pair({ declared: [{ name: "id" }, { name: "title" }, { name: "legacy_handle" }] }),
    );
    expect(problems).toHaveLength(1);
    expect(problems[0]).toContain("sdk:Example");
    expect(problems[0]).toContain("legacy_handle");
  });

  test("deprecated never-typed SDK tombstones are not invented fields", () => {
    expect(isTombstone({ deprecated: true, typeText: "never" })).toBe(true);
    expect(isTombstone({ deprecated: true, typeText: "string" })).toBe(false);
    expect(isTombstone({ deprecated: false, typeText: "never" })).toBe(false);
    const problems = checkTypePair(
      pair({
        declared: [
          { name: "id" },
          { name: "title" },
          { name: "username", typeText: "never", deprecated: true },
        ],
        tombstone: isTombstone,
      }),
    );
    expect(problems).toEqual([]);
  });
});

describe("Go struct reader", () => {
  test('reads json names, strips options, and skips json:"-"', () => {
    const source = [
      "type Widget struct {",
      '\tID string `json:"id"`',
      '\tLabel string `json:"label,omitempty"`',
      '\tInternal string `json:"-"`',
      "}",
    ].join("\n");
    expect(parseGoStruct(source, "Widget")).toEqual(["id", "label"]);
  });

  test("an untagged exported field is reported under its Go name", () => {
    const source = ["type Widget struct {", '\tID string `json:"id"`', "\tStray string", "}"].join(
      "\n",
    );
    expect(parseGoStruct(source, "Widget")).toEqual(["id", "Stray"]);
  });
});

describe("SDK interface reader", () => {
  test("reads declared properties with deprecation markers", () => {
    const source = [
      "export interface Widget {",
      "  id: string;",
      "  /** @deprecated gone */",
      "  legacy?: never;",
      "  [key: string]: unknown;",
      "}",
    ].join("\n");
    expect(parseSdkInterface(source, "Widget")).toEqual([
      { name: "id", typeText: "string", deprecated: false },
      { name: "legacy", typeText: "never", deprecated: true },
    ]);
  });
});

const exposed = (operationId) => ({
  operationId,
  "x-openpost-automation": {
    access: "read",
    exposure: "alpha",
    effect: "query",
    retry: "transient",
    idempotency: "none",
  },
});

describe("n8n selection coverage", () => {
  test("an exposed operation that is neither selected nor excluded fails", () => {
    const spec = { paths: { "/jobs": { get: exposed("list-jobs") } } };
    expect(exposedOperationIds(spec)).toContain("list-jobs");
    const problems = checkN8nSelection({ spec, desired: [], exclusions: [] });
    expect(problems.some((problem) => problem.includes("list-jobs"))).toBe(true);
  });

  test("an excluded operation passes, and a stale exclusion fails", () => {
    const spec = { paths: { "/jobs": { get: exposed("list-jobs") } } };
    const exclusions = [{ artifact: "n8n", operationId: "list-jobs", reason: "fixture scope" }];
    expect(checkN8nSelection({ spec, desired: [], exclusions })).toEqual([]);
    const stale = checkN8nSelection({ spec: { paths: {} }, desired: [], exclusions });
    expect(stale.some((problem) => problem.includes("list-jobs"))).toBe(true);
  });

  test("a field exclusion is honored, and a stale one fails", () => {
    const exclusions = [{ artifact: "sdk:Example", field: "revision", reason: "fixture scope" }];
    expect(checkTypePair(pair({ schemaProps: ["id", "title", "revision"], exclusions }))).toEqual(
      [],
    );
    const stale = checkTypePair(pair({ exclusions }));
    expect(stale.some((problem) => problem.includes("revision"))).toBe(true);
  });

  test("disabled operations need no selection or exclusion", () => {
    const spec = {
      paths: {
        "/internal": {
          get: { operationId: "hidden-op", "x-openpost-automation": { exposure: "disabled" } },
        },
        "/plain": { get: { operationId: "plain-op" } },
      },
    };
    expect(checkN8nSelection({ spec, desired: [], exclusions: [] })).toEqual([]);
  });
});

describe("hand-written contracts against the real checkout", () => {
  test("dropping one Rendition field from a scratch copy fails naming it", async () => {
    const fixture = await mkdtemp(path.join(tmpdir(), "handwritten-contracts-test-"));
    try {
      const realTypes = await readFile(path.join(repoRoot, "packages/sdk/src/types.ts"), "utf8");
      const marker = "export interface Rendition {";
      const start = realTypes.indexOf(marker);
      expect(start).toBeGreaterThan(-1);
      const end = realTypes.indexOf("\n}\n", start);
      const block = realTypes.slice(start, end);
      expect(block).toContain("\n  status: string;");
      const mutated =
        realTypes.slice(0, start) + block.replace("\n  status: string;", "") + realTypes.slice(end);
      const scratch = path.join(fixture, "types.ts");
      await writeFile(scratch, mutated);
      const { problems } = checkHandwrittenContracts({ directory: repoRoot, sdkTypes: scratch });
      expect(
        problems.some((problem) => problem.includes("sdk:Rendition") && problem.includes("status")),
      ).toBe(true);
    } finally {
      const { rm } = await import("node:fs/promises");
      await rm(fixture, { recursive: true, force: true });
    }
  });
});
