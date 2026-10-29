import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { load } from "js-yaml";

import { selectAttemptArtifact, waitForRunArtifact } from "./ci-artifacts.mjs";

test("selects the newest successful artifact attempt after partial reruns", () => {
  assert.equal(
    selectAttemptArtifact(
      [
        { name: "image-digest-revision-1", expired: false },
        { name: "frontend-public-revision-3", expired: false },
        { name: "image-digest-revision-2", expired: true },
      ],
      "image-digest-revision-",
    ),
    "image-digest-revision-1",
  );
  assert.equal(
    selectAttemptArtifact(
      [
        { name: "frontend-public-revision-1", expired: false },
        { name: "frontend-public-revision-3", expired: false },
      ],
      "frontend-public-revision-",
    ),
    "frontend-public-revision-3",
  );
});

test("rejects missing, malformed, expired, or ambiguous latest artifacts", () => {
  assert.throws(
    () =>
      selectAttemptArtifact(
        [
          { name: "image-digest-revision-0", expired: false },
          { name: "image-digest-revision-1", expired: true },
        ],
        "image-digest-revision-",
      ),
    /no current artifact/u,
  );
  assert.throws(
    () =>
      selectAttemptArtifact(
        [
          { name: "image-digest-revision-3", expired: false },
          { name: "image-digest-revision-3", expired: false },
        ],
        "image-digest-revision-",
      ),
    /not uniquely identified/u,
  );
});

test("image CI resolves the successful frontend artifact across attempts", () => {
  const workflow = readFileSync(new URL("../.github/workflows/ci.yml", import.meta.url), "utf8");
  const imageJob = load(workflow).jobs.image;
  const resolver = imageJob.steps.find((step) => step.run?.includes("ci-artifacts.mjs resolve"));
  assert.ok(resolver?.id, "the image job resolves its frontend artifact");
  assert.match(resolver.run, /--prefix "frontend-public-\$\{GITHUB_SHA\}-"/u);
  assert.match(resolver.run, /echo "name=\$\{artifact_name\}" >> "\$\{GITHUB_OUTPUT\}"/u);
  const downloads = imageJob.steps.filter((step) =>
    step.uses?.startsWith("actions/download-artifact@"),
  );
  assert.equal(downloads.length, 1);
  assert.equal(downloads[0].with.name, `\${{ steps.${resolver.id}.outputs.name }}`);
  assert.equal(downloads[0].with.path, "apps/server/cmd/openpost/public");
});

test("early browser preparation waits for a successful producer and fails closed", async () => {
  const options = {
    repository: "owner/repo",
    runId: 12,
    producer: "Frontend",
    prefix: "frontend-sha-",
    timeoutMs: 10,
  };
  let clock = 0;
  let calls = 0;
  let resolved = 0;
  const deps = {
    jobs: () =>
      ++calls === 1 ? [] : [{ name: "Frontend", status: "completed", conclusion: "success" }],
    now: () => clock,
    pause: async () => {
      clock += 5;
    },
    resolve: () => {
      resolved++;
      return "frontend-sha-1";
    },
  };
  assert.equal(await waitForRunArtifact(options, deps), "frontend-sha-1");
  assert.equal(calls, 2);
  assert.equal(resolved, 1);
  for (const conclusion of ["failure", "cancelled", "skipped"]) {
    await assert.rejects(
      waitForRunArtifact(options, {
        ...deps,
        jobs: () => [{ name: "Frontend", status: "completed", conclusion }],
      }),
      new RegExp(conclusion),
    );
  }
  clock = 0;
  await assert.rejects(waitForRunArtifact(options, { ...deps, jobs: () => [] }), /Timed out/);
  assert.equal(resolved, 1);
});

test("browser-only reruns reuse successful producers from earlier attempts", async () => {
  const resolved = [];
  const options = {
    repository: "getopenpost/openpost",
    runId: "123",
    prefix: "frontend-sha-",
    producer: "Canonical frontend build",
  };
  const result = await waitForRunArtifact(options, {
    jobs: () => [
      { name: options.producer, run_attempt: 1, status: "completed", conclusion: "success" },
      { name: "Application browser suite (1)", run_attempt: 2, status: "in_progress" },
    ],
    resolve: (option) => {
      resolved.push(option);
      return "frontend-sha-1";
    },
  });
  assert.equal(result, "frontend-sha-1");
  assert.equal(resolved.length, 1);
  await assert.rejects(
    waitForRunArtifact(options, {
      jobs: () => [
        { name: options.producer, run_attempt: 1, status: "completed", conclusion: "success" },
        { name: options.producer, run_attempt: 2, status: "completed", conclusion: "failure" },
      ],
      resolve: () => {
        throw Error("must not reuse older success after a producer failure");
      },
    }),
    /failure/u,
  );
});
