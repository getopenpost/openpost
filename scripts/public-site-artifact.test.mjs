import { test, expect } from "bun:test";
import { selectAttemptArtifact } from "./ci-artifacts.mjs";
import { mkdtemp, mkdir, writeFile, rm, symlink } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import {
  assertQualifiedRun,
  configIdentity,
  seal,
  verify,
  proveLive,
} from "./public-site-artifact.mjs";
const source = "a".repeat(40);
const config = configIdentity({});
const identity = { source, config };
async function fixture(fn) {
  const root = await mkdtemp(path.join(os.tmpdir(), "public-artifact-"));
  const site = path.join(root, "site");
  await mkdir(site);
  await writeFile(path.join(site, "index.html"), "<p>qualified</p>");
  const manifest = path.join(root, "manifest.json");
  await seal(site, manifest, identity);
  try {
    await fn(site, manifest);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
}
test("qualified bytes survive transfer, and source/config mismatches fail closed", () =>
  fixture(async (site, manifest) => {
    expect((await verify(site, manifest, identity)).source).toBe(source);
    await expect(verify(site, manifest, { ...identity, source: "b".repeat(40) })).rejects.toThrow(
      "source/config",
    );
    await expect(verify(site, manifest, { ...identity, config: "b".repeat(64) })).rejects.toThrow(
      "source/config",
    );
  }));
for (const mutation of ["change", "add", "delete", "symlink"]) {
  test(`actual artifact ${mutation} is rejected`, () =>
    fixture(async (site, manifest) => {
      if (mutation === "change") await writeFile(path.join(site, "index.html"), "tampered");
      if (mutation === "add") await writeFile(path.join(site, "extra"), "tampered");
      if (mutation === "delete") await rm(path.join(site, "index.html"));
      if (mutation === "symlink") await symlink("/etc/hosts", path.join(site, "escape"));
      await expect(verify(site, manifest, identity)).rejects.toThrow();
    }));
}
test("live proof checks response bytes and rejects redirects", () =>
  fixture(async (site, manifest) => {
    expect(
      (
        await proveLive(
          site,
          manifest,
          identity,
          "https://example.com",
          async () => new Response("<p>qualified</p>"),
        )
      ).verifiedFiles,
    ).toBe(1);
    await expect(
      proveLive(site, manifest, identity, "https://example.com", async () => new Response("other")),
    ).rejects.toThrow("live byte");
    await expect(
      proveLive(
        site,
        manifest,
        identity,
        "https://example.com",
        async () => new Response("", { status: 302 }),
      ),
    ).rejects.toThrow("live byte");
  }));
const run = {
  head_sha: source,
  head_repository: { full_name: "owner/repo" },
  event: "push",
  head_branch: "main",
  path: ".github/workflows/ci.yml",
  status: "completed",
  conclusion: "success",
};
const jobs = ["Public artifact contract"].map((name) => ({
  name,
  conclusion: "success",
}));
test("only successful exact-source main CI and all required jobs qualify", () => {
  assertQualifiedRun(run, jobs, "owner/repo", source);
  for (const conclusion of ["failure", "skipped", "cancelled", null]) {
    expect(() =>
      assertQualifiedRun(run, [{ ...jobs[0], conclusion }, ...jobs.slice(1)], "owner/repo", source),
    ).toThrow("prerequisite");
  }
  expect(() => assertQualifiedRun(run, jobs.slice(1), "owner/repo", source)).toThrow(
    "prerequisite",
  );
  for (const changed of [
    { event: "pull_request" },
    { head_branch: "feature" },
    { conclusion: "failure" },
    { head_sha: "b".repeat(40) },
    { head_repository: { full_name: "fork/repo" } },
  ]) {
    expect(() => assertQualifiedRun({ ...run, ...changed }, jobs, "owner/repo", source)).toThrow(
      "mismatch",
    );
  }
});
test("consumer rejects a digest different from the qualification job output", () =>
  fixture(async (site, manifest) => {
    await expect(verify(site, manifest, { ...identity, digest: "f".repeat(64) })).rejects.toThrow();
  }));

test("live proof bounds asset requests while local verification covers every file", () =>
  fixture(async (site, manifest) => {
    await mkdir(path.join(site, "assets"));
    for (let i = 0; i < 1000; i++) await writeFile(path.join(site, "assets", `${i}.js`), "asset");
    await seal(site, manifest, identity);
    let requests = 0;
    const result = await proveLive(site, manifest, identity, "https://example.com", async (url) => {
      requests++;
      return new Response(url.pathname === "/" ? "<p>qualified</p>" : "asset");
    });
    expect(requests).toBeLessThan(50);
    expect(result.inventoryFiles).toBe(1001);
    await writeFile(path.join(site, "assets", "999.js"), "corrupt");
    await expect(proveLive(site, manifest, identity, "https://example.com")).rejects.toThrow(
      "digest",
    );
  }));

test("partial reruns retain prior qualification but never hide a newer producer failure", () => {
  expect(
    assertQualifiedRun(
      run,
      [
        { ...jobs[0], run_attempt: 1 },
        { name: "Other", run_attempt: 2 },
      ],
      "owner/repo",
      source,
    ),
  ).toBe(1);
  expect(() =>
    assertQualifiedRun(
      run,
      [
        { ...jobs[0], run_attempt: 1 },
        { ...jobs[0], run_attempt: 2, conclusion: "failure" },
      ],
      "owner/repo",
      source,
    ),
  ).toThrow("prerequisite");
});

test("a complete stable-tag candidate can replace duplicate main qualification", () => {
  expect(assertQualifiedRun({ ...run, head_branch: "v7.34.3" }, jobs, "owner/repo", source)).toBe(
    1,
  );
  for (const branch of ["feature", "v7.34.3-beta", "vwrong"])
    expect(() =>
      assertQualifiedRun({ ...run, head_branch: branch }, jobs, "owner/repo", source),
    ).toThrow("mismatch");
});

// GitHub carries successful jobs forward on failed-job reruns with new IDs and
// run_attempt values, while retaining the original execution timestamps.
const replayRun = { ...run, id: 41044488009, run_attempt: 2 };
const replayJob = {
  ...jobs[0],
  status: "completed",
  run_id: replayRun.id,
  head_sha: source,
  runner_id: 1000030036,
  started_at: "2026-10-30T11:19:17Z",
  completed_at: "2026-10-30T11:25:54Z",
};
const replayJobs = [
  { ...replayJob, id: 124034138592, run_attempt: 1 },
  { ...replayJob, id: 124044147008, run_attempt: 2 },
];
const replayArtifact = {
  name: `public-site-qualified-${source}-1`,
  expired: false,
  created_at: "2026-10-30T11:25:43Z",
  workflow_run: { id: replayRun.id, head_sha: source },
};
test("delivery CLI qualifies the retained artifact after GitHub carries a successful job forward", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "public-qualification-"));
  try {
    for (const [name, value] of Object.entries({
      run: replayRun,
      jobs: [{ jobs: replayJobs }],
      artifacts: { artifacts: [replayArtifact] },
    }))
      await writeFile(path.join(root, `${name}.json`), JSON.stringify(value));
    const result = Bun.spawnSync([
      process.execPath,
      "scripts/public-site-artifact.mjs",
      "qualify-run",
      `${root}/run.json`,
      `${root}/jobs.json`,
      "owner/repo",
      source,
    ]);
    expect(result.exitCode).toBe(0);
    const metadata = JSON.parse(await Bun.file(`${root}/artifacts.json`).text());
    const selected = selectAttemptArtifact(metadata.artifacts, `public-site-qualified-${source}-`);
    expect(selected).toBe(`public-site-qualified-${source}-${result.stdout.toString().trim()}`);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("retained qualification requires identical successful execution provenance", () => {
  expect(assertQualifiedRun(replayRun, replayJobs, "owner/repo", source)).toBe(1);
  for (const change of [
    { started_at: "2026-10-30T11:44:20Z", completed_at: "2026-10-30T11:48:00Z" },
    { started_at: undefined },
    { completed_at: undefined },
    { runner_id: 123 },
    { runner_id: undefined },
    { head_sha: "b".repeat(40) },
    { run_id: 123 },
  ]) {
    expect(
      assertQualifiedRun(
        replayRun,
        [replayJobs[0], { ...replayJobs[1], ...change }],
        "owner/repo",
        source,
      ),
    ).toBe(2);
  }
  for (const conclusion of ["failure", "cancelled", "skipped", null]) {
    expect(() =>
      assertQualifiedRun(
        replayRun,
        [replayJobs[0], { ...replayJobs[1], conclusion }],
        "owner/repo",
        source,
      ),
    ).toThrow("prerequisite");
    expect(
      assertQualifiedRun(
        replayRun,
        [{ ...replayJobs[0], conclusion }, replayJobs[1]],
        "owner/repo",
        source,
      ),
    ).toBe(2);
  }
  expect(() =>
    assertQualifiedRun(
      replayRun,
      [replayJobs[0], replayJobs[0], replayJobs[1]],
      "owner/repo",
      source,
    ),
  ).toThrow("ambiguous");
});

test("a real producer rerun owns its new artifact even when a later rerun carries it forward", () => {
  const rerunJob = {
    ...replayJob,
    run_attempt: 2,
    started_at: "2026-10-30T11:44:20Z",
    completed_at: "2026-10-30T11:48:00Z",
  };
  const qualified = assertQualifiedRun(
    { ...replayRun, run_attempt: 3 },
    [replayJobs[0], rerunJob, { ...rerunJob, run_attempt: 3 }],
    "owner/repo",
    source,
  );
  expect(qualified).toBe(2);
  expect(selectAttemptArtifact([replayArtifact], `public-site-qualified-${source}-`)).not.toBe(
    `public-site-qualified-${source}-${qualified}`,
  );
  expect(
    selectAttemptArtifact(
      [replayArtifact, { ...replayArtifact, name: `public-site-qualified-${source}-2` }],
      `public-site-qualified-${source}-`,
    ),
  ).toBe(`public-site-qualified-${source}-${qualified}`);
});
