import assert from "node:assert/strict";
import { execFileSync, spawn } from "node:child_process";
import { mkdtemp, readFile, readdir, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import { parse } from "parse5";
import { docsSocialEntries, marketingRouteManifest } from "../packages/social-images/src/index.js";
import { comparisonEvidenceRegister } from "../marketing-site/src/routes/_comparison-evidence.ts";
import { comparisons, featureGroups, platforms } from "../marketing-site/src/routes/_marketing.ts";
import {
  generateAgentSurface,
  productionProjections,
  renderOriginVaryHeaders,
} from "./generate-agent-surfaces.mjs";
import centralFeatureEvidence from "./public-central-feature-evidence.json" with { type: "json" };
import noJavaScriptEvidence from "./public-no-javascript-evidence.json" with { type: "json" };

async function runRootTask(root, arguments_, environment = {}) {
  await new Promise((resolve, reject) => {
    const child = spawn("bun", ["run", ...arguments_], {
      cwd: root,
      env: { ...process.env, ...environment },
      stdio: "inherit",
    });
    child.once("error", reject);
    child.once("exit", (code) =>
      code === 0 ? resolve() : reject(new Error(`bun run ${arguments_.join(" ")} exited ${code}`)),
    );
  });
}

let productionBuildPromise;

function ensureProductionBuilds(root) {
  productionBuildPromise ??= (async () => {
    await runRootTask(root, ["build", "--", "marketing"], { TURBO_FORCE: "true" });
    await runRootTask(root, ["build", "--", "docs"], { TURBO_FORCE: "true" });
  })();
  return productionBuildPromise;
}

async function fixtureDirectory() {
  return mkdtemp(path.join(os.tmpdir(), "openpost-agent-surface-"));
}

test("origin Vary headers cover only canonical HTML and explicit Markdown within Pages limits", () => {
  const base = [
    "/*.md",
    "  Content-Type: text/markdown; charset=utf-8",
    "  Vary: Accept",
    "/llms.txt",
    "  Content-Type: text/plain; charset=utf-8",
    "",
  ].join("\n");
  const pages = [
    { canonical: "https://openpost.social/" },
    { canonical: "https://openpost.social/features" },
  ];
  const rendered = renderOriginVaryHeaders(base, pages);

  assert.match(
    rendered,
    /\/\*\.md\n  Content-Type: text\/markdown; charset=utf-8\n  Vary: Accept/u,
  );
  assert.match(rendered, /\n\/\n  Vary: Accept\n/u);
  assert.match(rendered, /\n\/features\n  Vary: Accept\n/u);
  assert.doesNotMatch(rendered, /\/assets|\/unknown/u);
  assert.equal(renderOriginVaryHeaders(rendered, pages), rendered);

  assert.throws(
    () =>
      renderOriginVaryHeaders(
        base,
        Array.from({ length: 99 }, (_, index) => ({
          canonical: `https://openpost.social/page-${index}`,
        })),
      ),
    /uses 101 rules; Free limit is 100/u,
  );
});

async function filesWithSuffix(directory, suffix, root = directory) {
  const files = [];
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    const pathname = path.join(directory, entry.name);
    if (entry.isDirectory()) files.push(...(await filesWithSuffix(pathname, suffix, root)));
    else if (entry.isFile() && entry.name.endsWith(suffix)) {
      files.push(path.relative(root, pathname).split(path.sep).join("/"));
    }
  }
  return files.toSorted();
}

async function artifactSnapshot(directory, relativePaths) {
  return new Map(
    await Promise.all(
      relativePaths.map(async (relativePath) => [
        relativePath,
        await readFile(path.join(directory, relativePath)),
      ]),
    ),
  );
}

async function assertArtifactSnapshot(directory, snapshot) {
  for (const [relativePath, expected] of snapshot) {
    assert.deepEqual(
      await readFile(path.join(directory, relativePath)),
      expected,
      `${relativePath} changed when its surface was generated twice from identical sources`,
    );
  }
}

function deterministicSemanticHTML(node) {
  if (node.nodeName === "#comment") {
    const comment = node.data.trim();
    const isFrameworkMarker =
      /^(?:|\$s\d+|\[-?\d*|\]|\|)$/u.test(comment) ||
      (/^[a-z0-9]{7}$/iu.test(comment) && /\d/u.test(comment));
    if (isFrameworkMarker) return undefined;
  }
  if (node.nodeName === "#comment") return { comment: node.data };
  if (node.tagName === "script") {
    const source = documentAttribute(node, "src") ?? "";
    const body = (node.childNodes ?? []).map((child) => child.value ?? "").join("");
    if (
      /\/(?:_app\/immutable|assets\/app\.)/u.test(source) ||
      /(?:__sveltekit_|__VP_HASH_MAP__|\/_app\/immutable\/)/u.test(body)
    )
      return undefined;
  }
  if (
    node.tagName === "link" &&
    ["modulepreload", "preload", "stylesheet"].includes(documentAttribute(node, "rel")) &&
    /(?:\/_app\/immutable\/|\/assets\/(?:app|chunks\/theme|style)[.-])/u.test(
      documentAttribute(node, "href") ?? "",
    )
  )
    return undefined;
  if (node.nodeName === "#text") return { text: node.value };

  return {
    node: node.tagName ?? node.nodeName,
    attributes: (node.attrs ?? [])
      .filter(({ name }) => name !== "data-svelte-h" && !/^data-v-[0-9a-f]{8}(?:-s)?$/u.test(name))
      .map(({ name, value }) => [name, value])
      .toSorted(([left], [right]) => left.localeCompare(right)),
    children: (node.childNodes ?? [])
      .map(deterministicSemanticHTML)
      .filter((child) => child !== undefined),
    templateContent: node.content ? deterministicSemanticHTML(node.content) : undefined,
  };
}

async function semanticHTMLSnapshot(directory, relativePaths) {
  return new Map(
    await Promise.all(
      relativePaths.map(async (relativePath) => {
        const document = parse(await readFile(path.join(directory, relativePath), "utf8"));
        return [relativePath, deterministicSemanticHTML(document)];
      }),
    ),
  );
}

test("semantic HTML determinism retains maintained documents and ignores only framework runtime hashes", () => {
  const normalize = (source) => deterministicSemanticHTML(parse(source));
  const maintained = `<!doctype html><html><head>
    <link rel="stylesheet" href="/maintained.css">
    <style>.notice { color: red; }</style>
    <script type="application/ld+json">{"name":"OpenPost"}</script>
  </head><body data-v-owner="maintained"><!-- maintained note --><!--license--><!--[owner note]--><template><p>Maintained fallback</p></template></body></html>`;
  for (const [kind, changed] of [
    ["linked stylesheet", maintained.replace("/maintained.css", "/changed.css")],
    ["inline style", maintained.replace("color: red", "color: blue")],
    ["JSON-LD", maintained.replace('"OpenPost"', '"Changed"')],
    ["maintained comment", maintained.replace("maintained note", "changed note")],
    ["seven-character comment", maintained.replace("license", "credits")],
    ["bracketed comment", maintained.replace("owner note", "reviewed note")],
    ["maintained data attribute", maintained.replace("data-v-owner", "data-v-reviewer")],
    ["template fallback", maintained.replace("Maintained fallback", "Changed fallback")],
  ]) {
    assert.notDeepEqual(
      normalize(changed),
      normalize(maintained),
      `${kind} drift must be detected`,
    );
  }

  const frameworkBuildA = `${maintained}<link rel="stylesheet" href="/_app/immutable/assets/0.A.css">
    <link rel="modulepreload" href="/assets/chunks/theme.A.js">
    <!--12qhfyh--><!--$s1--><!--[0--><p data-v-0394ad82>Runtime scoped</p>
    <script src="/assets/app.A.js"></script>
    <script>window.__VP_HASH_MAP__={"index.md":"A"}</script>`;
  const frameworkBuildB = `${maintained}<link rel="stylesheet" href="/_app/immutable/assets/0.B.css">
    <link rel="modulepreload" href="/assets/chunks/theme.B.js">
    <!--1cjcgu2--><!--$s2--><!--[7--><p data-v-a3976bdc>Runtime scoped</p>
    <script src="/assets/app.B.js"></script>
    <script>window.__VP_HASH_MAP__={"index.md":"B"}</script>`;
  assert.deepEqual(normalize(frameworkBuildB), normalize(frameworkBuildA));
});

function documentDescendants(node) {
  return [node, ...(node.childNodes ?? []).flatMap(documentDescendants)];
}

function documentAttribute(node, name) {
  return node.attrs?.find((attribute) => attribute.name === name)?.value;
}

