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

test("producer API failures retry within the existing deadline", async () => {
  let clock = 0,
    calls = 0;
  const options = {
    repository: "getopenpost/openpost",
    runId: "123",
    prefix: "frontend-",
    producer: "Frontend",
    timeoutMs: 10,
  };
  const deps = {
    now: () => clock,
    pause: async (ms) => {
      clock += ms;
    },
    jobs: () => {
      if (++calls === 1) throw Error("temporary API error");
      return [{ name: "Frontend", status: "completed", conclusion: "success" }];
    },
    resolve: () => "frontend-1",
  };
  // Leave enough time for another poll after the first retry interval.
  assert.equal(await waitForRunArtifact({ ...options, timeoutMs: 30001 }, deps), "frontend-1");
  assert.equal(calls, 2);
  clock = 0;
  await assert.rejects(
    waitForRunArtifact(options, {
      ...deps,
      jobs: () => {
        throw Error("persistent API error");
      },
    }),
    /Timed out.*persistent API error/u,
  );
});

test("a newer producer attempt must finish before an older success can resolve", async () => {
  let complete = false,
    resolved = 0,
    pauses = 0;
  const options = {
    repository: "getopenpost/openpost",
    runId: "123",
    prefix: "frontend-",
    producer: "Frontend",
  };
  const result = await waitForRunArtifact(options, {
    jobs: () => [
      { name: "Frontend", run_attempt: 1, status: "completed", conclusion: "success" },
      {
        name: "Frontend",
        run_attempt: 2,
        status: complete ? "completed" : "in_progress",
        conclusion: complete ? "success" : null,
      },
    ],
    pause: async () => {
      assert.equal(resolved, 0);
      pauses++;
      complete = true;
    },
    resolve: () => {
      assert.equal(complete, true);
      resolved++;
      return "frontend-2";
    },
  });
  assert.equal(result, "frontend-2");
  assert.equal(pauses, 1);
  assert.equal(resolved, 1);
});

test("consecutive producer API errors fail early and successful polls reset the limit", async () => {
  const options = {
    repository: "getopenpost/openpost",
    runId: "123",
    prefix: "frontend-",
    producer: "Frontend",
    timeoutMs: 100000,
  };
  let clock = 0,
    calls = 0,
    pauses = 0;
  const timing = {
    now: () => clock,
    pause: async (ms) => {
      clock += ms;
      pauses++;
    },
  };
  await assert.rejects(
    waitForRunArtifact(options, {
      ...timing,
      jobs: () => {
        calls++;
        throw Error("API permission denied");
      },
    }),
    /3 consecutive errors.*API permission denied/u,
  );
  assert.equal(calls, 3);
  assert.equal(pauses, 2);
  clock = 0;
  calls = 0;
  const results = [
    Error("temporary"),
    Error("temporary"),
    [],
    Error("temporary"),
    Error("temporary"),
    [{ name: "Frontend", status: "completed", conclusion: "success" }],
  ];
  assert.equal(
    await waitForRunArtifact(options, {
      ...timing,
      jobs: () => {
        const result = results[calls++];
        if (result instanceof Error) throw result;
        return result;
      },
      resolve: () => "frontend-1",
    }),
    "frontend-1",
  );
  assert.equal(calls, 6);
});
