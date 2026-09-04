import { describe, expect, test } from "bun:test";
import { mkdir, mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { findMissingArtifacts, parseTriageLabels } from "./agent-doctor.mjs";

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
    await writeFile(join(root, "AGENTS.md"), "fixture");
    expect(findMissingArtifacts(root, ["AGENTS.md", "docs/map.md"])).toEqual(["docs/map.md"]);
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
