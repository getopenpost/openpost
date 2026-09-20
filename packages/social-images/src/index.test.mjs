import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { assertUniqueDocumentationRoutes } from "../../../scripts/social-images/catalog.mjs";
import { docsPageCatalog } from "./docs-catalog.js";
import {
  docsSocialEntries,
  docsRouteFromPage,
  docsSocialImageKey,
  docsSocialImageUrlForRoute,
  marketingPrerenderEntries,
  marketingSocialEntries,
  resolveMarketingSocial,
} from "./index.js";

function assertStaticImageUrl(entry, owner, expected) {
  const image = new URL(entry.imageUrl);
  assert.equal(image.href, expected, `${owner} does not use its published social image`);
}

async function pngDimensions(relativePath) {
  const bytes = await readFile(new URL(relativePath, import.meta.url));
  assert.equal(bytes.subarray(1, 4).toString(), "PNG", `${relativePath} is not a PNG`);
  return { width: bytes.readUInt32BE(16), height: bytes.readUInt32BE(20) };
}

test("every social entry is unique and uses its published static image", () => {
  const seen = new Set();
  const images = new Set();
  for (const entry of marketingSocialEntries) {
    for (const key of [`path:${entry.path}`, `key:${entry.key}`, `id:${entry.id}`]) {
      assert.ok(!seen.has(key), `duplicate social entry ${key}`);
      seen.add(key);
    }
    assertStaticImageUrl(entry, entry.key, `https://openpo.st/og/${entry.key}.png`);
    images.add(entry.imageUrl);
    assert.match(entry.imageAlt, /OpenPost social preview\.$/u);
    assert.match(entry.canonical, /^https:\/\/openpo\.st(?:\/|$)/);
    assert.ok(entry.socialTitle.length <= 72, `${entry.key} social title is too long`);
    assert.ok(entry.description.length <= 160, `${entry.key} description is too long`);
  }
  assert.equal(images.size, marketingSocialEntries.length);

  const pages = new Map(docsPageCatalog.map((page) => [page.page, page]));
  images.clear();
  for (const entry of docsSocialEntries) {
    assert.ok(!seen.has(`id:${entry.id}`), `duplicate social entry id:${entry.id}`);
    seen.add(`id:${entry.id}`);
    assertStaticImageUrl(entry, entry.id, `https://openpo.st/docs/og/${entry.key}.png`);
    images.add(entry.imageUrl);
    assert.match(entry.imageAlt, /OpenPost documentation social preview\.$/u);
    const page = pages.get(entry.page);
    assert.ok(page, `${entry.id} points at an unknown docs page`);
    assert.equal(entry.route, page.route, `${entry.id} disagrees with the catalog route`);
    assert.equal(
      entry.route,
      docsRouteFromPage(page.page),
      `${entry.id} disagrees with the VitePress route convention`,
    );
  }
  assert.equal(images.size, docsSocialEntries.length);

  assert.equal(docsRouteFromPage("index.md"), "/");
  assert.equal(docsRouteFromPage("providers/x.md"), "/providers/x");
  assert.equal(docsSocialImageKey("/guides/quickstart/"), "guides--quickstart");
  assert.equal(docsSocialImageKey("/guides/quickstart?source=test"), "guides--quickstart");
  assert.equal(
    docsSocialImageUrlForRoute("/api-reference/accounts/list-accounts"),
    "https://openpo.st/docs/og/api-reference--accounts--list-accounts.png",
  );
  assertUniqueDocumentationRoutes(docsPageCatalog);
  assert.throws(
    () =>
      assertUniqueDocumentationRoutes([
        { page: "ordinary.md", route: "/collision" },
        { page: "special.md", route: "/collision/" },
      ]),
    /duplicate documentation route/u,
  );
  assert.throws(
    () => marketingPrerenderEntries("/pricing"),
    /Unknown marketing prerender section/u,
  );
  assert.equal(resolveMarketingSocial("/unknown").imageUrl, "https://openpo.st/og/home.png");
});

test("documentation corpus policy is complete canonical metadata", () => {
  const sections = new Set([
    "user-guide",
    "providers",
    "cli",
    "mcp",
    "automate",
    "video-editor",
    "image-editor",
    "installation",
    "self-hosting",
    "configuration",
    "operations",
    "api",
    "development",
  ]);
  for (const page of docsPageCatalog) {
    for (const [field, pattern] of [
      ["agentDiscovery.membership", /^(?:primary|optional|unlisted)$/u],
      ["agentRepresentation.membership", /^(?:ordinary|special)$/u],
      ["agentCorpus.membership", /^(?:included|excluded)$/u],
    ]) {
      const value = field.split(".").reduce((node, part) => node[part], page);
      assert.match(value, pattern, `${page.page} has an unknown ${field}`);
    }
    if (page.agentCorpus.membership === "included") {
      assert.ok(sections.has(page.agentCorpus.section), `${page.page} needs a corpus section`);
      continue;
    }
    assert.ok(page.agentCorpus.reason.trim(), `${page.page} exclusion needs a reason`);
    assert.equal(
      page.agentDiscovery.membership,
      "unlisted",
      `${page.page} must not be indexed while excluded from the corpus`,
    );
  }
});

test("published social images use the declared 1200 x 630 dimensions", async () => {
  for (const image of ["../../../assets/brand/og-image.png", "../../../assets/brand/og-docs.png"]) {
    assert.deepEqual(await pngDimensions(image), { width: 1200, height: 630 });
  }
});
