import assert from "node:assert/strict";
import test from "node:test";
import { docsPageCatalog } from "./docs-catalog.js";
import {
  docsSocialEntries,
  docsImageKey,
  docsRouteFromPage,
  marketingPrerenderEntries,
  marketingAgentMarkdownUrl,
  marketingRouteManifest,
  marketingSocialEntries,
  resolveDocsSocial,
  resolveMarketingSocial,
  resolveSocialImageEntry,
} from "./index.js";

test("marketing social entries have unique paths, keys, and complete image metadata", () => {
  const paths = new Set();
  const keys = new Set();

  for (const entry of marketingSocialEntries) {
    assert.equal(paths.has(entry.path), false, `duplicate path ${entry.path}`);
    assert.equal(keys.has(entry.key), false, `duplicate key ${entry.key}`);
    const image = new URL(entry.imageUrl);
    assert.equal(image.origin, "https://openpost.social");
    assert.equal(image.pathname, "/og");
    assert.equal(image.searchParams.get("id"), entry.id);
    assert.equal(image.searchParams.has("title"), false);
    assert.equal(resolveSocialImageEntry(entry.id), entry);
    assert.match(entry.canonical, /^https:\/\/openpost\.social(?:\/|$)/);
    assert.match(entry.priority, /^(?:1\.0|0\.[0-9])$/u);
    assert.match(entry.agentRepresentation, /^(?:static|platform|comparison|tool)$/u);
    assert.match(entry.agentDiscovery.membership, /^(?:primary|optional|unlisted)$/u);
    assert.ok(entry.socialTitle.length <= 72, `${entry.key} social title is too long`);
    assert.ok(entry.description.length <= 160, `${entry.key} description is too long`);
    paths.add(entry.path);
    keys.add(entry.key);
  }
});

test("the public route manifest owns social, sitemap, and prerender metadata", () => {
  assert.equal(marketingSocialEntries, marketingRouteManifest);
  assert.equal(resolveMarketingSocial("/trust").key, "trust");
  assert.deepEqual(marketingPrerenderEntries("/platforms")[0], { slug: "x" });
  assert.deepEqual(
    marketingPrerenderEntries("/compare").map(({ slug }) => slug),
    ["buffer", "hootsuite", "typefully", "postiz", "post-bridge", "mixpost"],
  );
  assert.equal(marketingPrerenderEntries("/tools").length, 8);
  assert.equal(
    marketingAgentMarkdownUrl(resolveMarketingSocial("/")),
    "https://openpost.social/index.md",
  );
  assert.equal(
    marketingAgentMarkdownUrl(resolveMarketingSocial("/platforms/x")),
    "https://openpost.social/platforms/x.md",
  );
  assert.equal(
    marketingAgentMarkdownUrl(resolveMarketingSocial("/pricing")),
    "https://openpost.social/pricing.md",
  );
  assert.equal(
    marketingAgentMarkdownUrl(resolveMarketingSocial("/tools/thread-splitter")),
    "https://openpost.social/tools/thread-splitter.md",
  );
  assert.throws(
    () => marketingPrerenderEntries("/pricing"),
    /Unknown marketing prerender section/u,
  );
});

test("marketing paths resolve without query strings or trailing slashes", () => {
  assert.equal(resolveMarketingSocial("/features/").key, "features");
  assert.equal(resolveMarketingSocial("/pricing/").key, "pricing");
  assert.equal(resolveMarketingSocial("/faq/").key, "faq");
  assert.equal(resolveMarketingSocial("/tools/thread-splitter?from=x").key, "tool-thread-splitter");
  assert.equal(resolveMarketingSocial("/unknown").canonical, "https://openpost.social/unknown");
});

test("docs routes and image keys match VitePress output paths", () => {
  assert.equal(docsRouteFromPage("index.md"), "/");
  assert.equal(docsRouteFromPage("usage/index.md"), "/usage/");
  assert.equal(docsRouteFromPage("providers/x.md"), "/providers/x");
  assert.equal(docsImageKey("usage/index.md"), "usage");
  assert.equal(docsImageKey("providers/platform-limits.md"), "providers--platform-limits");

  const social = resolveDocsSocial({
    page: "providers/x.md",
    title: "X",
  });
  assert.equal(social.label, "Provider guide");
  assert.equal(social.canonical, "https://docs.openpost.social/providers/x");
  assert.equal(new URL(social.imageUrl).origin, "https://openpost.social");
  assert.equal(new URL(social.imageUrl).searchParams.get("id"), "docs:providers--x");
  assert.equal(resolveSocialImageEntry(social.id).socialTitle, "X");
});

test("every generated docs card has a unique, server-resolvable catalog id", () => {
  assert.equal(docsSocialEntries.length, docsPageCatalog.length);
  assert.equal(new Set(docsSocialEntries.map((entry) => entry.id)).size, docsSocialEntries.length);
  for (const entry of docsSocialEntries) assert.equal(resolveSocialImageEntry(entry.id), entry);
});
