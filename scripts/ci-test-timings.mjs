#!/usr/bin/env bun

import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

// Consume Playwright's JSON reporter, including every retry's cost. These
// reports measure work and audit a future selector; they never omit tests.
export function summarizeReports(reports) {
  const tests = [];
  const identities = new Set();
  function visit(suites) {
    if (!Array.isArray(suites)) throw new Error("report requires a suites array");
    for (const suite of suites) {
      for (const spec of suite.specs ?? []) {
        for (const entry of spec.tests ?? []) {
          const identity = JSON.stringify([spec.id, entry.projectName]);
          if (!spec.id || typeof entry.projectName !== "string")
            throw new Error("test requires stable id and projectName");
          if (identities.has(identity)) throw new Error(`duplicate test report: ${identity}`);
          identities.add(identity);
          const results = entry.results ?? [];
          const durations = results.map((result) => result.duration);
          if (durations.some((duration) => !Number.isFinite(duration) || duration < 0)) {
            throw new Error(`invalid duration for ${identity}`);
          }
          tests.push({
            id: spec.id,
            project: entry.projectName,
            file: spec.file,
            title: spec.title,
            durationMs: durations.reduce((sum, duration) => sum + duration, 0),
            attempts: results.filter((result) => result.status !== "skipped").length,
            outcome: entry.status,
          });
        }
      }
      if (suite.suites) visit(suite.suites);
    }
  }
  for (const report of reports) visit(report.suites);
  tests.sort((a, b) => b.durationMs - a.durationMs || a.id.localeCompare(b.id));
  return {
    schemaVersion: 1,
    totalDurationMs: tests.reduce((sum, test) => sum + test.durationMs, 0),
    tests,
  };
}

export function auditSelection(selected, full) {
  const executed = new Set(
    selected.tests
      .filter((test) => test.attempts > 0)
      .map((test) => JSON.stringify([test.id, test.project])),
  );
  return {
    selectedTests: executed.size,
    fullTests: full.tests.length,
    // A failed full-run test absent from the selection is evidence to inspect,
    // not proof of a causal miss: environment and flaky behavior still matter.
    uncoveredFailures: full.tests.filter(
      (test) =>
        test.outcome === "unexpected" && !executed.has(JSON.stringify([test.id, test.project])),
    ),
  };
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  try {
    const [command, ...files] = process.argv.slice(2);
    const read = (file) => JSON.parse(readFileSync(file, "utf8"));
    if (command === "summarize" && files.length) {
      console.log(JSON.stringify(summarizeReports(files.map(read)), null, 2));
    } else if (command === "audit" && files.length === 2) {
      console.log(JSON.stringify(auditSelection(read(files[0]), read(files[1])), null, 2));
    } else {
      throw new Error(
        "usage: ci-test-timings.mjs summarize REPORT... | audit SELECTED_SUMMARY FULL_SUMMARY",
      );
    }
  } catch (error) {
    console.error(`ci-test-timings: ${error.message}`);
    process.exitCode = 1;
  }
}
