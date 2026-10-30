import { test, expect } from "bun:test";
import { readFileSync } from "node:fs";
import { load } from "js-yaml";

// Browser installs follow the launch mode of each suite: channel chromium
// suites need the full browser build only, while the marketing suite keeps
// Playwright's bundled headless shell. Server tooling tests also launch Chromium.
const workflow = readFileSync(new URL("../.github/workflows/ci.yml", import.meta.url), "utf8");
const jobs = load(workflow).jobs;

function browserInstall(job) {
  const step = job.steps.find((entry) => entry.run?.includes("playwright install"));
  expect(step, "job installs a Playwright browser").toBeDefined();
  return step;
}

function stepConditionRuns(condition, shard) {
  if (!condition) return true;
  return new Function(`return (${condition.replaceAll("matrix.shard", JSON.stringify(shard))})`)();
}

test("browser installs match each suite's launch mode", () => {
  const frontend = browserInstall(jobs["frontend-tests"]);
  // The server job includes a real browser-tooling test. Shared package
  // tests include social previews, which use Playwright's headless shell.
  for (const shard of ["server", "1/6", "2/6", "3/6", "4/6", "5/6", "6/6"])
    expect(stepConditionRuns(frontend.if, shard)).toBe(true);
  expect(stepConditionRuns(frontend.if, "packages")).toBe(false);
  expect(frontend.run).toContain("playwright install --with-deps --no-shell chromium");
  const packages = jobs["frontend-tests"].steps.find((step) => step.run?.includes("--only-shell"));
  expect(packages).toBeDefined();
  expect(stepConditionRuns(packages.if, "packages")).toBe(true);
  expect(stepConditionRuns(packages.if, "server")).toBe(false);
  expect(packages.run).toContain("playwright install --with-deps --only-shell chromium");

  for (const name of ["browser-app", "browser-handoff"]) {
    const step = browserInstall(jobs[name]);
    expect(step.if).toBeUndefined();
    expect(step.run).toContain("playwright install --with-deps --no-shell chromium");
  }

  // Marketing launches the bundled headless shell, so its install stays intact.
  expect(browserInstall(jobs["browser-marketing"]).run).not.toContain("--no-shell");
});

test("marketing CI keeps raw and summarized timings from its JSON report", () => {
  const job = jobs["browser-marketing"];
  const testIndex = job.steps.findIndex((step) => step.name === "Test the marketing artifact");
  expect(testIndex).toBeGreaterThan(-1);
  const reportFile = job.steps[testIndex].env?.PLAYWRIGHT_JSON_OUTPUT_FILE;
  expect(reportFile).toContain("${{ runner.temp }}");

  const summarizeIndex = job.steps.findIndex(
    (step) => step.name === "Summarize marketing test timings",
  );
  expect(summarizeIndex).toBeGreaterThan(testIndex);
  const summarize = job.steps[summarizeIndex];
  expect(summarize.if).toBe("always()");
  // A missing report warns and skips so the original test failure stands.
  expect(summarize.run).toContain(`report="${reportFile}"`);
  expect(summarize.run).toContain(`if [[ -f "$report" ]]`);
  expect(summarize.run).toContain("::warning::");
  expect(summarize.run).toContain('bun scripts/ci-test-timings.mjs summarize "$report"');

  const uploadIndex = job.steps.findIndex((step) => step.name === "Retain marketing test timings");
  expect(uploadIndex).toBeGreaterThan(summarizeIndex);
  const upload = job.steps[uploadIndex];
  expect(upload.if).toBe("always()");
  expect(upload.with.name).toBe(
    "marketing-test-timings-${{ github.sha }}-${{ github.run_attempt }}",
  );
  expect(upload.with["retention-days"]).toBe(14);
  expect(upload.with["if-no-files-found"]).toBe("warn");
  expect(
    upload.with.path
      .trim()
      .split("\n")
      .map((entry) => entry.trim()),
  ).toEqual([
    "${{ runner.temp }}/openpost-marketing-timings.json",
    "${{ runner.temp }}/openpost-marketing-timing-summary.json",
  ]);
});

test("the marketing config reports JSON output through the CI override", async () => {
  const previousCI = process.env.CI;
  const previousOutput = process.env.PLAYWRIGHT_JSON_OUTPUT_FILE;
  const override = "/tmp/openpost-marketing-test-timings.json";
  const configURL = new URL("../tests/marketing/playwright.config.ts", import.meta.url);
  try {
    process.env.CI = "1";
    process.env.PLAYWRIGHT_JSON_OUTPUT_FILE = override;
    const { default: config } = await import(configURL.href);
    const json = config.reporter.find(([name]) => name === "json");
    expect(json?.[1]?.outputFile).toBe(override);
  } finally {
    if (previousCI === undefined) delete process.env.CI;
    else process.env.CI = previousCI;
    if (previousOutput === undefined) delete process.env.PLAYWRIGHT_JSON_OUTPUT_FILE;
    else process.env.PLAYWRIGHT_JSON_OUTPUT_FILE = previousOutput;
  }

  // Without the CI override the reporter still writes a timing report.
  const env = { ...process.env, CI: "1" };
  delete env.PLAYWRIGHT_JSON_OUTPUT_FILE;
  const probe = Bun.spawnSync({
    cmd: [
      process.execPath,
      "-e",
      `import(${JSON.stringify(configURL.href)}).then((m) => { const json = m.default.reporter.find(([name]) => name === "json"); console.log(json[1].outputFile); })`,
    ],
    env,
  });
  expect(probe.exitCode).toBe(0);
  expect(probe.stdout.toString().trim()).toEndWith("/test-results/marketing-timings.json");
});
