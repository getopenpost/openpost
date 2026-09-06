import assert from "node:assert/strict";
import { execFileSync, spawnSync } from "node:child_process";
import {
  copyFileSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  renameSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";

const ci = readFileSync(".github/workflows/ci.yml", "utf8");
const release = readFileSync(".github/workflows/release.yml", "utf8");
const releaseScript = readFileSync("scripts/release.mjs", "utf8");
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

function workflowStepScript(workflow, jobName, stepName) {
  const job = workflowJob(workflow, jobName);
  const marker = `      - name: ${stepName}\n        run: |\n`;
  const start = job.indexOf(marker);
  assert.notEqual(start, -1, `workflow step ${stepName} must exist`);
  const remainder = job.slice(start + marker.length);
  const end = remainder.search(/^      - /mu);
  const indentedScript = end < 0 ? remainder : remainder.slice(0, end);
  return indentedScript
    .split("\n")
    .map((line) => line.slice(10))
    .join("\n");
}

function writeMobileIdentity(directory, version, versionCode) {
  writeFileSync(
    path.join(directory, "apps/mobile", "app.json"),
    `${JSON.stringify({ expo: { version, android: { versionCode } } })}\n`,
  );
  writeFileSync(
    path.join(directory, "apps/mobile", "package.json"),
    `${JSON.stringify({ name: "mobile", version })}\n`,
  );
}

test("only the candidate image job can write packages", () => {
  const image = workflowJob(ci, "image");
  assert.match(image, /permissions:\n\s+contents: read\n\s+packages: write/u);
  assert.equal(ci.match(/packages:\s*write/g)?.length, 1);
});

test("mobile identity advances during release preparation, not every main build", () => {
  assert.match(workflowJob(ci, "android"), /mobile-release\.mjs check-current/u);
  const releaseCandidate = workflowJob(release, "verify-candidate");
  assert.match(releaseCandidate, /mobile-release\.mjs check \\/u);
  assert.match(releaseCandidate, /git tag --list 'v\*' --sort=-v:refname/u);
  assert.match(releaseCandidate, /\[\[ "\$tag" != "\$GITHUB_REF_NAME" \]\]/u);
  assert.doesNotMatch(releaseCandidate, /GITHUB_SHA\^/u);
  assert.match(releaseScript, /prepareMobileReleaseFiles/u);
});

for (const legacyLayout of [false, true]) {
  test(`a second tag compares against the existing release tag (legacy layout: ${legacyLayout})`, () => {
    const directory = mkdtempSync(path.join(tmpdir(), "openpost-release-tags-"));
    try {
      mkdirSync(path.join(directory, "apps/mobile"), { recursive: true });
      mkdirSync(path.join(directory, "scripts"));
      copyFileSync(
        "scripts/mobile-release.mjs",
        path.join(directory, "scripts", "mobile-release.mjs"),
      );
      const git = (...args) => {
        const result = spawnSync("git", args, { cwd: directory, encoding: "utf8" });
        assert.equal(result.status, 0, result.stderr);
        return result.stdout.trim();
      };
      git("init");
      git("config", "user.email", "release-test@openpost.local");
      git("config", "user.name", "OpenPost Release Test");
      writeMobileIdentity(directory, "0.2.0", 2);
      git("add", ".");
      git("commit", "-m", "old release");
      git("tag", "v4.14.0");
      writeMobileIdentity(directory, "0.2.1", 3);
      git("add", ".");
      git("commit", "-m", "current release");
      if (legacyLayout) {
        git("mv", "apps/mobile", "mobile");
        git("commit", "--amend", "--no-edit");
      }
      git("tag", "v4.15.0");
      git("tag", "v4.15.1");
      assert.deepEqual(readdirSync(path.join(directory, ".git", "refs", "tags")).sort(), [
        "v4.14.0",
        "v4.15.0",
        "v4.15.1",
      ]);

      if (legacyLayout) {
        mkdirSync(path.join(directory, "apps"), { recursive: true });
        renameSync(path.join(directory, "mobile"), path.join(directory, "apps/mobile"));
      }
      const result = spawnSync(
        "bash",
        [
          "--noprofile",
          "--norc",
          "-e",
          "-o",
          "pipefail",
          "-c",
          workflowStepScript(release, "verify-candidate", "Require a new Android release identity"),
        ],
        {
          cwd: directory,
          encoding: "utf8",
          env: { ...process.env, GITHUB_REF_NAME: "v4.15.1" },
        },
      );
      assert.notEqual(result.status, 0);
      assert.equal(
        JSON.parse(readFileSync(path.join(directory, "previous-release-app.json"), "utf8")).expo
          .android.versionCode,
        3,
      );
    } finally {
      rmSync(directory, { recursive: true, force: true });
    }
  });
}

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

test("full release checks invoke only supported test scopes", () => {
  const releaseTestScopes = [
    ...releaseScript.matchAll(/run\(\["bun", "run", "test", "--", "([^"]+)"\]/gu),
  ].map((match) => match[1]);

  assert.ok(releaseTestScopes.length > 0);
  for (const scope of releaseTestScopes) {
    const result = spawnSync("bun", ["scripts/tasks.mjs", "test", scope, "--plan"], {
      encoding: "utf8",
    });
    assert.equal(result.status, 0, `unsupported release test scope ${scope}: ${result.stderr}`);
  }
});
