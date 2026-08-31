import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import path from "node:path";
import test from "node:test";

import { renderChangelogAtomFeed } from "../marketing-site/src/lib/changelog-feed.ts";
import { publicContentSignal, renderPublicRobots } from "../marketing-site/src/lib/robots.ts";
import { structuredDataForMarketingPage } from "../marketing-site/src/routes/_structured-data.ts";
import { resolveMarketingSocial } from "../packages/social-images/src/index.js";

test("public crawler policy explicitly permits search, AI input, and model training", async () => {
  const robots = renderPublicRobots();
  assert.equal(
    publicContentSignal,
    "Content-Signal: search=yes, ai-input=yes, ai-train=yes, use=reference",
  );
  assert.match(robots, /^User-agent: \*$/m);
  assert.match(robots, /^Allow: \/$/m);
  assert.match(robots, /^Sitemap: https:\/\/openpost\.social\/sitemap\.xml$/m);
  assert.doesNotMatch(robots, /^Disallow:/m);

  const root = path.resolve(import.meta.dirname, "..");
  for (const [surface, relativeRobots, relativeHeaders] of [
    ["marketing", "marketing-site/src/lib/robots.ts", "marketing-site/static/_headers"],
    ["documentation", "docs-site/public/robots.txt", "docs-site/public/_headers"],
  ]) {
    const [robotsSource, headers] = await Promise.all([
      readFile(path.join(root, relativeRobots), "utf8"),
      readFile(path.join(root, relativeHeaders), "utf8"),
    ]);
    assert.match(robotsSource, /ai-train=yes/u, `${surface} robots must allow training`);
    assert.match(
      headers,
      /\/robots\.txt[\s\S]*ai-train=yes/u,
      `${surface} must emit the response header`,
    );
  }
});

test("structured data joins each page to the product, site, and real operator", () => {
  const about = structuredDataForMarketingPage(resolveMarketingSocial("/about"));
  const graph = about["@graph"];
  const page = graph.find((entry) => entry["@id"] === "https://openpost.social/about#webpage");
  const software = graph.find((entry) => entry["@id"] === "https://openpost.social/#software");
  const source = graph.find((entry) => entry["@id"] === "https://openpost.social/#source");
  const operator = graph.find((entry) => entry["@id"] === "https://openpost.social/#operator");

  assert.equal(page["@type"], "AboutPage");
  assert.deepEqual(page.about, { "@id": "https://openpost.social/#software" });
  assert.equal(software.name, "OpenPost");
  assert.equal(software.operatingSystem, "Web, Android");
  assert.deepEqual(software.sameAs, ["https://github.com/getopenpost/openpost"]);
  assert.equal(source.codeRepository, "https://github.com/getopenpost/openpost");
  assert.deepEqual(source.runtimePlatform, ["Web", "Linux", "Android"]);
  assert.equal(operator.name, "Rodrigo Dias");
  assert.equal(operator.homeLocation.address.addressCountry, "PT");
  assert.equal(operator.contactPoint.url, "https://openpost.social/contact");

  const faq = structuredDataForMarketingPage(resolveMarketingSocial("/faq"));
  const faqPage = faq["@graph"].find(
    (entry) => entry["@id"] === "https://openpost.social/faq#webpage",
  );
  assert.equal(faqPage["@type"], "FAQPage");
  assert.ok(faqPage.mainEntity.length >= 7);
  assert.equal(faqPage.mainEntity[0].acceptedAnswer["@type"], "Answer");
});

test("changelog feed contains only dated stable releases and escaped content", () => {
  const feed = renderChangelogAtomFeed(`
## [Unreleased]

### Added

- Work in progress

## [4.1.0] - 2026-08-23

### Added

- API & agent discovery

## [4.0.1] - 2026-08-22

### Fixed

- Release feed
`);

  assert.match(feed, /<updated>2026-08-23T00:00:00Z<\/updated>/u);
  assert.match(feed, /OpenPost v4\.1\.0/u);
  assert.match(feed, /API &amp; agent discovery/u);
  assert.match(feed, /changelog#v4\.0\.1/u);
  assert.doesNotMatch(feed, /Work in progress|Unreleased/u);
});
