import { test, expect } from "bun:test";
import { readFile } from "node:fs/promises";
const workflow = Bun.YAML.parse(
  await readFile(
    new URL("../../.github/workflows/public-site-delivery.yml", import.meta.url),
    "utf8",
  ),
);
test("delivery workflow is parseable, gated automatic deployment, and credentials stay in consumer", () => {
  expect(workflow.on.workflow_run.workflows).toEqual(["CI"]);
  expect(workflow.on.push.branches).toEqual(["main"]);
  expect(workflow.jobs.deploy.needs).toBe("qualify");
  expect(workflow.jobs.deploy.if).toContain("github.event_name == 'workflow_dispatch'");
  expect(workflow.jobs.deploy.environment).toContain("public-site-production");
  expect(JSON.stringify(workflow.jobs.qualify)).not.toContain("CLOUDFLARE_API_TOKEN");
  expect(JSON.stringify(workflow.jobs.deploy)).toContain("public-site-artifact.mjs verify");
  expect(JSON.stringify(workflow.jobs.qualify)).toContain("public-site-qualified-$SOURCE-");
  expect(workflow.jobs.deploy.if).toContain("OPENPOST_PUBLIC_SITE_DELIVERY_ENABLED");
});
test("no action floats and uploads preserve hidden agent discovery files", () => {
  for (const job of Object.values(workflow.jobs)) {
    for (const step of job.steps) {
      if (step.uses) expect(step.uses).toMatch(/@[a-f0-9]{40}$/);
      if (
        step.uses?.startsWith("actions/upload-artifact") &&
        step.with.name === "public-site-qualified"
      ) {
        expect(step.with["include-hidden-files"]).toBe(true);
        expect(step.with["if-no-files-found"]).toBe("error");
      }
    }
  }
});
