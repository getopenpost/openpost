import { test, expect } from "bun:test";
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
