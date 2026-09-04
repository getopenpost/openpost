import assert from "node:assert/strict";
import test from "node:test";
import { assertUniqueDocumentationRoutes } from "../../../scripts/social-images/catalog.mjs";
import { docsPageCatalog } from "./docs-catalog.js";
import {
  docsSocialEntries,
  docsRouteFromPage,
  marketingPrerenderEntries,
  marketingSocialEntries,
  socialRendererVersion,
} from "./index.js";

function assertRendererUrl(entry, owner) {
  const image = new URL(entry.imageUrl);
  assert.equal(image.origin, "https://openpo.st", `${owner} leaves the image origin`);
  assert.equal(image.pathname, "/og", `${owner} leaves the renderer path`);
  assert.ok(image.searchParams.get("id"), `${owner} needs a renderer id`);
  assert.equal(image.searchParams.get("v"), socialRendererVersion, `${owner} pins stale output`);
  assert.equal(image.searchParams.has("title"), false, `${owner} leaks a title into the URL`);
}

test("every social entry is unique and honors the renderer contract", () => {
  const seen = new Set();
  for (const entry of marketingSocialEntries) {
    for (const key of [`path:${entry.path}`, `key:${entry.key}`, `id:${entry.id}`]) {
      assert.ok(!seen.has(key), `duplicate social entry ${key}`);
      seen.add(key);
    }
    assertRendererUrl(entry, entry.key);
    assert.match(entry.canonical, /^https:\/\/openpo\.st(?:\/|$)/);
    assert.ok(entry.socialTitle.length <= 72, `${entry.key} social title is too long`);
    assert.ok(entry.description.length <= 160, `${entry.key} description is too long`);
  }

  const pages = new Map(docsPageCatalog.map((page) => [page.page, page]));
  for (const entry of docsSocialEntries) {
    assert.ok(!seen.has(`id:${entry.id}`), `duplicate social entry id:${entry.id}`);
    seen.add(`id:${entry.id}`);
    assertRendererUrl(entry, entry.id);
    const page = pages.get(entry.page);
    assert.ok(page, `${entry.id} points at an unknown docs page`);
    assert.equal(entry.route, page.route, `${entry.id} disagrees with the catalog route`);
    assert.equal(
      entry.route,
      docsRouteFromPage(page.page),
      `${entry.id} disagrees with the VitePress route convention`,
    );
  }

  assert.equal(docsRouteFromPage("index.md"), "/");
  assert.equal(docsRouteFromPage("providers/x.md"), "/providers/x");
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
});

test("documentation corpus policy is complete canonical metadata", () => {
  const sections = new Set([
    "user-guide",
    "providers",
    "cli",
    "mcp",
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
