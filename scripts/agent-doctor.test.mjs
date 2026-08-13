import { describe, expect, test } from "bun:test";
import { mkdir, mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  diagnoseLiveLabels,
  findMissingArtifacts,
  parseLiveLabels,
  parseTriageLabels,
} from "./agent-doctor.mjs";

const table = `
| Role | Tracker | Description | Color |
| --- | --- | --- | --- |
| \`needs-triage\` | \`triage\` | Needs review | \`fbca04\` |
| \`wontfix\` | \`wontfix\` | Will not be actioned | \`ffffff\` |
`;

describe("agent doctor local checks", () => {
  test("reports only missing fixture artifacts", async () => {
    const root = await mkdtemp(join(tmpdir(), "openpost-agent-doctor-"));
    await mkdir(join(root, "docs"), { recursive: true });
    await writeFile(join(root, "CONTEXT.md"), "fixture");
    expect(findMissingArtifacts(root, ["CONTEXT.md", "docs/map.md"])).toEqual([
      "docs/map.md",
    ]);
  });

  test("parses deterministic label configuration rows", () => {
    expect(parseTriageLabels(table)).toEqual([
      {
        role: "needs-triage",
        name: "triage",
        description: "Needs review",
        color: "fbca04",
      },
      {
        role: "wontfix",
        name: "wontfix",
        description: "Will not be actioned",
        color: "ffffff",
      },
    ]);
  });
});

describe("agent doctor live label diagnostics", () => {
  test("parses gh JSON without contacting GitHub", () => {
    expect(parseLiveLabels('[{"name":"wontfix"},{"name":"triage"}]')).toEqual(
      new Set(["wontfix", "triage"]),
    );
  });

  test("returns exact safe create commands for missing labels", () => {
    const configured = parseTriageLabels(table);
    expect(diagnoseLiveLabels(configured, new Set(["wontfix"]))).toEqual([
      {
        role: "needs-triage",
        name: "triage",
        description: "Needs review",
        color: "fbca04",
        command:
          "gh label create 'triage' --description 'Needs review' --color 'fbca04'",
      },
    ]);
  });
});
