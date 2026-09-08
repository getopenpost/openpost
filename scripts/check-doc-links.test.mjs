import assert from "node:assert/strict";
import { mkdir, mkdtemp, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { pathToFileURL } from "node:url";

import {
  configuredNavigationTargets,
  fumadocsNavigationTargets,
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

test("validates Fumadocs meta navigation and MDX link reachability", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "openpost-doc-links-"));
  const docs = path.join(root, "apps/docs/content/docs");
  await mkdir(path.join(docs, "guides"), { recursive: true });
  await writeFile(path.join(docs, "meta.json"), JSON.stringify({ pages: ["index", "guides"] }));
  await writeFile(path.join(docs, "index.mdx"), "[Quickstart](/guides/quickstart)");
  await writeFile(
    path.join(docs, "guides", "meta.json"),
    JSON.stringify({ pages: ["quickstart"] }),
  );
  await writeFile(path.join(docs, "guides", "quickstart.mdx"), "Done");

  assert.deepEqual(fumadocsNavigationTargets(root), ["/", "/guides", "/guides/quickstart"]);
  assert.equal(
    localDocumentationTargetExists(root, "apps/docs/content/docs/index.mdx", "/guides/missing"),
    false,
  );
  assert.deepEqual(
    unreachableDocumentationPages(
      root,
      ["apps/docs/content/docs/index.mdx", "apps/docs/content/docs/guides/quickstart.mdx"],
      ["/", "/guides", "/guides/quickstart"],
    ),
    [],
  );
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
