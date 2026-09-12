import assert from "node:assert/strict";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import sharp from "sharp";
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
    if (url.endsWith("/releases/latest")) return response({ tag_name: "v1.2.3" });
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
    stars: 42,
  });
  assert.ok(requests.some((url) => url.includes("/releases?per_page=100&page=2")));
  assert.ok(requests.every((url) => !url.includes("/actions/workflows/")));
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
    if (url.endsWith("/releases/latest")) return response({ tag_name: "v1.0.0" });
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

test("renders readable values and a real pixel texture in both schemes", async () => {
  for (const mode of ["light", "dark"]) {
    const svg = renderBadge("downloads", 1234, mode);
    assert.match(svg, /<title[^>]*>downloads: 1234<\/title>/u);
    const { data, info } = await sharp(Buffer.from(svg))
      .ensureAlpha()
      .raw()
      .toBuffer({ resolveWithObject: true });
    const pixel = (x, y) => [
      ...data.subarray((y * info.width + x) * 4, (y * info.width + x) * 4 + 4),
    ];
    assert.equal(pixel(0, 0)[3], 0, "the rounded corner stays transparent");
    assert.deepEqual(pixel(92, 22), pixel(93, 22), "texture cells stay crisp at native badge size");
    const row = Array.from({ length: 24 }, (_, index) => pixel(90 + index, 22)[0]);
    assert.ok(Math.max(...row) - Math.min(...row) > 8, "dither pixels remain visibly distinct");
    assert.match(renderBadge("release", "v1<&", mode), /v1&lt;&amp;/u);
    const followBadge = renderBadge("follow-dev", undefined, mode);
    assert.match(followBadge, /<title[^>]*>follow dev: X<\/title>/u);
    assert.match(followBadge, /<path d="M18\.901 1\.153/u);
  }
});

test("writes all light and dark badge variants", async () => {
  const outputDir = await mkdtemp(join(tmpdir(), "openpost-badges-"));
  try {
    const files = await writeBadges({ downloads: 12, release: "v1.2.3", stars: 9 }, outputDir);
    assert.equal(files.length, 8);
    assert.match(await readFile(join(outputDir, "release-dark.svg"), "utf8"), /v1\.2\.3/u);
    assert.match(await readFile(join(outputDir, "follow-dev-dark.svg"), "utf8"), /follow dev: X/u);
  } finally {
    await rm(outputDir, { recursive: true, force: true });
  }
});

test("parses only supported options", () => {
  assert.deepEqual(parseArguments(["--repo", "owner/project", "--output-dir", "tmp/badges"]), {
    repository: "owner/project",
    outputDir: "tmp/badges",
  });
  assert.throws(() => parseArguments(["--unknown"]), /Unknown argument/u);
});
