import { describe, expect, test } from "bun:test";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

async function read(relativePath) {
  return readFile(path.join(root, relativePath), "utf8");
}

describe("complete UX program evidence", () => {
  test("the aggregate matrix retains every release cohort and presentation contract", async () => {
    const evidence = await read("docs/evidence/complete-ux-program-browser-matrix.md");

    for (const requiredEvidence of [
      "first-use-cohort.spec.ts",
      "daily-workflow-cohort.spec.ts",
      "collaboration-safety-cohort.spec.ts",
      "not-found.spec.ts",
      "load-recovery.spec.ts",
      "marketing.spec.ts",
      "docs-audience.spec.ts",
      "1280 px",
      "390 px",
      "320 px",
      "English",
      "Portuguese",
      "light",
      "dark",
      "keyboard",
      "focus",
      "announced",
      "overflow",
      "console",
      "serious and critical accessibility violations",
      "complete-ux-program-copy-review.md",
    ]) {
      expect(evidence).toContain(requiredEvidence);
    }

    const accessibility = await read("e2e-app/accessibility.ts");
    expect(accessibility).toContain("@axe-core/playwright");
    expect(accessibility).toContain('impact === "serious" || impact === "critical"');
  });

  test("every referenced browser or evidence file exists", async () => {
    const evidence = await read("docs/evidence/complete-ux-program-browser-matrix.md");
    const references = [
      ...evidence.matchAll(/`((?:e2e(?:-app|-docs)?|docs\/evidence)\/[^`]+\.(?:ts|md))`/gu),
    ].map((match) => match[1]);

    expect(references.length).toBeGreaterThan(10);
    for (const reference of new Set(references)) {
      await expect(Bun.file(path.join(root, reference)).exists()).resolves.toBe(true);
    }
  });

  test("the audit backlog contains only work left after the UX program", async () => {
    const audit = await read("AUDIT_REMEDIATION_TODO.md");
    const completedTasks = [
      "PROV-DELIVERY-001",
      "NOTIF-006",
      "COMM-001",
      "BILL-003",
      "ONB-001",
      "ADMIN-001",
      "ADMIN-002",
      "TEAM-002",
      "ARCH-002",
      "SIGNUP-001",
    ];

    for (const task of completedTasks) {
      expect(audit).not.toMatch(new RegExp(`^### ${task} —`, "mu"));
    }

    const taskHeadings = audit.match(/^### [A-Z0-9-]+ —/gmu) ?? [];
    expect(taskHeadings).toHaveLength(64);
    expect(audit).toContain("Inventory: **64 unfinished task headings**");
    expect(audit).toContain("External status infrastructure remains deferred");
  });
});
