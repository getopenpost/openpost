import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { mkdtemp, readFile, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import { marketingRouteManifest } from "../packages/social-images/src/index.js";

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

async function fixtureDirectory() {
  return mkdtemp(path.join(os.tmpdir(), "openpost-agent-surface-"));
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

test("marketing production projection covers every static route from canonical metadata", () => {
  const staticRoutes = marketingRouteManifest.filter(
    (entry) => entry.agentRepresentation === "static",
  );
  assert.ok(staticRoutes.length > 1);
  assert.deepEqual(
    productionProjections.marketing.pages.map((page) => page.route.path),
    staticRoutes.map((route) => route.path),
  );
  assert.equal(
    new Set(productionProjections.marketing.pages.map((page) => page.outputPath)).size,
    staticRoutes.length,
  );
  for (const route of staticRoutes) {
    assert.match(route.agentDiscovery, /^(?:primary|optional|unlisted)$/u);
  }
});

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
    image: ghcr.io/rodrgds/openpost:latest
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
  assert.match(markdown, /^  openpost:\n    image: ghcr\.io\/rodrgds\/openpost:latest$/m);
});

test("projection validation rejects unsafe or incomplete production contracts", async () => {
  const directory = await fixtureDirectory();
  const htmlPath = path.join(directory, "index.html");
  await writeFile(htmlPath, marketingHTML);
  const base = {
    surface: "marketing",
    outputDirectory: directory,
    pages: [{ sourcePath: htmlPath, outputPath: "index.md" }],
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
});

test(
  "both production builds emit canonical homepage artifacts and discovery",
  { timeout: 120_000 },
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
    assert.match(marketingLayout, /rel="alternate" type="text\/markdown" href=\{markdownHref\}/);
    assert.match(
      marketingLayout,
      /rel="alternate"[\s\S]{0,80}type="text\/plain"[\s\S]{0,80}href="https:\/\/openpost\.social\/llms\.txt"/,
    );

    const docsConfig = await readFile(path.join(root, "docs-site/.vitepress/config.ts"), "utf8");
    assert.match(docsConfig, /type: "text\/markdown"/);
    assert.match(docsConfig, /href: `\$\{docsSiteUrl\}\/index\.md`/);
    assert.match(docsConfig, /type: "text\/plain"/);
    assert.match(docsConfig, /href: `\$\{docsSiteUrl\}\/llms\.txt`/);

    await runRootTask(root, "build", "--", "marketing");
    await runRootTask(root, "build", "--", "docs");

    for (const production of [
      {
        directory: path.join(root, "marketing-site/dist"),
        canonical: "https://openpost.social/",
        discoveryTarget: "https://openpost.social/index.md",
      },
      {
        directory: path.join(root, "docs-site/.vitepress/dist"),
        canonical: "https://docs.openpost.social/",
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
    for (const route of staticRoutes.filter((entry) => entry.agentDiscovery === "primary")) {
      const output = route.path === "/" ? "index.md" : `${route.path.slice(1)}.md`;
      assert.match(marketingDiscovery, new RegExp(`https://openpost\\.social/${output}`));
    }
    assert.match(marketingDiscovery, /^## Optional$/m);
    assert.doesNotMatch(marketingDiscovery, /privacy\.md|terms\.md|refunds\.md|changelog\.md/u);

    const sitemap = await readFile(path.join(marketingDirectory, "sitemap.xml"), "utf8");
    assert.doesNotMatch(sitemap, /\.md(?:<|$)/u);

    const pricing = await readFile(path.join(marketingDirectory, "pricing.md"), "utf8");
    assert.match(pricing, /\$15 \/month[\s\S]*\$25 \/month[\s\S]*\$49 \/month/u);
    assert.match(pricing, /\$99 \/month[\s\S]*\$199 \/month/u);
    assert.match(
      pricing,
      /\| Limit \| Starter \$15\/month \| Founder \$25\/month \| Pro \$49\/month \| Team \$99\/month \| Agency \$199\/month \|\n\| --- \| --- \| --- \| --- \| --- \| --- \|/u,
    );
    const features = await readFile(path.join(marketingDirectory, "features.md"), "utf8");
    assert.match(
      features,
      /!\[OpenPost publication composer with destination-specific versions\]\(https:\/\/openpost\.social\/assets\/screenshots\/main-dark\.png\)/u,
    );
    const privacy = await readFile(path.join(marketingDirectory, "privacy.md"), "utf8");
    assert.match(
      privacy,
      /OpenPost does not sell personal data, build advertising profiles, or share personal data for cross-context behavioral advertising\./u,
    );
    const refunds = await readFile(path.join(marketingDirectory, "refunds.md"), "utf8");
    assert.match(
      refunds,
      /completed billing periods and partially used periods are not refundable or prorated\./u,
    );

    await generateAgentSurface(productionProjections.marketing);
    for (const [outputPath, first] of firstArtifacts) {
      assert.equal(await readFile(path.join(marketingDirectory, outputPath), "utf8"), first);
    }
  },
);
