import { describe, expect, test } from "bun:test";
import { mkdir, mkdtemp, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { findMissingArtifacts, parseTriageLabels, main } from "./agent-doctor.mjs";

const table = `
| Role | Tracker | Description | Color |
| --- | --- | --- | --- |
| \`needs-triage\` | \`triage\` | Needs review | \`fbca04\` |
| \`wontfix\` | \`wontfix\` | Will not be actioned | \`ffffff\` |
`;

describe("agent doctor local checks", () => {
  test("accepts repo-owned workflow files without machine-managed skills", async () => {
    const root = await mkdtemp(join(tmpdir(), "openpost-agent-doctor-"));
    const errors = [];
    const output = {
      log() {},
      warn() {},
      error(message) {
        errors.push(message);
      },
    };
    try {
      for (const path of [
        "AGENTS.md",
        "docs/agents/repository-map.md",
        ".agents/skills/agent-workflow/SKILL.md",
      ]) {
        await mkdir(dirname(join(root, path)), { recursive: true });
        await writeFile(join(root, path), "fixture");
      }
      await writeFile(
        join(root, "docs/agents/triage-labels.md"),
        ["needs-triage", "needs-info", "ready-for-agent", "ready-for-human", "wontfix"]
          .map((name) => `| ${name} | ${name} | Description | fbca04 |`)
          .join("\n"),
      );
      expect(await main({ root, output })).toBe(0);
      expect(errors).toEqual([]);
      await rm(join(root, ".agents/skills/agent-workflow/SKILL.md"));
      expect(await main({ root, output })).toBe(1);
      expect(errors).toContain("  - .agents/skills/agent-workflow/SKILL.md");
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });
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
