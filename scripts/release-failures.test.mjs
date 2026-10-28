import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { load } from "js-yaml";

import {
  focusedCommands,
  formatFailureDigest,
  localJobCommand,
  parseFailureLog,
} from "./release-failures.mjs";

// Lines keep the `job<TAB>step<TAB>timestamp` prefix of `gh run view --log-failed`.
const logged = (job, ...lines) =>
  lines.map((line) => `${job}\tUNKNOWN STEP\t2026-10-24T22:59:01.1512063Z ${line}`).join("\n");

test("every CI job maps to a local reproduction or is an artifact-only job", () => {
  const jobs = load(readFileSync(".github/workflows/ci.yml", "utf8")).jobs;
  const artifactOnly = new Set([
    "Plan affected surfaces",
    "Relay proven candidate artifacts",
    "Production image index",
    "Release Candidate",
  ]);
  const encountered = new Set();
  let expandedJobs = 0;
  for (const [id, job] of Object.entries(jobs)) {
    const values = job.strategy?.matrix?.shard ?? job.strategy?.matrix?.include ?? [undefined];
    for (const value of values) {
      expandedJobs += 1;
      const name = String(job.name ?? id)
        .replace("${{ matrix.shard }}", String(value))
        .replace("${{ matrix.arch }}", String(value?.arch));
      if (artifactOnly.has(name)) {
        encountered.add(name);
        assert.equal(localJobCommand(name), undefined);
      } else {
        assert.match(
          localJobCommand(name) ?? "",
          /^devenv shell -- bash -c ".+"$/u,
          `${name} needs an executable local command`,
        );
      }
    }
  }
  assert.ok(expandedJobs > 0, "the CI inventory must contain jobs");
  assert.deepEqual([...encountered].sort(), [...artifactOnly].sort());
});

test("browser failures name the spec declaration and its focused rerun", () => {
  const parsed = parseFailureLog(
    logged(
      "Application browser suite (1/6)",
      "··××F::error file=tests/app/dither-polish.spec.ts,title=[chrome] › tests/app/dither-polish.spec.ts:10:1 › Dither keeps routes usable, on phones,line=59,col=56::  1) [chrome] › x %0A    Error: expect(locator).toHaveCount(expected) failed%0A",
      "××T::error file=tests/app/dither-polish.spec.ts,title=[chrome] › tests/app/dither-polish.spec.ts:10:1 › Dither keeps routes usable, on phones,line=59,col=56::  1) retry",
    ),
  );
  assert.deepEqual(parsed.playwright, [
    {
      file: "tests/app/dither-polish.spec.ts",
      line: 10,
      title: "Dither keeps routes usable, on phones",
      error: "Error: expect(locator).toHaveCount(expected) failed",
    },
  ]);
  assert.deepEqual(focusedCommands(parsed), [
    'devenv shell -- bash -c "bunx playwright test --config tests/app/playwright.config.ts tests/app/dither-polish.spec.ts:10"',
  ]);
});

test("component failures group by file and project", () => {
  const parsed = parseFailureLog(
    logged(
      "Frontend tests (3/6)",
      "^[[41m^[[1m FAIL ^[[22m^[[49m ^[[30m^[[43m client (chromium) ^[[49m^[[39m src/lib/themes/settings.svelte.test.ts^[[2m > ^[[22mretries publishing",
      " FAIL  client (chromium)  src/lib/themes/settings.svelte.test.ts > locks during refresh",
    ),
  );
  assert.equal(parsed.vitest.length, 2);
  assert.deepEqual(focusedCommands(parsed), [
    'devenv shell -- bash -c "cd apps/web && bun run sync && bunx vitest run --project client src/lib/themes/settings.svelte.test.ts"',
  ]);
});

test("Go failures attach failed and timed-out tests to their package", () => {
  const parsed = parseFailureLog(
    logged(
      "Backend tests (2/4)",
      "panic: test timed out after 20m0s",
      "\trunning tests:",
      "\t\tTestFeatureGateGrowEnforcement (19m58s)",
      "",
      "FAIL\tgithub.com/openpost/backend/internal/api/handlers\t1235.950s",
      "--- FAIL: TestFitNarrowImage (20.18s)",
      "    --- FAIL: TestFitNarrowImage/portrait (1.00s)",
      "FAIL\tgithub.com/openpost/backend/internal/imageprepare\t59.899s",
    ),
  );
  assert.deepEqual(parsed.go, [
    { package: "internal/api/handlers", tests: ["TestFeatureGateGrowEnforcement"] },
    { package: "internal/imageprepare", tests: ["TestFitNarrowImage"] },
  ]);
});

test("image scan failures list each library with its fixed version", () => {
  const digest = formatFailureDigest(
    "Production image (linux/arm64)",
    logged(
      "Production image (linux/arm64)",
      "│ github.com/labstack/echo/v4 │ GHSA-cxf3-9h37-7rr8 │ CRITICAL │ fixed  │ v4.15.4 │ 4.16.1 │ Echo │",
      "│                             │                     │          │        │         │        │ link │",
      "│                             │ GHSA-9969-6676-49h5 │ HIGH     │        │         │        │ Echo │",
    ),
  );
  assert.match(
    digest,
    /github\.com\/labstack\/echo\/v4 v4\.15\.4 → 4\.16\.1: GHSA-cxf3-9h37-7rr8, GHSA-9969-6676-49h5/u,
  );
});

test("unrecognized failures fall back to the step output, not its header", () => {
  const digest = formatFailureDigest(
    "Svelte lint and checks",
    logged(
      "Svelte lint and checks",
      "##[group]Run bun run lint -- frontend",
      "env:",
      "##[endgroup]",
      "src/routes/analytics.ts:12:3 error no type assertions",
      "##[error]Process completed with exit code 1.",
    ),
  );
  assert.match(digest, /src\/routes\/analytics\.ts:12:3 error no type assertions/u);
  assert.doesNotMatch(digest, /env:/u);
  assert.equal(
    localJobCommand("Svelte lint and checks"),
    'devenv shell -- bash -c "bun run lint -- frontend && bun run check -- frontend && bun run check -- marketing"',
  );
});
