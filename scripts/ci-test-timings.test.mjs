import assert from "node:assert/strict";
import test from "node:test";
import { summarizeReports, auditSelection } from "./ci-test-timings.mjs";

const report = (specs) => ({
  suites: [
    {
      title: "outer",
      specs: specs.slice(0, 1),
      suites: [{ title: "nested", specs: specs.slice(1) }],
    },
  ],
});
const spec = (id, durations, status = "expected", projectName = "chrome") => ({
  id,
  title: id,
  file: "tests/app/example.spec.ts",
  line: 10,
  tests: [
    { projectName, status, results: durations.map((duration) => ({ duration, status: "passed" })) },
  ],
});

test("retains per-test retry cost and combines shard reports by stable project identity", () => {
  const summary = summarizeReports([
    report([spec("slow", [100, 300], "flaky")]),
    report([spec("fast", [50]), spec("slow", [20], "expected", "mobile")]),
  ]);
  assert.equal(summary.totalDurationMs, 470);
  assert.equal(summary.tests.length, 3);
  assert.deepEqual(summary.tests[0], {
    id: "slow",
    project: "chrome",
    file: "tests/app/example.spec.ts",
    title: "slow",
    durationMs: 400,
    attempts: 2,
    outcome: "flaky",
  });
});

test("selection audit reports failed tests absent from executed selection, without calling flakes misses", () => {
  const selected = summarizeReports([report([spec("covered", [10]), spec("not-run", [])])]);
  const full = summarizeReports([
    report([
      spec("covered", [10], "unexpected"),
      spec("missed", [30], "unexpected"),
      spec("not-run", [20], "unexpected"),
      spec("flake", [10], "flaky"),
    ]),
  ]);
  const audit = auditSelection(selected, full);
  assert.deepEqual(
    audit.uncoveredFailures.map((t) => t.id),
    ["missed", "not-run"],
  );
  assert.equal(audit.fullTests, 4);
  assert.equal(audit.selectedTests, 1);
});

test("invalid reports and duplicate shard inputs fail rather than double-counting", () => {
  assert.throws(() => summarizeReports([{}]), /suites/);
  assert.throws(
    () => summarizeReports([report([spec("same", [10])]), report([spec("same", [20])])]),
    /duplicate/,
  );
  assert.throws(() => summarizeReports([report([spec("bad", [-1])])]), /duration/);
});

test("malformed specs cannot silently disappear from timings", () => {
  for (const tests of [undefined, null, {}]) {
    assert.throws(() => summarizeReports([report([{ id: "broken", tests }])]), /tests array/);
  }
});
