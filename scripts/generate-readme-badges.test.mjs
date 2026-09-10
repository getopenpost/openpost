import assert from "node:assert/strict";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import {
  fetchBadgeData,
  parseArguments,
  renderBadge,
  writeBadges,
} from "./generate-readme-badges.mjs";

function response(body, status = 200) {
  return {
    ok: status >= 200 && status < 300,
    status,
    async json() {
      return body;
    },
  };
}

test("fetches truthful counts and paginates every release page", async () => {
  const requests = [];
  const fetchImpl = async (url) => {
    requests.push(url);
    if (url.endsWith("/openpost")) return response({ stargazers_count: 42 });
    if (url.endsWith("/releases/latest"))
      return response({ tag_name: "v1.2.3" });
    if (url.includes("/actions/workflows/ci.yml/runs"))
      return response({
        workflow_runs: [{ status: "completed", conclusion: "success" }],
      });
    if (new URL(url).searchParams.get("page") === "1")
      return response([
        { assets: [{ download_count: 4 }, { download_count: 3 }] },
        ...Array.from({ length: 99 }, () => ({ assets: [] })),
      ]);
    return response([{ assets: [{ download_count: 5 }] }]);
  };
  const data = await fetchBadgeData("getopenpost/openpost", {
    token: "secret",
    fetchImpl,
  });
  assert.deepEqual(data, {
    downloads: 12,
    release: "v1.2.3",
    build: "passing",
    stars: 42,
  });
  assert.ok(
    requests.some((url) => url.includes("/releases?per_page=100&page=2")),
  );
});

test("fails closed on API errors", async () => {
  await assert.rejects(
    () =>
      fetchBadgeData("getopenpost/openpost", {
        fetchImpl: async () => response({}, 500),
      }),
    /GitHub API request failed \(500\)/u,
  );
});

test("excludes draft releases and rejects malformed release assets", async () => {
  const baseResponses = (releases) => async (url) => {
    if (url.endsWith("/openpost")) return response({ stargazers_count: 1 });
    if (url.endsWith("/releases/latest"))
      return response({ tag_name: "v1.0.0" });
    if (url.includes("/actions/workflows/ci.yml/runs"))
      return response({ workflow_runs: [] });
    return response(releases);
  };
  const data = await fetchBadgeData("getopenpost/openpost", {
    fetchImpl: baseResponses([
      { draft: true, assets: [{ download_count: 99 }] },
      { assets: [{ download_count: 2 }] },
    ]),
  });
  assert.equal(data.downloads, 2);
  await assert.rejects(
    () =>
      fetchBadgeData("getopenpost/openpost", {
        fetchImpl: baseResponses([{ assets: null }]),
      }),
    /missing an assets array/u,
  );
});

test("renders accessible light and dark SVG badges with crisp Dither pixels", () => {
  const svg = renderBadge("downloads", 1234, "light");
  assert.match(svg, /<title[^>]*>downloads: 1234<\/title>/u);
  assert.match(svg, /shape-rendering="crispEdges"/u);
  assert.match(svg, /fill-opacity="0\.500"/u);
  assert.match(svg, /clipPath id="badge-clip"/u);
  assert.match(renderBadge("stars", 42, "dark"), /#ffd45c/u);
  assert.match(renderBadge("build", "failing", "light"), /#ef9a9a/u);
});

test("writes all badge variants only after data fetch succeeds", async () => {
  const outputDir = await mkdtemp(join(tmpdir(), "openpost-badges-"));
  try {
    const files = await writeBadges(
      { downloads: 12, release: "v1.2.3", build: "passing", stars: 9 },
      outputDir,
    );
    assert.equal(files.length, 8);
    assert.match(
      await readFile(join(outputDir, "release-dark.svg"), "utf8"),
      /v1\.2\.3/u,
    );
  } finally {
    await rm(outputDir, { recursive: true, force: true });
  }
});

test("parses only supported options", () => {
  assert.deepEqual(
    parseArguments(["--repo", "owner/project", "--output-dir", "tmp/badges"]),
    { repository: "owner/project", outputDir: "tmp/badges" },
  );
  assert.throws(() => parseArguments(["--unknown"]), /Unknown argument/u);
});
