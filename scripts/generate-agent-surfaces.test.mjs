import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { mkdtemp, readFile, readdir, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import { marketingRouteManifest } from "../packages/social-images/src/index.js";
import { comparisonEvidenceRegister } from "../marketing-site/src/routes/_comparison-evidence.ts";
import { comparisons, platforms } from "../marketing-site/src/routes/_marketing.ts";
import { generateAgentSurface } from "./generate-agent-surfaces.mjs";

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
    assert.match(docsConfig, /href: `\$\{docsSiteUrl\}\/index\.md`/);
    assert.match(docsConfig, /type: "text\/plain"/);
    assert.match(docsConfig, /href: `\$\{docsSiteUrl\}\/llms\.txt`/);

    await ensureProductionBuilds(root);

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

    assert.equal(represented.length, 16);
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
        /custom reply text for this account|Navigation noise|Try OpenPost|Try the managed app/u,
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
        }
        for (const row of Object.values(evidence.rows)) {
          assert.ok(markdown.includes(row.qualifier));
          for (const source of row.sources) assert.ok(markdown.includes(source.href));
        }
      }
    }
  },
);
