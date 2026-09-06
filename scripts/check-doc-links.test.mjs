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
          items: [{ text: "Image Editor", link: "/usage/image-editor" }],
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

  assert.deepEqual(targets, ["/guide/", "/guide/setup", "/usage/image-editor"]);
});

test("finds pages that are outside the configured documentation graph", () => {
  const pages = [
    "apps/docs/index.md",
    "apps/docs/guide/index.md",
    "apps/docs/guide/setup.md",
    "apps/docs/guide/details.md",
    "apps/docs/orphan.md",
  ];
  const contents = new Map([
    ["apps/docs/index.md", "[Guide](/guide/)"],
    ["apps/docs/guide/index.md", "[Setup](./setup)"],
    ["apps/docs/guide/setup.md", "[Details](./details.md)"],
    ["apps/docs/guide/details.md", "Done"],
    ["apps/docs/orphan.md", "Not linked"],
  ]);

  assert.deepEqual(
    unreachableDocumentationPages(
      repositoryRoot,
      pages,
      ["/guide/"],
      (file) => contents.get(file) ?? "",
    ),
    ["apps/docs/orphan.md"],
  );
});
