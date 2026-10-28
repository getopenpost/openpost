import { describe, expect, it } from "vitest";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import * as ts from "typescript";

// Contract parity: packages/sdk/src/types.ts is a hand-written mirror of the
// served OpenAPI contract in apps/web/openapi.json, and every resource casts
// parsed JSON to it, so a mismatch never fails the build. This test fails when
// a declared SDK field is absent from the matching components.schemas entry
// (an invented field a consumer can read but the API never sends), or when a
// required schema field is absent from the SDK type (a wire field the consumer
// cannot read). It reads only local checkout files, so it runs offline.

const SDK_TYPES = [
  { sdk: "EngagementItem", schema: "EngagementItem" },
  { sdk: "EngagementAttachment", schema: "EngagementAttachment" },
  { sdk: "EngagementSubject", schema: "EngagementSubject" },
  { sdk: "ReviewContext", schema: "ReviewContext" },
  { sdk: "ReviewReply", schema: "ReviewReply" },
  { sdk: "PostReference", schema: "PostReference" },
  { sdk: "EngagementPage", schema: "EngagementPage" },
  { sdk: "EngagementDetail", schema: "EngagementDetail" },
  { sdk: "EngagementSyncState", schema: "EngagementSyncState" },
  { sdk: "RefreshCapabilityOutcome", schema: "RefreshCapabilityOutcome" },

  { sdk: "PublicationSegmentInput", schema: "PublicationSegmentInput" },
  { sdk: "RenditionSegmentInput", schema: "RenditionSegmentInput" },
  { sdk: "RenditionSourceOverride", schema: "RenditionSourceOverride" },
  { sdk: "MentionTarget", schema: "MentionTarget" },
  { sdk: "MentionSpan", schema: "MentionSpan" },
  { sdk: "Mentions", schema: "Mentions" },
  { sdk: "MentionCandidate", schema: "MentionCandidate" },
  { sdk: "PrepareMediaImageInput", schema: "PrepareMediaImageBody" },

  { sdk: "SocialAccount", schema: "AccountResponse" },
  { sdk: "Publication", schema: "PublicationResponse" },
  { sdk: "Rendition", schema: "RenditionResponse" },
  { sdk: "Job", schema: "JobResponse" },
  { sdk: "Workspace", schema: "WorkspaceResponse" },
] as const;

// Stable optional contract fields the acceptance criteria require even though
// the schema does not mark them required.
const REQUIRED_OPTIONALS: Record<string, string[]> = {
  RenditionSegmentInput: ["source_overrides", "settings", "media_inherited", "media"],
  RenditionSourceOverride: ["mentions", "body_override"],
  Publication: ["segments", "media", "social_set_id", "creation_preset"],
  Rendition: [
    "target_key",
    "format_locked",
    "output_profile",
    "media",
    "segments",
    "schedule_override",
  ],
};

const HERE = path.dirname(fileURLToPath(import.meta.url));

function findFile(relative: string): string {
  const candidates = [
    path.resolve(HERE, relative),
    path.resolve(process.cwd(), relative),
    path.resolve(process.cwd(), "packages/sdk", relative),
  ];
  for (const candidate of candidates) {
    if (fs.existsSync(candidate)) return candidate;
  }
  throw new Error(
    `parity fixture missing, tried: ${candidates.join(", ")} (test runs offline against the local checkout)`,
  );
}

function openApiPath(): string {
  return findFile("../../../apps/web/openapi.json");
}

function sdkTypesPath(): string {
  return path.join(HERE, "types.ts");
}

interface SchemaInfo {
  properties: string[];
  required: string[];
}

function loadSchemas(): Map<string, SchemaInfo> {
  const raw = fs.readFileSync(openApiPath(), "utf8");
  const spec = JSON.parse(raw) as {
    components?: { schemas?: Record<string, unknown> };
  };
  const schemas = spec.components?.schemas;
  if (!schemas) throw new Error("openapi.json has no components.schemas");
  const out = new Map<string, SchemaInfo>();
  for (const [name, schema] of Object.entries(schemas)) {
    const typed = schema as { properties?: Record<string, unknown>; required?: unknown };
    out.set(name, {
      properties: Object.keys(typed.properties ?? {}),
      required: Array.isArray(typed.required)
        ? (typed.required as unknown[]).filter((r): r is string => typeof r === "string")
        : [],
    });
  }
  return out;
}

interface DeclaredProp {
  name: string;
  typeText: string;
  deprecated: boolean;
}

