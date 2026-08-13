import assert from "node:assert/strict";
import path from "node:path";
import test from "node:test";
import { pathToFileURL } from "node:url";

import {
  configuredNavigationTargets,
  localDocumentationTargetExists,
  repositoryRoot,
  unreachableDocumentationPages,
} from "./check-doc-links.mjs";

test("collects nested VitePress nav and sidebar links once", () => {
  const targets = configuredNavigationTargets({
    themeConfig: {
      nav: [
        { text: "Guide", link: "/guide/" },
        {
          text: "More",
          items: [{ text: "Studio", link: "/usage/studio" }],
        },
      ],
      sidebar: {
        "/guide/": [
          {
            text: "Guide",
            items: [
              { text: "Guide", link: "/guide/" },
              { text: "Setup", link: "/guide/setup" },
            ],
          },
        ],
      },
    },
  });

  assert.deepEqual(targets, ["/guide/", "/guide/setup", "/usage/studio"]);
});

test("every configured local VitePress navigation target resolves", async () => {
  const configFile = "docs-site/.vitepress/config.ts";
  const config = (
    await import(pathToFileURL(path.join(repositoryRoot, configFile)).href)
  ).default;
  const missing = configuredNavigationTargets(config).filter(
    (target) =>
      !localDocumentationTargetExists(repositoryRoot, configFile, target),
  );
  assert.deepEqual(missing, []);
});

test("finds pages that are outside the configured documentation graph", () => {
  const pages = [
    "docs-site/index.md",
    "docs-site/guide/index.md",
    "docs-site/guide/setup.md",
    "docs-site/guide/details.md",
    "docs-site/orphan.md",
  ];
  const contents = new Map([
    ["docs-site/index.md", "[Guide](/guide/)"],
    ["docs-site/guide/index.md", "[Setup](./setup)"],
    ["docs-site/guide/setup.md", "[Details](./details.md)"],
    ["docs-site/guide/details.md", "Done"],
    ["docs-site/orphan.md", "Not linked"],
  ]);

  assert.deepEqual(
    unreachableDocumentationPages(
      repositoryRoot,
      pages,
      ["/guide/"],
      (file) => contents.get(file) ?? "",
    ),
    ["docs-site/orphan.md"],
  );
});
