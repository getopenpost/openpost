import assert from "node:assert/strict";
import test from "node:test";
import {
  docsSocialEntries,
  docsImageKey,
  docsRouteFromPage,
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
    assert.ok(
      entry.socialTitle.length <= 72,
      `${entry.key} social title is too long`,
    );
    assert.ok(
      entry.description.length <= 160,
      `${entry.key} description is too long`,
    );
    paths.add(entry.path);
    keys.add(entry.key);
  }
});

test("marketing paths resolve without query strings or trailing slashes", () => {
  assert.equal(resolveMarketingSocial("/pricing/").key, "pricing");
  assert.equal(
    resolveMarketingSocial("/tools/thread-splitter?from=x").key,
    "tool-thread-splitter",
  );
  assert.equal(
    resolveMarketingSocial("/unknown").canonical,
    "https://openpost.social/unknown",
  );
});

test("docs routes and image keys match VitePress output paths", () => {
  assert.equal(docsRouteFromPage("index.md"), "/");
  assert.equal(docsRouteFromPage("usage/index.md"), "/usage/");
  assert.equal(docsRouteFromPage("providers/x.md"), "/providers/x");
  assert.equal(docsImageKey("usage/index.md"), "usage");
  assert.equal(
    docsImageKey("providers/platform-limits.md"),
    "providers--platform-limits",
  );

  const social = resolveDocsSocial({
    page: "providers/x.md",
    title: "X",
  });
  assert.equal(social.label, "Provider guide");
  assert.equal(social.canonical, "https://docs.openpost.social/providers/x");
  assert.equal(new URL(social.imageUrl).origin, "https://openpost.social");
  assert.equal(
    new URL(social.imageUrl).searchParams.get("id"),
    "docs:providers--x",
  );
  assert.equal(resolveSocialImageEntry(social.id).socialTitle, "X");
});

test("every generated docs card has a unique, server-resolvable catalog id", () => {
  assert.equal(docsSocialEntries.length, 85);
  assert.equal(
    new Set(docsSocialEntries.map((entry) => entry.id)).size,
    docsSocialEntries.length,
  );
  for (const entry of docsSocialEntries)
    assert.equal(resolveSocialImageEntry(entry.id), entry);
});
