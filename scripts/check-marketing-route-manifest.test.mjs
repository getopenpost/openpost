import assert from "node:assert/strict";
import test from "node:test";

import { marketingRouteManifest } from "../packages/social-images/src/index.js";

import {
  catalogSlugs,
  marketingPagePattern,
  routePatternRegex,
  validateMarketingRouteManifest,
} from "./check-marketing-route-manifest.mjs";

test("page components map to canonical route patterns", () => {
  assert.equal(
    marketingPagePattern(
      "/repo/marketing-site/src/routes",
      "/repo/marketing-site/src/routes/+page.svelte",
    ),
    "/",
  );
  assert.equal(
    marketingPagePattern(
      "/repo/marketing-site/src/routes",
      "/repo/marketing-site/src/routes/(public)/tools/[slug]/+page.svelte",
    ),
    "/tools/[slug]",
  );
  assert.equal(routePatternRegex("/tools/[slug]").test("/tools/thread-splitter"), true);
  assert.equal(routePatternRegex("/tools/[slug]").test("/tools/a/nested"), false);
});

test("catalog parsing stays inside the named ownership boundaries", () => {
  const source = `
const platformImplementations = [{ slug: "x" }, { slug: "mastodon" }];
export const platforms = platformImplementations.map(Boolean);
export const tools = [{ slug: "counter" }];
export const faqs = [];
`;
  assert.deepEqual(catalogSlugs(source, "platforms"), ["x", "mastodon"]);
  assert.deepEqual(catalogSlugs(source, "tools"), ["counter"]);
});

test("the repository route manifest is bidirectionally complete", async () => {
  assert.deepEqual(await validateMarketingRouteManifest(), []);
});

test("stale manifest routes fail the reverse page check", async () => {
  const problems = await validateMarketingRouteManifest({
    manifest: [...marketingRouteManifest, { ...marketingRouteManifest[0], path: "/removed-page" }],
  });
  assert.ok(problems.includes("/removed-page must resolve to exactly one page pattern; found 0"));
});
