import assert from "node:assert/strict";
import { mkdtemp, mkdir, readFile, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import { composePublicSite, scopeDocsHeaders, scopeDocsRedirects } from "./compose-public-site.mjs";

test("scopes documentation redirects without changing external targets", () => {
  assert.equal(
    scopeDocsRedirects(
      "/guides/old /guides/new 301\n/development https://github.com/getopenpost/openpost 301\n",
    ),
    "/docs/guides/old /docs/guides/new 301\n/docs/development https://github.com/getopenpost/openpost 301\n",
  );
});

test("scopes documentation header paths exactly once", () => {
  assert.equal(
    scopeDocsHeaders(
      "/*.md\n  Content-Type: text/markdown\n/docs/guides/quickstart\n  Vary: Accept\n",
    ),
    "/docs/*.md\n  Content-Type: text/markdown\n/docs/guides/quickstart\n  Vary: Accept\n",
  );
});

test("composes both builds and keeps control files at the deployment root", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "openpost-public-site-"));
  const marketing = path.join(root, "marketing");
  const docs = path.join(root, "documentation");
  const output = path.join(root, "output");
  await Promise.all([mkdir(marketing), mkdir(docs)]);
  await Promise.all([
    writeFile(path.join(marketing, "index.html"), "marketing"),
    writeFile(path.join(marketing, "_headers"), "/\n  Vary: Accept\n"),
    writeFile(path.join(marketing, "_redirects"), "/features /#features 301\n"),
    writeFile(path.join(docs, "index.html"), "documentation"),
    writeFile(path.join(docs, "_headers"), "/api/search\n  Content-Type: application/json\n"),
    writeFile(path.join(docs, "_redirects"), "/usage /guides/quickstart 301\n"),
  ]);

  await composePublicSite({
    marketingDirectory: marketing,
    docsDirectory: docs,
    outputDirectory: output,
  });

  assert.equal(await readFile(path.join(output, "index.html"), "utf8"), "marketing");
  assert.equal(await readFile(path.join(output, "docs/index.html"), "utf8"), "documentation");
  assert.match(await readFile(path.join(output, "_headers"), "utf8"), /\/docs\/api\/search/u);
  assert.match(
    await readFile(path.join(output, "_redirects"), "utf8"),
    /\/docs\/usage \/docs\/guides\/quickstart 301/u,
  );
  await assert.rejects(readFile(path.join(output, "docs/_headers"), "utf8"), /ENOENT/u);
});

test("rejects a marketing route that collides with the docs mount", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "openpost-public-site-collision-"));
  const marketing = path.join(root, "marketing");
  const docs = path.join(root, "documentation");
  await Promise.all([mkdir(path.join(marketing, "docs"), { recursive: true }), mkdir(docs)]);

  await assert.rejects(
    composePublicSite({
      marketingDirectory: marketing,
      docsDirectory: docs,
      outputDirectory: root,
    }),
    /marketing output already owns \/docs/u,
  );
});
