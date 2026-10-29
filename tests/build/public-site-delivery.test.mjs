import { test, expect } from "bun:test";
import { readFile, mkdtemp, writeFile, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
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

test("deployment eligibility enforces availability, explicit manual delivery and automatic cutover", () => {
  const eligible = new Function(
    "needs",
    "github",
    "inputs",
    "vars",
    `return (${workflow.jobs.deploy.if});`,
  );
  for (const [available, event, delivery, enabled, expected] of [
    ["false", "workflow_dispatch", "production", "true", false],
    ["true", "workflow_dispatch", "retain", "true", false],
    ["true", "workflow_dispatch", "preview", "false", true],
    ["true", "workflow_dispatch", "production", "false", true],
    ["true", "workflow_run", "", "false", false],
    ["true", "workflow_run", "", "true", true],
    ["false", "push", "", "true", false],
    ["true", "push", "", "true", true],
  ])
    expect(
      eligible(
        { qualify: { outputs: { available } } },
        { event_name: event },
        { delivery },
        { OPENPOST_PUBLIC_SITE_DELIVERY_ENABLED: enabled },
      ),
    ).toBe(expected);
  const checkout = workflow.jobs.deploy.steps.find((step) =>
    step.uses?.startsWith("actions/checkout@"),
  );
  expect(checkout.with.ref).toBe("${{ needs.qualify.outputs.source }}");
});

test("delivery rejects a candidate outside main before executing repository helpers", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "public-source-guard-"));
  try {
    await writeFile(path.join(root, "git"), '#!/bin/sh\nexit "$ANCESTRY_STATUS"\n', {
      mode: 0o755,
    });
    const guard = workflow.jobs.qualify.steps.find((step) => step.env?.CANDIDATE);
    for (const [branch, source, status, expected] of [
      ["main", "a".repeat(40), "0", 0],
      ["v7.34.3", "a".repeat(40), "0", 0],
      ["feature", "a".repeat(40), "0", 1],
      ["v7.34.3-beta", "a".repeat(40), "0", 1],
      ["v7.34.3", "invalid", "0", 1],
      ["v7.34.3", "a".repeat(40), "1", 1],
    ]) {
      const result = Bun.spawnSync(["bash", "-c", guard.run], {
        env: {
          ...process.env,
          PATH: root + path.delimiter + process.env.PATH,
          CANDIDATE: source,
          PRODUCER_BRANCH: branch,
          ANCESTRY_STATUS: status,
        },
        stdout: "ignore",
        stderr: "ignore",
        timeout: 5000,
      });
      expect(result.exitCode).toBe(expected);
    }
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
test("stable tag qualification retains its public candidate when duplicate main work stops", async () => {
  expect(workflow.on.workflow_run.branches).toBeUndefined();
  const ci = Bun.YAML.parse(
    await readFile(new URL("../../.github/workflows/ci.yml", import.meta.url), "utf8"),
  );
  const producer = ci.jobs["public-build"].steps;
  for (const step of [
    producer.find((step) => step.name?.startsWith("Seal canonical")),
    producer.find((step) => step.with?.name?.startsWith("public-site-qualified-")),
  ]) {
    const eligible = new Function("github", "startsWith", "contains", `return (${step.if});`);
    for (const [event, ref, expected] of [
      ["push", "refs/heads/main", true],
      ["push", "refs/tags/v7.34.3", true],
      ["push", "refs/tags/v7.34.3-beta", false],
      ["pull_request", "refs/pull/491/merge", false],
    ])
      expect(
        eligible(
          { event_name: event, ref },
          (value, prefix) => value.startsWith(prefix),
          (value, part) => value.includes(part),
        ),
      ).toBe(expected);
  }
});