function loadDeclared(): Map<string, DeclaredProp[]> {
  const sourceText = fs.readFileSync(sdkTypesPath(), "utf8");
  const source = ts.createSourceFile("types.ts", sourceText, ts.ScriptTarget.Latest, true);
  const out = new Map<string, DeclaredProp[]>();
  for (const statement of source.statements) {
    if (!ts.isInterfaceDeclaration(statement)) continue;
    const name = statement.name.text;
    if (!SDK_TYPES.some((t) => t.sdk === name)) continue;
    const props: DeclaredProp[] = [];
    for (const member of statement.members) {
      if (!ts.isPropertySignature(member) || !member.type) continue;
      const propName = member.name.getText(source).replace(/^["']|["']$/g, "");
      const typeText = member.type.getText(source);
      const deprecated = ts.getJSDocTags(member).some((tag) => tag.tagName.text === "deprecated");
      props.push({ name: propName, typeText, deprecated });
    }
    out.set(name, props);
  }
  return out;
}

// Ask TypeScript for the public module names so re-exports and inline types
// have the same contract. Package typechecking validates their definitions.
function loadExportedNames(): Set<string> {
  const entry = path.join(HERE, "index.ts");
  const program = ts.createProgram([entry], {
    module: ts.ModuleKind.ESNext,
    moduleResolution: ts.ModuleResolutionKind.Bundler,
    noEmit: true,
    noLib: true,
    types: [],
  });
  const checker = program.getTypeChecker();
  const source = program.getSourceFile(entry);
  const symbol = source && checker.getSymbolAtLocation(source);
  if (!symbol) throw new Error("SDK index.ts must be a module");
  return new Set(checker.getExportsOfModule(symbol).map((entry) => entry.name));
}

// Phantom tombstones: a key the wire format never sends may stay declared only
// when it is documented deprecated and typed so no value can be read
// (never/undefined). Anything else declared-but-absent is an invented field.
function isTombstone(prop: DeclaredProp): boolean {
  if (!prop.deprecated) return false;
  const t = prop.typeText.trim();
  return t === "never" || t === "undefined" || t.includes("never");
}

describe("SDK wire-format parity", () => {
  it("declares no fields the wire schemas never send", () => {
    const schemas = loadSchemas();
    const declared = loadDeclared();
    const invented: string[] = [];
    for (const { sdk, schema } of SDK_TYPES) {
      const info = schemas.get(schema);
      if (!info) throw new Error(`schema ${schema} missing from openapi.json`);
      const props = declared.get(sdk) ?? [];
      for (const prop of props) {
        if (prop.name === "$schema") continue;
        if (!info.properties.includes(prop.name) && !isTombstone(prop)) {
          invented.push(`${sdk}.${prop.name} (absent from ${schema})`);
        }
      }
    }
    expect(invented, `invented SDK fields the API never sends: ${invented.join("; ")}`).toEqual([]);
  });

  it("declares every required wire field", () => {
    const schemas = loadSchemas();
    const declared = loadDeclared();
    const missing: string[] = [];
    for (const { sdk, schema } of SDK_TYPES) {
      const info = schemas.get(schema);
      if (!info) throw new Error(`schema ${schema} missing from openapi.json`);
      const names = new Set((declared.get(sdk) ?? []).map((p) => p.name));
      for (const required of info.required) {
        if (required === "$schema") continue;
        if (!names.has(required)) missing.push(`${sdk} omits required ${schema}.${required}`);
      }
      for (const optional of REQUIRED_OPTIONALS[sdk] ?? []) {
        if (!names.has(optional)) missing.push(`${sdk} omits stable contract field ${optional}`);
      }
    }
    expect(missing, `wire fields missing from SDK types: ${missing.join("; ")}`).toEqual([]);
  });

  it("keeps response type names exported and the published manifest dependency-free", () => {
    const exported = loadExportedNames();
    const absent = SDK_TYPES.map((t) => t.sdk).filter((name) => !exported.has(name));
    expect(absent, `index.ts no longer exports: ${absent.join("; ")}`).toEqual([]);
    const manifest = JSON.parse(fs.readFileSync(path.join(HERE, "..", "package.json"), "utf8")) as {
      dependencies?: Record<string, string>;
    };
    expect(
      Object.keys(manifest.dependencies ?? {}),
      "published SDK must stay free of runtime dependencies",
    ).toEqual([]);
  });
});
