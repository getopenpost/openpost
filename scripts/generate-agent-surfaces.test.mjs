import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { mkdtemp, readFile, readdir, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import { parse } from "parse5";
import { docsSocialEntries, marketingRouteManifest } from "../packages/social-images/src/index.js";
import { comparisonEvidenceRegister } from "../marketing-site/src/routes/_comparison-evidence.ts";
import { comparisons, platforms } from "../marketing-site/src/routes/_marketing.ts";
import { generateAgentSurface, productionProjections } from "./generate-agent-surfaces.mjs";

async function runRootTask(root, ...arguments_) {
  await new Promise((resolve, reject) => {
    const child = spawn("bun", ["run", ...arguments_], { cwd: root, stdio: "inherit" });
    child.once("error", reject);
    child.once("exit", (code) =>
      code === 0 ? resolve() : reject(new Error(`bun run ${arguments_.join(" ")} exited ${code}`)),
    );
  });
}

let productionBuildPromise;

function ensureProductionBuilds(root) {
  productionBuildPromise ??= (async () => {
    await runRootTask(root, "build", "--", "marketing");
    await runRootTask(root, "build", "--", "docs");
  })();
  return productionBuildPromise;
}

async function fixtureDirectory() {
  return mkdtemp(path.join(os.tmpdir(), "openpost-agent-surface-"));
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
    const marketingPackage = JSON.parse(
      await readFile(path.join(root, "marketing-site/package.json"), "utf8"),
    );
    const docsPackage = JSON.parse(
      await readFile(path.join(root, "docs-site/package.json"), "utf8"),
    );
    assert.match(
      marketingPackage.scripts.build,
      /generate-agent-surfaces\.mjs --surface marketing/,
    );
    assert.match(docsPackage.scripts.build, /generate-agent-surfaces\.mjs --surface documentation/);

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

    const staticRoutes = marketingRouteManifest.filter(
      (entry) => entry.agentRepresentation === "static",
    );
    const marketingDirectory = path.join(root, "marketing-site/dist");
    const firstArtifacts = new Map();
    for (const route of staticRoutes) {
      const outputPath = route.path === "/" ? "index.md" : `${route.path.slice(1)}.md`;
      const markdown = await readFile(path.join(marketingDirectory, outputPath), "utf8");
      firstArtifacts.set(outputPath, markdown);
      assert.match(markdown, new RegExp(`^Title: ${route.title.replaceAll("$", "\\$")}$`, "m"));
      assert.match(
        markdown,
        new RegExp(`^Canonical: ${route.canonical.replaceAll(".", "\\.")}/?$`, "m"),
      );
      assert.equal((markdown.match(/^# /gm) ?? []).length, 1);
      assert.ok(Buffer.byteLength(markdown, "utf8") <= 256 * 1024);
      assert.doesNotMatch(markdown, /<script|data-sveltekit|Navigation noise/u);
      assert.doesNotMatch(markdown, /\]\((?:\/|\.\.\/|\.\/)/u);
    }

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
    const firstDocsArtifacts = new Map();
    for (const entry of ordinaryDocs) {
      const html = await readFile(
        path.join(docsDirectory, entry.page.replace(/\.md$/u, ".html")),
        "utf8",
      );
      const markdown = await readFile(path.join(docsDirectory, entry.page), "utf8");
      firstDocsArtifacts.set(entry.page, markdown);
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
      assert.doesNotMatch(
        markdownOutsideFences(markdown),
        /\]\((?:\/|\.\.\/|\.\/|https:\/\/app\.openpost\.social)/u,
      );
      assert.doesNotMatch(markdown, /<!--@include:/u);
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

    await generateAgentSurface(productionProjections.documentation);
    for (const [outputPath, first] of firstDocsArtifacts) {
      assert.equal(await readFile(path.join(docsDirectory, outputPath), "utf8"), first);
    }

    await generateAgentSurface(productionProjections.marketing);
    for (const [outputPath, first] of firstArtifacts) {
      assert.equal(await readFile(path.join(marketingDirectory, outputPath), "utf8"), first);
    }
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
