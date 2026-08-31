import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
import test from "node:test";

const ci = readFileSync(".github/workflows/ci.yml", "utf8");
const workflows = readdirSync(".github/workflows", { withFileTypes: true })
  .filter((entry) => entry.isFile() && /\.(?:ya?ml)$/u.test(entry.name))
  .map((entry) => ({
    name: entry.name,
    source: readFileSync(`.github/workflows/${entry.name}`, "utf8"),
  }));

function workflowJob(workflow, jobName) {
  const escapedName = jobName.replace(/[.*+?^${}()|[\]\\]/gu, "\\$&");
  const start = new RegExp(`^  ${escapedName}:\\s*$`, "mu").exec(workflow);
  assert.ok(start, `workflow job ${jobName} must exist`);
  const remainder = workflow.slice(start.index + start[0].length);
  const next = /^  [a-zA-Z0-9_-]+:\s*$/mu.exec(remainder);
  return workflow.slice(
    start.index,
    next ? start.index + start[0].length + next.index : workflow.length,
  );
}

test("only the candidate image job can write packages", () => {
  const image = workflowJob(ci, "image");
  assert.match(image, /permissions:\n\s+contents: read\n\s+packages: write/u);
  assert.equal(ci.match(/packages:\s*write/g)?.length, 1);
});

test("external workflow actions are pinned to immutable commits", () => {
  const actionLine = /^\s*(?:-\s+)?uses:\s+([^\s#]+)/gmu;
  let externalActions = 0;

  for (const workflow of workflows) {
    for (const match of workflow.source.matchAll(actionLine)) {
      const target = match[1];
      if (target.startsWith("./")) continue;
      externalActions += 1;
      assert.match(
        target,
        /^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+(?:\/[A-Za-z0-9_.\/-]+)?@[a-f0-9]{40}$/u,
        `${workflow.name} has a mutable action reference: ${target}`,
      );
    }
  }

  assert.ok(externalActions > 0);
});