function documentText(node) {
  if (node.nodeName === "#text") return node.value ?? "";
  if (
    [
      "button",
      "form",
      "input",
      "nav",
      "script",
      "select",
      "style",
      "template",
      "textarea",
    ].includes(node.tagName)
  )
    return "";
  return (node.childNodes ?? []).map(documentText).join("");
}

function productionHTMLContract(
  source,
  { canonical, description: expectedDescription, evidence, title, home = false },
) {
  const document = parse(source);
  const nodes = documentDescendants(document);
  const head = nodes.find((node) => node.tagName === "head");
  const headNodes = documentDescendants(head);
  const content = nodes.find(
    (node) =>
      node.tagName === "main" ||
      (home && documentAttribute(node, "class")?.split(/\s+/u).includes("VPHome")),
  );
  const contentNodes = documentDescendants(content);
  const canonicalLink = headNodes.find(
    (node) => node.tagName === "link" && documentAttribute(node, "rel") === "canonical",
  );
  const description = headNodes.find(
    (node) => node.tagName === "meta" && documentAttribute(node, "name") === "description",
  );
  const contentText = documentText(content).replace(/\s+/gu, " ").trim();
  const expectedSummary = expectedDescription.replace(/\s+/gu, " ").trim();
  const metadataDescription = documentAttribute(description, "content")
    ?.replace(/\s+/gu, " ")
    .trim();

  assert.equal(
    documentText(headNodes.find((node) => node.tagName === "title")),
    title,
    `${canonical} must keep its canonical title before hydration`,
  );
  assert.equal(
    metadataDescription,
    expectedSummary,
    `${canonical} must keep its owner-reviewed summary in HTML metadata before hydration`,
  );
  assert.equal(documentAttribute(canonicalLink, "href"), canonical);
  const headings = contentNodes.filter((node) => node.tagName === "h1");
  assert.equal(headings.length, 1, `${canonical} must expose one H1 before hydration`);
  assert.ok(
    documentText(headings[0]).replace(/\s+/gu, " ").trim(),
    `${canonical} must explain what the page is before hydration`,
  );
  assert.ok(
    contentText.includes(evidence.audience),
    `${canonical} must visibly identify who the page serves before hydration`,
  );
  assert.ok(
    contentNodes.filter(
      (node) =>
        ["dd", "li", "p", "td"].includes(node.tagName) &&
        documentText(node).replace(/\s+/gu, " ").trim().length >= 40,
    ).length >= 2,
    `${canonical} must visibly explain what the page provides before hydration`,
  );
  assert.ok(
    contentText.includes(evidence.boundary),
    `${canonical} must visibly state an important limit or boundary before hydration`,
  );
  assert.ok(
    contentText.length >= 300,
    `${canonical} must provide substantive guidance and important limits before hydration`,
  );
  assert.ok(
    contentNodes.some(
      (node) =>
        node.tagName === "a" &&
        documentAttribute(node, "href") &&
        documentText(node).replace(/\s+/gu, " ").trim(),
    ),
    `${canonical} must provide a public continuation before hydration`,
  );
  return { headNodes };
}

function legalTextChunks(html) {
  const ignored = new Set(["script", "style", "nav", "button", "svg"]);
  function visit(node, excluded = false) {
    const attributes = new Map((node.attrs ?? []).map((entry) => [entry.name, entry.value]));
    const hidden =
      excluded ||
      ignored.has(node.tagName) ||
      attributes.get("aria-hidden") === "true" ||
      attributes.has("data-agent-exclude");
    if (node.nodeName === "#text" && !hidden) {
      const value = (node.value ?? "").replace(/\s+/gu, " ").trim();
      return value ? [value] : [];
    }
    return (node.childNodes ?? []).flatMap((child) => visit(child, hidden));
  }
  const document = parse(html);
  const nodes = [document];
  let main;
  while (nodes.length > 0 && !main) {
    const node = nodes.shift();
    if (node.tagName === "main") main = node;
    nodes.push(...(node.childNodes ?? []));
  }
  return visit(main ?? document);
}

function markdownPlainText(markdown) {
  return markdown
    .replace(/^<!--.*-->$/gmu, "")
    .replace(/!?(\[([^\]]+)\])\([^)]+\)/gu, "$2")
    .replace(/[*`]/gu, "")
    .replace(/^[#>|-]+\s*/gmu, "")
    .replace(/\s+/gu, " ")
    .trim();
}

function markdownOutsideFences(markdown) {
  let fenced = false;
  return markdown
    .split("\n")
    .filter((line) => {
      if (/^\s*(?:```|~~~)/u.test(line)) {
        fenced = !fenced;
        return false;
      }
      return !fenced;
    })
    .join("\n");
}

const marketingHTML = `<!doctype html>
<html><head>
<title>OpenPost - Social publishing</title>
<meta name="description" content="Create, adapt, and publish from one workspace.">
<link rel="canonical" href="https://openpost.social">
<link rel="alternate" type="text/markdown" href="https://openpost.social/index.md">
<link rel="alternate" type="text/plain" href="https://openpost.social/llms.txt">
</head><body><nav>Navigation noise</nav><main>
<h1>Publish everywhere</h1><p>Prepare one idea for every destination.</p>
<a href="/features">See the features</a><script>privateState = true</script>
</main></body></html>`;

test("marketing production projection emits deterministic homepage Markdown and discovery", async () => {
  const directory = await fixtureDirectory();
  const htmlPath = path.join(directory, "index.html");
  await writeFile(htmlPath, marketingHTML);

  const projection = {
    surface: "marketing",
    outputDirectory: directory,
    pages: [{ sourcePath: htmlPath, outputPath: "index.md" }],
    knownCanonicalURLs: ["https://openpost.social/", "https://openpost.social/features"],
    discovery: {
      title: "OpenPost",
      description: "Create, adapt, and publish from one workspace.",
      links: [
        {
          title: "OpenPost overview",
          description: "See the product workflow.",
          url: "https://openpost.social/index.md",
        },
      ],
    },
  };

  await generateAgentSurface(projection);
  const firstMarkdown = await readFile(path.join(directory, "index.md"), "utf8");
  const firstDiscovery = await readFile(path.join(directory, "llms.txt"), "utf8");
  await generateAgentSurface(projection);

  assert.equal(await readFile(path.join(directory, "index.md"), "utf8"), firstMarkdown);
  assert.equal(await readFile(path.join(directory, "llms.txt"), "utf8"), firstDiscovery);
  assert.match(firstMarkdown, /^<!-- Generated from the canonical OpenPost public page/m);
  assert.match(firstMarkdown, /^Title: OpenPost - Social publishing$/m);
  assert.match(firstMarkdown, /^Description: Create, adapt, and publish from one workspace\.$/m);
  assert.match(firstMarkdown, /^Canonical: https:\/\/openpost\.social\/$/m);
  assert.match(firstMarkdown, /^Source: \[https:\/\/openpost\.social\/\]/m);
  assert.equal((firstMarkdown.match(/^# /gm) ?? []).length, 1);
  assert.match(firstMarkdown, /^# Publish everywhere$/m);
  assert.match(firstMarkdown, /\[See the features\]\(https:\/\/openpost\.social\/features\)/);
  assert.doesNotMatch(firstMarkdown, /Navigation noise|privateState/);
  assert.match(firstDiscovery, /^# OpenPost$/m);
  assert.match(firstDiscovery, /\[OpenPost overview\]\(https:\/\/openpost\.social\/index\.md\)/);
});

test("marketing production projection covers every eligible route from canonical metadata", () => {
  const representedRoutes = marketingRouteManifest;
  assert.ok(representedRoutes.length > 1);
  assert.deepEqual(
    productionProjections.marketing.pages.map((page) => page.route.path),
    representedRoutes.map((route) => route.path),
  );
  assert.equal(
    new Set(productionProjections.marketing.pages.map((page) => page.outputPath)).size,
    representedRoutes.length,
  );
  for (const route of representedRoutes) {
    assert.match(route.agentDiscovery.membership, /^(?:primary|optional|unlisted)$/u);
  }
});

test("documentation production projection covers every ordinary catalog page", () => {
  const eligible = docsSocialEntries.filter(
    (entry) => entry.agentRepresentation.membership === "ordinary",
  );
  assert.deepEqual(
    productionProjections.documentation.pages.map((page) => page.page),
    eligible.map((entry) => entry.page),
  );
  assert.equal(
    new Set(productionProjections.documentation.pages.map((page) => page.outputPath)).size,
    eligible.length,
  );
  for (const page of productionProjections.documentation.pages) {
    assert.equal(page.outputPath, page.page);
    assert.equal(page.route, page.catalog.route);
    assert.equal(page.title, page.catalog.socialTitle);
    assert.equal(page.description, page.catalog.description);
  }
});

test("API reference keeps its interactive viewer and publishes maintained no-JavaScript content", async () => {
  const root = path.resolve(import.meta.dirname, "..");
  const source = await readFile(path.join(root, "docs-site/development/api-reference.md"), "utf8");
  const entry = docsSocialEntries.find(
    (candidate) => candidate.page === "development/api-reference.md",
  );

  assert.equal(entry?.agentRepresentation.membership, "ordinary");
  assert.ok(
    productionProjections.documentation.pages.some(
      (page) => page.page === "development/api-reference.md",
    ),
  );
  assert.match(source, /^# API Reference$/m);
  assert.match(source, /\[authoritative OpenAPI JSON\]\(\/openapi\.json\)/u);
  assert.match(source, /<ClientOnly>[\s\S]*<OASpec hideBranding \/>[\s\S]*<\/ClientOnly>/u);
});

test(
  "marketing production artifacts preserve every browser tool explanation without controls",
  { timeout: 180_000 },
  async () => {
    const root = path.resolve(import.meta.dirname, "..");
    await ensureProductionBuilds(root);
    const outputDirectory = path.join(root, "marketing-site/dist");
    const discovery = await readFile(path.join(outputDirectory, "llms.txt"), "utf8");
    const routes = marketingRouteManifest.filter((entry) => entry.kind === "tool");

    assert.equal(routes.length, 8);
    assert.match(discovery, /^## Optional browser tools$/m);
    for (const route of routes) {
      const relative = route.path.slice(1);
      const html = await readFile(path.join(outputDirectory, `${relative}.html`), "utf8");
      const markdown = await readFile(path.join(outputDirectory, `${relative}.md`), "utf8");

      assert.match(html, /data-agent-exclude="interactive-tool"/u);
      assert.match(markdown, /^## Who this is for$/m);
      assert.match(markdown, /^## Inputs$/m);
      assert.match(markdown, /^## Outputs$/m);
      assert.match(markdown, /^## Limits$/m);
      assert.match(markdown, /^## Privacy$/m);
      assert.match(markdown, /^## Next step$/m);
      assert.doesNotMatch(
        markdown,
        /<(?:textarea|select|button)|data-sveltekit|onclick|Example dates use next week/u,
      );
      assert.match(discovery, new RegExp(`\\(${route.canonical.replaceAll(".", "\\.")}\\.md\\)`));
    }

    const video = await readFile(
      path.join(outputDirectory, "tools/social-media-video-editor.md"),
      "utf8",
    );
    const image = await readFile(
      path.join(outputDirectory, "tools/social-media-image-editor.md"),
      "utf8",
    );
    for (const editor of [video, image]) {
      assert.match(editor, /This page describes the editor/u);
      assert.match(editor, /guest editor/u);
      assert.doesNotMatch(editor, /One timeline, four frames|No account or watermark/u);
    }
  },
);

test("marketing projection rejects unsupported meaning-bearing markup with the route", async () => {
  const directory = await fixtureDirectory();
  const htmlPath = path.join(directory, "security.html");
  await writeFile(
    htmlPath,
    marketingHTML.replace(
      "<p>Prepare one idea for every destination.</p>",
      "<product-claim>Provider approval is required.</product-claim>",
    ),
  );

  await assert.rejects(
    generateAgentSurface({
      surface: "marketing",
      outputDirectory: directory,
      pages: [{ sourcePath: htmlPath, outputPath: "index.md" }],
      discovery: { title: "OpenPost", description: "Security.", links: [] },
    }),
    /https:\/\/openpost\.social\/: unsupported meaning-bearing <product-claim>/u,
  );
});

test("marketing projection enforces the individual representation size ceiling", async () => {
  const directory = await fixtureDirectory();
  const htmlPath = path.join(directory, "index.html");
  await writeFile(
    htmlPath,
    marketingHTML.replace("Prepare one idea for every destination.", "A".repeat(256 * 1024)),
  );

  await assert.rejects(
    generateAgentSurface({
      surface: "marketing",
      outputDirectory: directory,
      pages: [{ sourcePath: htmlPath, outputPath: "index.md" }],
      discovery: { title: "OpenPost", description: "Overview.", links: [] },
    }),
    /https:\/\/openpost\.social\/: representation exceeds 256 KiB/u,
  );
});

test("documentation size exceptions require reviewed canonical metadata", async () => {
  const directory = await fixtureDirectory();
  const sourcePath = path.join(directory, "large.md.source");
  await writeFile(sourcePath, `# Large guide\n\n${"A".repeat(256 * 1024)}\n`);
  const page = {
    sourcePath,
    outputPath: "large.md",
    canonical: "https://docs.openpost.social/development/large-guide",
    title: "Large guide",
    description: "A deliberately large reviewed guide.",
  };
  const projection = {
    surface: "documentation",
    outputDirectory: directory,
    pages: [page],
    discovery: { title: "Documentation", description: "OpenPost documentation.", links: [] },
  };

  await assert.rejects(
    generateAgentSurface(projection),
    /large-guide: representation exceeds 256 KiB without a reviewed exception/u,
  );
  await assert.rejects(
    generateAgentSurface({
      ...projection,
      pages: [
        {
          ...page,
          catalog: {
            agentRepresentation: { membership: "ordinary", sizeException: { reviewed: false } },
          },
        },
      ],
    }),
    /large-guide: representation exceeds 256 KiB without a reviewed exception/u,
  );
  await generateAgentSurface({
    ...projection,
    pages: [
      {
        ...page,
        catalog: {
          agentRepresentation: {
            membership: "ordinary",
            sizeException: {
              reviewed: true,
              reason: "The guide is one maintained semantic unit.",
            },
          },
        },
      },
    ],
  });
  assert.ok(Buffer.byteLength(await readFile(path.join(directory, "large.md"))) > 256 * 1024);
});

test("marketing projection rejects rendered metadata that drifts from its canonical route", async () => {
  const directory = await fixtureDirectory();
  const htmlPath = path.join(directory, "index.html");
  await writeFile(htmlPath, marketingHTML);

  await assert.rejects(
    generateAgentSurface({
      surface: "marketing",
      outputDirectory: directory,
      pages: [
        {
          sourcePath: htmlPath,
          outputPath: "index.md",
          route: {
            path: "/",
            title: "Canonical OpenPost title",
            description: "Canonical OpenPost description.",
            canonical: "https://openpost.social/",
          },
        },
      ],
      discovery: { title: "OpenPost", description: "Overview.", links: [] },
    }),
    /https:\/\/openpost\.social\/: rendered title does not match canonical route metadata/u,
  );
});

test("marketing projection preserves tables and informative images with absolute URLs", async () => {
  const directory = await fixtureDirectory();
  const htmlPath = path.join(directory, "index.html");
  await writeFile(
    htmlPath,
    marketingHTML.replace(
      "<script>privateState = true</script>",
      `<table><thead><tr><th>Plan</th><th>Price</th></tr></thead>
<tbody><tr><td>Starter</td><td>$15</td></tr></tbody></table>
<ul>
  <li>One workspace</li>
  <li>Three accounts</li>
</ul>
<img src="/proof.png" alt="OpenPost publishing result">
<img src="/decoration.svg" alt="">
<script>privateState = true</script>`,
    ),
  );

  await generateAgentSurface({
    surface: "marketing",
    outputDirectory: directory,
    pages: [{ sourcePath: htmlPath, outputPath: "index.md" }],
    discovery: { title: "OpenPost", description: "Overview.", links: [] },
  });
  const markdown = await readFile(path.join(directory, "index.md"), "utf8");
  assert.match(markdown, /\| Plan \| Price \|\n\| --- \| --- \|\n\| Starter \| \$15 \|/u);
  assert.match(markdown, /- One workspace\n- Three accounts/u);
  assert.match(
    markdown,
    /!\[OpenPost publishing result\]\(https:\/\/openpost\.social\/proof\.png\)/u,
  );
  assert.doesNotMatch(markdown, /decoration\.svg/u);
});

test("documentation production projection emits homepage Markdown from its canonical source", async () => {
  const directory = await fixtureDirectory();
  const sourcePath = path.join(directory, "index.md.source");
  await writeFile(
    sourcePath,
    `---
layout: home
hero:
  name: OpenPost
  text: Publish everywhere.
  tagline: One content workspace.
  actions:
    - text: Read the user guide
      link: /usage/
features:
  - title: Clear outcomes
    details: See what published and what needs attention.
---

::: info Managed plans
Managed plans start at $15 per month.
:::

## Choose the right docs

- [User docs](/usage/) explain the product.

\`\`\`yaml
services:
  openpost:
    image: ghcr.io/getopenpost/openpost:latest
\`\`\`
`,
  );

  await generateAgentSurface({
    surface: "documentation",
    outputDirectory: directory,
    pages: [
      {
        sourcePath,
        outputPath: "index.md",
        canonical: "https://docs.openpost.social/",
        title: "OpenPost Documentation",
        description: "OpenPost product and operating documentation.",
      },
    ],
    discovery: {
      title: "OpenPost Documentation",
      description: "OpenPost product and operating documentation.",
      links: [
        {
          title: "Documentation home",
          description: "Start with OpenPost documentation.",
          url: "https://docs.openpost.social/index.md",
        },
      ],
    },
  });

  const markdown = await readFile(path.join(directory, "index.md"), "utf8");
  assert.equal((markdown.match(/^# /gm) ?? []).length, 1);
  assert.match(markdown, /^# OpenPost$/m);
  assert.match(markdown, /^Publish everywhere\.$/m);
  assert.match(markdown, /^## Clear outcomes$/m);
  assert.match(markdown, /\[Read the user guide\]\(https:\/\/docs\.openpost\.social\/usage\/\)/);
  assert.match(markdown, /^> \*\*Managed plans\*\*$/m);
  assert.match(markdown, /\[User docs\]\(https:\/\/docs\.openpost\.social\/usage\/\)/);
  assert.match(markdown, /^  openpost:\n    image: ghcr\.io\/getopenpost\/openpost:latest$/m);
});

test("documentation projection keeps one canonical heading for an ordinary source page", async () => {
  const directory = await fixtureDirectory();
  const sourcePath = path.join(directory, "accounts.md");
  await writeFile(
    sourcePath,
    "# Accounts\n\nConnect each destination account to the current workspace. [Open settings](https://app.openpost.social/settings).\n\n```md\n# Keep this shell comment.\n[Literal example](/kept-relative)\n```\n",
  );
  await generateAgentSurface({
    surface: "documentation",
    outputDirectory: directory,
    pages: [
      {
        sourcePath,
        outputPath: "accounts.md",
        canonical: "https://docs.openpost.social/usage/accounts",
        title: "Accounts",
        description: "Connect social accounts to OpenPost.",
      },
    ],
    discovery: {
      title: "OpenPost Documentation",
      description: "OpenPost product and operating documentation.",
      links: [],
    },
  });
  const markdown = await readFile(path.join(directory, "accounts.md"), "utf8");
  assert.equal((markdown.match(/^# Accounts$/gmu) ?? []).length, 1);
  assert.match(markdown, /^# Accounts$/mu);
  assert.match(markdown, /^# Keep this shell comment\.$/mu);
  assert.match(markdown, /\[Literal example\]\(\/kept-relative\)/u);
  assert.match(markdown, /Open settings/u);
  assert.doesNotMatch(markdown, /app\.openpost\.social/u);
});

test("documentation projection expands controlled includes from the owning source", async () => {
  const directory = await fixtureDirectory();
  const sourcePath = path.join(directory, "installation.md.source");
  const includePath = path.join(directory, "module.md");
  await writeFile(
    sourcePath,
    "# Installation\n\nUse the reviewed module below.\n\n<!--@include: ./module.md-->\n",
  );
  await writeFile(includePath, "## Module\n\n```nix\nservices.openpost.enable = true;\n```\n");

  const projection = {
    surface: "documentation",
    outputDirectory: directory,
    pages: [
      {
        sourcePath,
        outputPath: "installation.md",
        canonical: "https://docs.openpost.social/installation/module",
        title: "Installation",
        description: "Install OpenPost with a reviewed module.",
      },
    ],
    discovery: {
      title: "OpenPost Documentation",
      description: "OpenPost product and operating documentation.",
      links: [],
    },
  };

  await generateAgentSurface(projection);
  const first = await readFile(path.join(directory, "installation.md"), "utf8");
  await generateAgentSurface(projection);

  assert.equal(await readFile(path.join(directory, "installation.md"), "utf8"), first);
  assert.match(first, /^## Module$/m);
  assert.match(first, /services\.openpost\.enable = true;/u);
  assert.doesNotMatch(first, /@include/u);
});

test("documentation projection normalizes supported VitePress and raw HTML constructs", async () => {
  const directory = await fixtureDirectory();
  const sourcePath = path.join(directory, "providers.md.source");
  await writeFile(
    sourcePath,
    `# Providers

::: warning Provider review
The provider must approve the application.
:::

::: details Why approval matters
Publishing stays disabled until approval is complete.
:::

::: tip
Reconnect the account after adding scopes.
:::

<section><p>Keep the <strong>provider outcome</strong> visible.</p><ul><li>Ready</li><li>Blocked</li></ul></section>

OPENPOST_INLINE_CODE_0_ remains ordinary maintained prose.
`,
  );
  const projection = {
    surface: "documentation",
    outputDirectory: directory,
    pages: [
      {
        sourcePath,
        outputPath: "providers.md",
        canonical: "https://docs.openpost.social/providers/overview",
        title: "Providers",
        description: "Review provider requirements and outcomes.",
      },
    ],
    discovery: { title: "Documentation", description: "Provider documentation.", links: [] },
  };

  await generateAgentSurface(projection);
  const markdown = await readFile(path.join(directory, "providers.md"), "utf8");
  assert.match(markdown, /^> \*\*Provider review\*\*$/m);
  assert.match(markdown, /^> \*\*Why approval matters\*\*$/m);
  assert.match(markdown, /^> \*\*Tip\*\*$/m);
  assert.match(markdown, /OPENPOST_INLINE_CODE_0_ remains ordinary maintained prose\./u);
  assert.match(markdown, /Keep the \*\*provider outcome\*\* visible\./u);
  assert.match(markdown, /- Ready\n- Blocked/u);
  assert.doesNotMatch(markdown, /:::|<section|<strong|<ul|<li/u);

  await writeFile(
    sourcePath,
    "# Providers\n\n<ProviderStatus>Approval is required.</ProviderStatus>\n",
  );
  await assert.rejects(
    generateAgentSurface(projection),
    /providers\.md\.source: unsupported meaning-bearing <providerstatus>/u,
  );

  await writeFile(sourcePath, "# Providers\n\n::: tabs\nProvider A\n::: tab Provider B\n:::\n");
  await assert.rejects(
    generateAgentSurface(projection),
    /providers\.md\.source: unsupported VitePress container ::: tabs/u,
  );
});

test("documentation full corpus groups selected pages with provenance and no repeated wrappers", async () => {
  const directory = await fixtureDirectory();
  const includedSource = path.join(directory, "accounts.md.source");
  const excludedSource = path.join(directory, "notices.md.source");
  await writeFile(
    includedSource,
    "# Accounts\n\nConnect a destination.\n\n## Review\n\nCheck access.\n",
  );
  await writeFile(excludedSource, "# Notices\n\nLegal notice body must stay separate.\n");
  const page = (overrides) => ({
    outputPath: path.basename(overrides.page),
    canonical: `https://docs.openpost.social/${overrides.page.replace(/\.md$/u, "")}`,
    title: overrides.title,
    description: `${overrides.title} documentation.`,
    ...overrides,
  });

  await generateAgentSurface({
    surface: "documentation",
    outputDirectory: directory,
    pages: [
      page({
        page: "usage/accounts.md",
        sourcePath: includedSource,
        title: "Accounts",
        catalog: { agentCorpus: { membership: "included", section: "user-guide" } },
      }),
      page({
        page: "development/notices.md",
        sourcePath: excludedSource,
        title: "Notices",
        catalog: {
          agentCorpus: { membership: "excluded", reason: "Legal text stays separate." },
        },
      }),
    ],
    corpus: { title: "OpenPost Documentation Full Corpus" },
    discovery: { title: "Documentation", description: "OpenPost documentation.", links: [] },
  });

  const corpus = await readFile(path.join(directory, "llms-full.txt"), "utf8");
  assert.match(corpus, /^# OpenPost Documentation Full Corpus$/m);
  assert.match(corpus, /OpenPost convenience artifact/u);
  assert.match(corpus, /not part of the llms\.txt v2 proposal/u);
  assert.match(corpus, /^## User guide$/m);
  assert.match(corpus, /^### Accounts$/m);
  assert.match(
    corpus,
    /^Source: \[https:\/\/docs\.openpost\.social\/usage\/accounts\]\(https:\/\/docs\.openpost\.social\/usage\/accounts\)$/m,
  );
  assert.match(corpus, /^#### Review$/m);
  assert.doesNotMatch(
    corpus,
    /Notices|Legal notice body|Generated from|^Title:|^Description:|^Canonical:/m,
  );
});

test("documentation full corpus warns above 1 MiB and fails above 2 MiB", async () => {
  const directory = await fixtureDirectory();
  const pages = [];
  for (let index = 0; index < 10; index += 1) {
    const sourcePath = path.join(directory, `large-${index}.md.source`);
    await writeFile(sourcePath, `# Large ${index}\n\n${String(index).repeat(225 * 1024)}\n`);
    pages.push({
      sourcePath,
      outputPath: `large-${index}.md`,
      canonical: `https://docs.openpost.social/development/large-${index}`,
      title: `Large ${index}`,
      description: `Large documentation page ${index}.`,
      catalog: { agentCorpus: { membership: "included", section: "development" } },
    });
  }
  const warnings = [];
  const projection = {
    surface: "documentation",
    outputDirectory: directory,
    pages: pages.slice(0, 5),
    corpus: { title: "OpenPost Documentation Full Corpus" },
    warn: (message) => warnings.push(message),
    discovery: { title: "Documentation", description: "OpenPost documentation.", links: [] },
  };

  await generateAgentSurface(projection);
  assert.equal(warnings.length, 1);
  assert.match(warnings[0], /exceeds 1 MiB/u);
  assert.ok(
    Buffer.byteLength(await readFile(path.join(directory, "llms-full.txt"))) < 2 * 1024 * 1024,
  );

  await assert.rejects(
    generateAgentSurface({ ...projection, pages }),
    /llms-full\.txt reaches or exceeds 2 MiB/u,
  );

  const exactDirectory = await fixtureDirectory();
  const exactSource = path.join(exactDirectory, "exact.md.source");
  await writeFile(exactSource, "# Exact boundary\n\nA\n");
  const exactProjection = {
    surface: "documentation",
    outputDirectory: exactDirectory,
    pages: [
      {
        sourcePath: exactSource,
        outputPath: "exact.md",
        canonical: "https://docs.openpost.social/development/exact-boundary",
        title: "Exact boundary",
        description: "Exact corpus boundary fixture.",
        catalog: {
          agentRepresentation: {
            membership: "ordinary",
            sizeException: { reviewed: true, reason: "Boundary fixture." },
          },
          agentCorpus: { membership: "included", section: "development" },
        },
      },
    ],
    corpus: { title: "OpenPost Documentation Full Corpus" },
    discovery: { title: "Documentation", description: "OpenPost documentation.", links: [] },
  };
  await generateAgentSurface(exactProjection);
  const oneByteCorpusSize = Buffer.byteLength(
    await readFile(path.join(exactDirectory, "llms-full.txt")),
  );
  const paddingBytes = 2 * 1024 * 1024 - oneByteCorpusSize;
  await writeFile(exactSource, `# Exact boundary\n\nA${"A".repeat(paddingBytes)}\n`);
  await assert.rejects(
    generateAgentSurface(exactProjection),
    /llms-full\.txt reaches or exceeds 2 MiB/u,
  );
});

test("projection validation rejects unsafe or incomplete production contracts", async () => {
  const directory = await fixtureDirectory();
  const htmlPath = path.join(directory, "index.html");
  await writeFile(htmlPath, marketingHTML);
  const base = {
    surface: "marketing",
    outputDirectory: directory,
    pages: [{ sourcePath: htmlPath, outputPath: "index.md" }],
    knownCanonicalURLs: ["https://openpost.social/", "https://openpost.social/features"],
    discovery: {
      title: "OpenPost",
      description: "Public product information.",
      links: [
        {
          title: "OpenPost overview",
          description: "Public product information.",
          url: "https://openpost.social/index.md",
        },
      ],
    },
  };

  await assert.rejects(
    generateAgentSurface({ ...base, pages: [...base.pages, ...base.pages] }),
    /duplicate output path: index\.md/,
  );
  const docsSource = path.join(directory, "duplicate-source.md");
  await writeFile(docsSource, "# Public guide\n\nOne maintained page.\n");
  await assert.rejects(
    generateAgentSurface({
      surface: "documentation",
      outputDirectory: directory,
      pages: ["first.md", "second.md"].map((outputPath) => ({
        sourcePath: docsSource,
        outputPath,
        canonical: "https://docs.openpost.social/guide",
        title: "Public guide",
        description: "One maintained page.",
      })),
      discovery: {
        title: "Documentation",
        description: "Public documentation.",
        links: [],
      },
    }),
    /duplicate canonical route: https:\/\/docs\.openpost\.social\/guide/u,
  );
  await assert.rejects(
    generateAgentSurface({
      ...base,
      discovery: {
        ...base.discovery,
        links: [{ ...base.discovery.links[0], url: "https://openpost.social/missing.md" }],
      },
    }),
    /discovery link has no generated artifact/,
  );
  await assert.rejects(
    generateAgentSurface({
      ...base,
      discovery: {
        ...base.discovery,
        links: [
          { ...base.discovery.links[0], url: "https://docs.openpost.social/does-not-exist.md" },
        ],
      },
    }),
    /discovery link has no generated artifact/,
  );
  await assert.rejects(
    generateAgentSurface({
      ...base,
      pages: [{ sourcePath: path.join(directory, "absent.html"), outputPath: "index.md" }],
    }),
    /missing canonical source/,
  );
  await assert.rejects(
    generateAgentSurface({
      ...base,
      discovery: {
        ...base.discovery,
        links: [{ ...base.discovery.links[0], url: "https://app.openpost.social/publications.md" }],
      },
    }),
    /private application route/,
  );
  await assert.rejects(
    generateAgentSurface({
      ...base,
      discovery: {
        ...base.discovery,
        links: [{ ...base.discovery.links[0], url: "https://app.openpost.social/workspaces" }],
      },
    }),
    /private application route/,
  );

  await writeFile(
    docsSource,
    "# Public guide\n\nUseful public instructions. data-sveltekit-fetched={workspace: privateState}\n",
  );
  await assert.rejects(
    generateAgentSurface({
      surface: "documentation",
      outputDirectory: directory,
      pages: [
        {
          sourcePath: docsSource,
          outputPath: "guide.md",
          canonical: "https://docs.openpost.social/guide",
          title: "Public guide",
          description: "Useful public instructions.",
        },
      ],
      discovery: {
        title: "Documentation",
        description: "Public documentation.",
        links: [],
      },
    }),
    /https:\/\/docs\.openpost\.social\/guide: generated representation contains serialized application state/u,
  );

  await writeFile(
    htmlPath,
    marketingHTML.replace(
      '<a href="/features">See the features</a>',
      '<a href="/missing">Missing page</a>',
    ),
  );
  await assert.rejects(
    generateAgentSurface(base),
    /https:\/\/openpost\.social\/: broken internal link.*\/missing/u,
  );

  await writeFile(
    htmlPath,
    marketingHTML.replace(
      '<a href="/features">See the features</a>',
      '<a href="https://docs.openpost.social/does-not-exist">Missing docs page</a>',
    ),
  );
  await assert.rejects(
    generateAgentSurface({
      ...base,
      knownCanonicalURLs: [...base.knownCanonicalURLs, "https://docs.openpost.social/usage/"],
    }),
    /https:\/\/openpost\.social\/: broken internal link.*docs\.openpost\.social\/does-not-exist/u,
  );

  await writeFile(
    htmlPath,
    marketingHTML.replace(
      '<a href="/features">See the features</a>',
      '<a href="#missing-section">Missing section</a>',
    ),
  );
  await assert.rejects(
    generateAgentSurface(base),
    /https:\/\/openpost\.social\/: broken internal fragment #missing-section/u,
  );

  const featuresPath = path.join(directory, "features.html");
  await writeFile(featuresPath, '<main><h1 id="present">Features</h1></main>');
  await writeFile(
    htmlPath,
    marketingHTML.replace(
      '<a href="/features">See the features</a>',
      '<a href="/features#missing-section">Missing feature section</a>',
    ),
  );
  await assert.rejects(
    generateAgentSurface({
      ...base,
      fragmentSources: [
        { canonical: "https://openpost.social/features", sourcePath: featuresPath },
      ],
    }),
    /https:\/\/openpost\.social\/: broken internal fragment #missing-section/u,
  );

  await writeFile(
    htmlPath,
    marketingHTML.replace(
      '<a href="/features">See the features</a>',
      "<canvas>Important chart</canvas>",
    ),
  );
  await assert.rejects(
    generateAgentSurface(base),
    /https:\/\/openpost\.social\/: unsupported meaning-bearing <canvas>/u,
  );
});

test(
  "both production builds emit canonical homepage artifacts and discovery",
  { timeout: 180_000 },
  async () => {
    const root = path.resolve(import.meta.dirname, "..");
    const eligibleCanonicals = [
      ...marketingRouteManifest.map((route) => route.canonical),
      ...docsSocialEntries
        .filter((entry) => entry.agentRepresentation.membership === "ordinary")
        .map((entry) => entry.canonical),
    ].toSorted();
    assert.deepEqual(
      Object.keys(noJavaScriptEvidence).toSorted(),
      eligibleCanonicals,
      "the reviewed no-JavaScript evidence contract must own every eligible route exactly once",
    );
    for (const [canonical, evidence] of Object.entries(noJavaScriptEvidence)) {
      assert.notEqual(
        evidence.audience,
        evidence.boundary,
        `${canonical} must use distinct evidence for its audience and boundary`,
      );
    }
    const turboPlan = JSON.parse(
      execFileSync(
        "bunx",
        [
          "turbo",
          "run",
          "build",
          "--dry=json",
          "--filter=@openpost/site",
          "--filter=@openpost/docs",
        ],
        { cwd: root, encoding: "utf8" },
      ),
    );
    const plannedTasks = new Map(turboPlan.tasks.map((task) => [task.taskId, task]));
    const publicBuilds = [
      ["marketing", "@openpost/site#build", "dist/**"],
      ["documentation", "@openpost/docs#build", ".vitepress/dist/**"],
    ];
    for (const [surface, taskID, output] of publicBuilds) {
      const task = plannedTasks.get(taskID);
      assert.ok(
        Object.keys(task.inputs).includes("../scripts/generate-agent-surfaces.mjs"),
        `${surface} cache key must include the shared generator`,
      );
      assert.ok(
        task.outputs.includes(output),
        `${surface} cache must restore the complete public artifact`,
      );
      assert.ok(
        task.dependencies.includes("@openpost/social-images#check"),
        `${surface} build must follow the shared route catalogue check`,
      );
    }

    const marketingLayout = await readFile(
      path.join(root, "marketing-site/src/routes/+layout.svelte"),
      "utf8",
    );
    assert.match(marketingLayout, /marketingAgentMarkdownUrl/u);
    assert.match(marketingLayout, /rel="alternate" type="text\/markdown" href=\{agentMarkdown\}/u);
    assert.match(
      marketingLayout,
      /rel="alternate"[\s\S]{0,80}type="text\/plain"[\s\S]{0,80}href="https:\/\/openpost\.social\/llms\.txt"/,
    );

    const docsConfig = await readFile(path.join(root, "docs-site/.vitepress/config.ts"), "utf8");
    assert.match(docsConfig, /type: "text\/markdown"/);
    assert.match(docsConfig, /new URL\(agentPage\.page, `\$\{docsSiteUrl\}\/`\)\.href/u);
    assert.match(docsConfig, /type: "text\/plain"/);
    assert.match(docsConfig, /href: `\$\{docsSiteUrl\}\/llms\.txt`/);
    assert.match(docsConfig, /href: `\$\{docsSiteUrl\}\/llms-full\.txt`/);

    await ensureProductionBuilds(root);

    for (const [surface, headersPath, canonicalPaths, plainTextPaths] of [
      [
        "marketing",
        path.join(root, "marketing-site/dist/_headers"),
        marketingRouteManifest
          .filter((route) =>
            ["static", "platform", "comparison", "tool"].includes(route.agentRepresentation),
          )
          .map((route) => new URL(route.canonical).pathname),
        ["/llms.txt"],
      ],
      [
        "documentation",
        path.join(root, "docs-site/.vitepress/dist/_headers"),
        docsSocialEntries.map((entry) => new URL(entry.canonical).pathname),
        ["/llms.txt", "/llms-full.txt"],
      ],
    ]) {
      const headers = await readFile(headersPath, "utf8");
      assert.match(
        headers,
        /\/\*\.md\n  Content-Type: text\/markdown; charset=utf-8\n  Vary: Accept/u,
        `${surface} Markdown artifacts must vary at the origin`,
      );
      for (const pathname of plainTextPaths) {
        assert.ok(
          headers.includes(`${pathname}\n  Content-Type: text/plain; charset=utf-8`),
          `${surface} must keep ${pathname} plain text`,
        );
      }
      for (const pathname of canonicalPaths) {
        assert.ok(
          headers.includes(`${pathname}\n  Vary: Accept`),
          `${surface} must vary canonical ${pathname} at the origin`,
        );
      }
      assert.ok(
        headers.split("\n").filter((line) => line && !/^\s/u.test(line) && !line.startsWith("#"))
          .length <= 100,
        `${surface} must stay within the Pages _headers Free limit`,
      );
      assert.ok(
        headers.split("\n").every((line) => line.length <= 2000),
        `${surface} must stay within the Pages _headers line limit`,
      );
      assert.doesNotMatch(headers, /\n\/assets(?:\/|\*)|\n\/unknown/u);
    }

    for (const production of [
      {
        directory: path.join(root, "marketing-site/dist"),
        canonical: "https://openpost.social/",
        discoveryTarget: "https://openpost.social/index.md",
      },
      {
        directory: path.join(root, "docs-site/.vitepress/dist"),
        canonical: "https://docs.openpost.social",
        discoveryTarget: "https://docs.openpost.social/index.md",
      },
    ]) {
      const markdown = await readFile(path.join(production.directory, "index.md"), "utf8");
      const discovery = await readFile(path.join(production.directory, "llms.txt"), "utf8");
      assert.match(markdown, /^<!-- Generated from the canonical OpenPost public page/m);
      assert.match(
        markdown,
        new RegExp(`^Canonical: ${production.canonical.replaceAll(".", "\\.")}$`, "m"),
      );
      assert.equal((markdown.match(/^# /gm) ?? []).length, 1);
      assert.ok(
        markdown.length > 500,
        `${production.canonical} Markdown must preserve useful meaning`,
      );
      assert.match(discovery, new RegExp(production.discoveryTarget.replaceAll(".", "\\.")));
    }

    const marketingDirectory = path.join(root, "marketing-site/dist");
    const expectedMarketingMarkdown = marketingRouteManifest.map((route) =>
      route.path === "/" ? "index.md" : `${route.path.slice(1)}.md`,
    );
    const expectedMarketingHTML = marketingRouteManifest.map((route) =>
      route.path === "/" ? "index.html" : `${route.path.slice(1)}.html`,
    );
    assert.deepEqual(
      await filesWithSuffix(marketingDirectory, ".md"),
      expectedMarketingMarkdown.toSorted(),
      "every manifest-owned marketing route must have one Markdown artifact and no stale alias",
    );
    assert.deepEqual(
      await filesWithSuffix(marketingDirectory, ".html"),
      ["404.html", ...expectedMarketingHTML].toSorted(),
      "every manifest-owned marketing route must have one HTML artifact and no stale alias",
    );
    const firstMarketingSurface = await artifactSnapshot(marketingDirectory, [
      "_headers",
      "llms.txt",
      "sitemap.xml",
      ...expectedMarketingMarkdown,
    ]);
    const firstMarketingHTML = await semanticHTMLSnapshot(
      marketingDirectory,
      expectedMarketingHTML,
    );
    for (const route of marketingRouteManifest) {
      const outputPath = route.path === "/" ? "index.md" : `${route.path.slice(1)}.md`;
      const htmlPath = route.path === "/" ? "index.html" : `${route.path.slice(1)}.html`;
      const html = await readFile(path.join(marketingDirectory, htmlPath), "utf8");
      const markdown = await readFile(path.join(marketingDirectory, outputPath), "utf8");
      const { headNodes } = productionHTMLContract(html, {
        canonical: route.canonical,
        description: route.description,
        evidence: noJavaScriptEvidence[route.canonical],
        title: route.title,
      });
      assert.ok(
        headNodes.some(
          (node) =>
            node.tagName === "link" &&
            documentAttribute(node, "rel") === "alternate" &&
            documentAttribute(node, "type") === "text/markdown" &&
            documentAttribute(node, "href") ===
              new URL(outputPath, "https://openpost.social/").href,
        ),
        `${route.canonical} must advertise its explicit Markdown artifact`,
      );
      assert.match(markdown, new RegExp(`^Title: ${route.title.replaceAll("$", "\\$")}$`, "m"));
      assert.ok(markdown.includes(`\nDescription: ${route.description}\n`));
      assert.match(
        markdown,
        new RegExp(`^Canonical: ${route.canonical.replaceAll(".", "\\.")}/?$`, "m"),
      );
      assert.equal((markdown.match(/^# /gm) ?? []).length, 1);
      assert.ok(Buffer.byteLength(markdown, "utf8") <= 256 * 1024);
      assert.ok(markdownPlainText(markdown).length >= 300);
      assert.doesNotMatch(
        markdownOutsideFences(markdown),
        /<script|data-sveltekit|__sveltekit|<!--@include:|^:::[ \t]/imu,
      );
      assert.doesNotMatch(markdown, /Navigation noise|https:\/\/app\.openpost\.social/u);
      assert.doesNotMatch(markdownOutsideFences(markdown), /\]\((?:\/|\.\.\/|\.\/)/u);
    }

    const staticRoutes = marketingRouteManifest.filter(
      (entry) => entry.agentRepresentation === "static",
    );

    const marketingDiscovery = await readFile(path.join(marketingDirectory, "llms.txt"), "utf8");
    for (const route of staticRoutes.filter(
      (entry) => entry.agentDiscovery.membership === "primary",
    )) {
      const output = route.path === "/" ? "index.md" : `${route.path.slice(1)}.md`;
      assert.match(marketingDiscovery, new RegExp(`https://openpost\\.social/${output}`));
    }
    assert.match(marketingDiscovery, /^## Optional$/m);
    assert.doesNotMatch(marketingDiscovery, /privacy\.md|terms\.md|refunds\.md|changelog\.md/u);

    const sitemap = await readFile(path.join(marketingDirectory, "sitemap.xml"), "utf8");
    assert.doesNotMatch(sitemap, /\.md(?:<|$)/u);
    const sitemapURLs = [...sitemap.matchAll(/<loc>([^<]+)<\/loc>/gu)].map((match) => match[1]);
    assert.deepEqual(
      sitemapURLs.toSorted(),
      marketingRouteManifest.map((route) => new URL(route.canonical).href).toSorted(),
    );
    assert.equal(new Set(sitemapURLs).size, sitemapURLs.length);

    const pricing = await readFile(path.join(marketingDirectory, "pricing.md"), "utf8");
    const planCatalog = JSON.parse(
      await readFile(path.join(root, "packages/plan-catalog/src/catalog.json"), "utf8"),
    );
    const formatted = planCatalog.plans.map((plan) => ({
      ...plan,
      monthly: `$${plan.monthly_price_usd}/month`,
      annual: `$${plan.annual_price_usd}/year`,
      storage: `${plan.limits.media_bytes_stored / 1_000_000_000} GB`,
    }));
    assert.match(
      pricing,
      new RegExp(
        formatted
          .map(
            (plan) =>
              `${plan.name.replaceAll("$", "\\$")} \\$${plan.annual_price_usd.toLocaleString("en-US")}/year`,
          )
          .join("[\\s\\S]*"),
        "u",
      ),
    );
    const exactRows = [
      ["Workspaces", ...formatted.map((plan) => plan.limits.workspaces.toLocaleString("en-US"))],
      [
        "Social accounts",
        ...formatted.map((plan) => plan.limits.social_accounts.toLocaleString("en-US")),
      ],
      [
        "Scheduled posts / month",
        ...formatted.map((plan) => plan.limits.scheduled_posts_monthly.toLocaleString("en-US")),
      ],
      ["Media storage", ...formatted.map((plan) => plan.storage)],
      [
        "Included seats",
        ...formatted.map((plan) => plan.limits.team_members.toLocaleString("en-US")),
      ],
    ];
    for (const row of exactRows)
      assert.match(pricing, new RegExp(`^\\| ${row.join(" \\| ")} \\|$`, "mu"));
    assert.match(pricing, new RegExp(`${planCatalog.purchase_terms.trial_days}-day`, "u"));
    assert.match(
      pricing,
      planCatalog.purchase_terms.card_required
        ? /A card is required at checkout\./u
        : /No card is required at checkout\./u,
    );
    assert.match(
      pricing,
      /\| Limit \| Starter \$15\/month \| Founder \$25\/month \| Pro \$49\/month \| Team \$99\/month \| Agency \$199\/month \|\n\| --- \| --- \| --- \| --- \| --- \| --- \|/u,
    );
    const features = await readFile(path.join(marketingDirectory, "features.md"), "utf8");
    assert.match(
      features,
      /!\[OpenPost publication composer with destination-specific versions\]\(https:\/\/openpost\.social\/assets\/screenshots\/main-dark\.png\)/u,
    );
    assert.deepEqual(
      featureGroups.map(({ id }) => id).toSorted(),
      Object.keys(centralFeatureEvidence).toSorted(),
      "the reviewed central-feature contract must own every feature group exactly once",
    );
    for (const [featureID, evidence] of Object.entries(centralFeatureEvidence)) {
      for (const claim of [evidence.title, evidence.outcome, evidence.boundary]) {
        assert.ok(
          features.includes(claim),
          `features.md must preserve the reviewed ${featureID} product claim: ${claim}`,
        );
      }
    }
    for (const policy of ["privacy", "terms", "refunds"]) {
      const html = await readFile(path.join(marketingDirectory, `${policy}.html`), "utf8");
      const markdown = await readFile(path.join(marketingDirectory, `${policy}.md`), "utf8");
      const plainText = markdownPlainText(markdown);
      let previousEnd = 0;
      for (const exactText of legalTextChunks(html)) {
        const position = plainText.indexOf(exactText, previousEnd);
        assert.notEqual(position, -1, `${policy}.md omitted, changed, or reordered: ${exactText}`);
        previousEnd = position + exactText.length;
      }
    }
    assert.equal((pricing.match(/^\| Limit \|/gmu) ?? []).length, 1);

    const docsDirectory = path.join(root, "docs-site/.vitepress/dist");
    const docsDiscovery = await readFile(path.join(docsDirectory, "llms.txt"), "utf8");
    const docsCorpus = await readFile(path.join(docsDirectory, "llms-full.txt"), "utf8");
    const ordinaryDocs = docsSocialEntries.filter(
      (entry) => entry.agentRepresentation.membership === "ordinary",
    );
    const expectedDocsMarkdown = ordinaryDocs.map((entry) => entry.page);
    const expectedDocsHTML = expectedDocsMarkdown.map((page) => page.replace(/\.md$/u, ".html"));
    assert.deepEqual(
      await filesWithSuffix(docsDirectory, ".md"),
      expectedDocsMarkdown.toSorted(),
      "every catalogue-owned documentation route must have one Markdown artifact and no stale alias",
    );
    assert.deepEqual(
      await filesWithSuffix(docsDirectory, ".html"),
      ["404.html", ...expectedDocsHTML].toSorted(),
      "every catalogue-owned documentation route must have one HTML artifact and no stale alias",
    );
    const firstDocsSurface = await artifactSnapshot(docsDirectory, [
      "_headers",
      "llms-full.txt",
      "llms.txt",
      "sitemap.xml",
      ...expectedDocsMarkdown,
    ]);
    const firstDocsHTML = await semanticHTMLSnapshot(docsDirectory, expectedDocsHTML);
    for (const entry of ordinaryDocs) {
      const html = await readFile(
        path.join(docsDirectory, entry.page.replace(/\.md$/u, ".html")),
        "utf8",
      );
      const markdown = await readFile(path.join(docsDirectory, entry.page), "utf8");
      productionHTMLContract(html, {
        canonical: entry.canonical,
        description: entry.description,
        evidence: noJavaScriptEvidence[entry.canonical],
        title: entry.page === "index.md" ? entry.socialTitle : `${entry.socialTitle} | OpenPost`,
        home: entry.page === "index.md",
      });
      assert.ok(
        html.includes(
          `rel="alternate" type="text/markdown" href="${new URL(entry.page, "https://docs.openpost.social/").href}"`,
        ),
      );
      assert.match(
        html,
        /rel="alternate" type="text\/plain" href="https:\/\/docs\.openpost\.social\/llms-full\.txt"/u,
      );
      assert.match(
        html,
        /rel="alternate" type="text\/plain" href="https:\/\/docs\.openpost\.social\/llms\.txt"/u,
      );
      assert.ok(markdown.includes(`\nTitle: ${entry.socialTitle}\n`));
      assert.ok(markdown.includes(`\nDescription: ${entry.description}\n`));
      assert.ok(markdown.includes(`\nCanonical: ${entry.canonical}\n`));
      assert.ok(markdown.includes(`\n# ${entry.socialTitle}\n`));
      assert.equal((markdownOutsideFences(markdown).match(/^# /gmu) ?? []).length, 1);
      assert.ok(markdownPlainText(markdown).length >= 300);
      if (!entry.agentRepresentation.sizeException) {
        assert.ok(Buffer.byteLength(markdown, "utf8") <= 256 * 1024);
      }
      assert.doesNotMatch(markdownOutsideFences(markdown), /\]\((?:\/|\.\.\/|\.\/)/u);
      assert.doesNotMatch(
        markdownOutsideFences(markdown),
        /<script|data-sveltekit|__sveltekit|<!--@include:|^:::[ \t]|\]\(https:\/\/app\.openpost\.social/imu,
      );
    }

    for (const [key, title] of [
      ["user-guide", "User guide"],
      ["providers", "Providers"],
      ["cli", "CLI"],
      ["mcp", "MCP"],
      ["installation", "Installation"],
      ["self-hosting", "Self-hosting"],
      ["configuration", "Configuration"],
      ["operations", "Operations"],
      ["api", "API"],
      ["development", "Development"],
    ]) {
      assert.match(docsDiscovery, new RegExp(`^## ${title}$`, "m"));
      const entry = docsSocialEntries.find((candidate) => candidate.agentDiscovery.section === key);
      assert.ok(entry);
      assert.ok(docsDiscovery.includes(new URL(entry.page, "https://docs.openpost.social/").href));
    }
    assert.match(
      docsDiscovery,
      /\[OpenAPI JSON\]\(https:\/\/docs\.openpost\.social\/openapi\.json\)/u,
    );
    assert.match(
      docsDiscovery,
      /\[OpenPost documentation full corpus\]\(https:\/\/docs\.openpost\.social\/llms-full\.txt\)/u,
    );
    assert.ok(Buffer.byteLength(docsCorpus, "utf8") < 1024 * 1024);
    assert.match(docsCorpus, /OpenPost convenience artifact/u);
    assert.match(docsCorpus, /not part of the llms\.txt v2 proposal/u);
    assert.doesNotMatch(
      docsCorpus,
      /Generated from the canonical|^Title:|^Description:|^Canonical:/m,
    );
    assert.doesNotMatch(docsCorpus, /"openapi"\s*:\s*"3\./u);
    assert.doesNotMatch(
      docsCorpus,
      /^### (?:Privacy Policy|Terms of Service|Refund Policy|Changelog)$/m,
    );
    for (const entry of docsSocialEntries) {
      const provenance = `Source: [${entry.canonical}](${entry.canonical})`;
      if (entry.agentCorpus.membership === "included") {
        assert.ok(docsCorpus.includes(provenance), `${entry.page} is missing from llms-full.txt`);
      } else {
        assert.equal(
          docsCorpus.includes(provenance),
          false,
          `${entry.page} must stay out of llms-full.txt: ${entry.agentCorpus.reason}`,
        );
      }
    }
    for (const entry of docsSocialEntries.filter(
      (candidate) => candidate.agentDiscovery.membership === "unlisted",
    )) {
      assert.equal(
        docsDiscovery.includes(`(${new URL(entry.page, "https://docs.openpost.social/").href})`),
        false,
      );
    }
    const docsSitemap = await readFile(path.join(docsDirectory, "sitemap.xml"), "utf8");
    assert.doesNotMatch(docsSitemap, /\.md(?:<|$)/u);
    assert.deepEqual(
      [...docsSitemap.matchAll(/<loc>([^<]+)<\/loc>/gu)].map((match) => match[1]).toSorted(),
      docsSocialEntries.map((entry) => new URL(entry.canonical).href).toSorted(),
    );

    await runRootTask(root, ["build", "--", "docs"], { TURBO_FORCE: "true" });
    await assertArtifactSnapshot(docsDirectory, firstDocsSurface);
    assert.deepEqual(await semanticHTMLSnapshot(docsDirectory, expectedDocsHTML), firstDocsHTML);

    await runRootTask(root, ["build", "--", "marketing"], { TURBO_FORCE: "true" });
    await assertArtifactSnapshot(marketingDirectory, firstMarketingSurface);
    assert.deepEqual(
      await semanticHTMLSnapshot(marketingDirectory, expectedMarketingHTML),
      firstMarketingHTML,
    );
  },
);

test(
  "marketing production artifacts cover every platform and comparison from one manifest",
  { timeout: 180_000 },
  async () => {
    const root = path.resolve(import.meta.dirname, "..");
    await ensureProductionBuilds(root);

    const outputDirectory = path.join(root, "marketing-site/dist");
    const sitemap = await readFile(path.join(outputDirectory, "sitemap.xml"), "utf8");
    const discovery = await readFile(path.join(outputDirectory, "llms.txt"), "utf8");
    const represented = marketingRouteManifest.filter(
      (entry) => entry.kind === "platform" || entry.kind === "comparison",
    );

    assert.equal(represented.length, platforms.length + comparisons.length);
    assert.match(discovery, /^## Optional platforms$/m);
    assert.match(discovery, /^## Optional comparisons$/m);
    assert.deepEqual(
      [
        ...(await readdir(path.join(outputDirectory, "platforms")))
          .filter((name) => name.endsWith(".md"))
          .map((name) => `platforms/${name}`),
        ...(await readdir(path.join(outputDirectory, "compare")))
          .filter((name) => name.endsWith(".md"))
          .map((name) => `compare/${name}`),
      ].sort(),
      represented.map((entry) => `${entry.path.slice(1)}.md`).sort(),
    );

    for (const entry of represented) {
      assert.deepEqual(entry.agentDiscovery, {
        membership: "optional",
        section: entry.kind === "platform" ? "platforms" : "comparisons",
      });

      const relativePath = entry.path.slice(1);
      const html = await readFile(path.join(outputDirectory, `${relativePath}.html`), "utf8");
      const markdown = await readFile(path.join(outputDirectory, `${relativePath}.md`), "utf8");
      const markdownURL = `${entry.canonical}.md`;

      assert.equal(
        (sitemap.match(new RegExp(`<loc>${entry.canonical}</loc>`, "gu")) ?? []).length,
        1,
      );
      assert.match(html, new RegExp(`<title>${entry.title.replaceAll(".", "\\.")}</title>`));
      assert.match(
        html,
        new RegExp(
          `rel="alternate" type="text/markdown" href="${markdownURL.replaceAll(".", "\\.")}"`,
        ),
      );
      assert.match(markdown, new RegExp(`^Title: ${entry.title.replaceAll(".", "\\.")}$`, "m"));
      assert.match(
        markdown,
        new RegExp(`^Description: ${entry.description.replaceAll(".", "\\.")}$`, "m"),
      );
      assert.match(
        markdown,
        new RegExp(`^Canonical: ${entry.canonical.replaceAll(".", "\\.")}$`, "m"),
      );
      assert.equal((markdown.match(/^# /gm) ?? []).length, 1);
      assert.doesNotMatch(
        markdown,
        /All comparisons|custom reply text for this account|Keep comparing|Navigation noise|Other tools worth checking|Try OpenPost|Try the managed app/u,
      );
      assert.match(discovery, new RegExp(`\(${markdownURL.replaceAll(".", "\\.")}\)`));

      if (entry.kind === "platform") {
        const platform = platforms.find((candidate) => candidate.slug === entry.platform);
        assert.ok(platform, `${entry.path} must have canonical provider facts`);
        assert.match(markdown, /\*\*Implemented:\*\*/u);
        assert.match(markdown, /\*\*Managed certification:\*\*/u);
        assert.match(markdown, /^## What can still block a post\.$/m);
        assert.ok(markdown.includes(platform.implementationDetail));
        assert.ok(markdown.includes(platform.managedCertificationDetail));
        assert.ok(markdown.includes(platform.accountRequirement));
        assert.ok(markdown.includes(platform.verification));
        for (const fact of [...platform.limits, ...platform.limitations]) {
          assert.ok(markdown.includes(fact), `${entry.path} must preserve ${JSON.stringify(fact)}`);
        }
        assert.ok(markdown.includes(platform.docsUrl));
        assert.doesNotMatch(markdown, /^1\. \d+$/m);
      } else {
        const slug = entry.path.slice("/compare/".length);
        const comparison = comparisons.find((candidate) => candidate.slug === slug);
        const evidence = comparisonEvidenceRegister[slug];
        assert.ok(comparison, `${entry.path} must have canonical comparison facts`);
        assert.ok(evidence, `${entry.path} must have canonical comparison evidence`);
        assert.ok(markdown.includes(comparison.verdict));
        assert.ok(markdown.includes(comparison.pricing));
        assert.ok(markdown.includes(evidence.qualifier));
        for (const row of comparison.rows) {
          assert.ok(markdown.includes(row.openpost));
          assert.ok(markdown.includes(row.competitor));
          for (const claim of [row.evidence.openpost, row.evidence.competitor]) {
            assert.ok(markdown.includes(claim.owner));
            assert.ok(markdown.includes(claim.basis));
            assert.ok(markdown.includes(claim.qualifier));
            assert.ok(
              markdown.includes(
                new Intl.DateTimeFormat("en", {
                  day: "numeric",
                  month: "short",
                  year: "numeric",
                  timeZone: "UTC",
                }).format(new Date(`${claim.reviewedOn}T00:00:00Z`)),
              ),
            );
            assert.ok(
              markdown.includes(
                new Intl.DateTimeFormat("en", {
                  day: "numeric",
                  month: "short",
                  year: "numeric",
                  timeZone: "UTC",
                }).format(new Date(`${claim.reviewDueOn}T00:00:00Z`)),
              ),
            );
            for (const source of claim.sources) assert.ok(markdown.includes(source.href));
          }
        }
        for (const row of Object.values(evidence.rows)) {
          assert.ok(markdown.includes(row.qualifier));
          for (const source of row.sources) assert.ok(markdown.includes(source.href));
        }
      }
    }
  },
);
