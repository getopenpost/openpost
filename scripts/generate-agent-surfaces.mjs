import { constants } from "node:fs";
import { access, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { load as parseYaml } from "js-yaml";
import { parse, parseFragment } from "parse5";
import {
  marketingAgentMarkdownUrl,
  marketingRouteManifest,
} from "../packages/social-images/src/index.js";

const repositoryRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const generatedNotice =
  "<!-- Generated from the canonical OpenPost public page. Do not edit this build artifact. -->";
const privateRoutePattern =
  /\/(?:login|register|onboarding|checkout|organizations|workspaces|publications|renditions|media|settings|billing|oauth|api)(?:[/.?#]|$)/iu;
const privateApplicationOrigins = new Set(["https://app.openpost.social"]);
const publicContentOrigins = new Set(["https://openpost.social", "https://docs.openpost.social"]);
const productionArtifactURLs = new Set([
  "https://openpost.social/index.md",
  "https://docs.openpost.social/index.md",
]);
const ignoredHTMLTags = new Set([
  "button",
  "form",
  "label",
  "nav",
  "script",
  "style",
  "svg",
  "template",
  "textarea",
]);
const transparentHTMLTags = new Set([
  "article",
  "aside",
  "body",
  "dd",
  "details",
  "div",
  "dl",
  "dt",
  "figcaption",
  "figure",
  "footer",
  "header",
  "html",
  "main",
  "section",
  "small",
  "span",
  "time",
]);

function attribute(node, name) {
  return node.attrs?.find((candidate) => candidate.name === name)?.value;
}

function children(node) {
  return node?.childNodes ?? [];
}

function descendants(node) {
  return [node, ...children(node).flatMap(descendants)];
}

function element(root, tagName) {
  return descendants(root).find((node) => node.tagName === tagName);
}

function headMetadata(document) {
  const head = element(document, "head");
  const title = element(head, "title")
    ?.childNodes?.map((node) => node.value ?? "")
    .join("")
    .trim();
  const description = descendants(head).find(
    (node) => node.tagName === "meta" && attribute(node, "name") === "description",
  );
  const canonical = descendants(head).find(
    (node) => node.tagName === "link" && attribute(node, "rel") === "canonical",
  );
  return {
    title,
    description: attribute(description, "content"),
    canonical: attribute(canonical, "href"),
  };
}

function absoluteUrl(value, canonical) {
  if (!value || value.startsWith("#")) return `${canonical.replace(/\/$/u, "")}${value ?? ""}`;
  if (/^(?:mailto:|tel:)/u.test(value)) return value;
  return new URL(value, canonical).href;
}

function textContent(node) {
  if (node.nodeName === "#text") return node.value ?? "";
  return children(node).map(textContent).join("");
}

function renderTable(node, canonical) {
  const rows = descendants(node)
    .filter((candidate) => candidate.tagName === "tr")
    .map((row) =>
      children(row)
        .filter((cell) => cell.tagName === "th" || cell.tagName === "td")
        .map((cell) => renderNodes(children(cell), canonical).replace(/\s+/gu, " ").trim()),
    )
    .filter((row) => row.length > 0);
  if (rows.length === 0) return "";
  const width = Math.max(...rows.map((row) => row.length));
  const normalized = rows.map((row) => [...row, ...Array(width - row.length).fill("")]);
  const [header, ...body] = normalized;
  return `${[`| ${header.join(" | ")} |`, `| ${Array(width).fill("---").join(" | ")} |`, ...body.map((row) => `| ${row.join(" | ")} |`)].join("\n")}\n\n`;
}

function renderNode(node, canonical, listDepth = 0) {
  if (node.nodeName === "#text") return (node.value ?? "").replace(/\s+/gu, " ");
  const tag = node.tagName;
  if (
    tag &&
    (attribute(node, "data-agent-exclude") !== undefined ||
      attribute(node, "hidden") !== undefined ||
      attribute(node, "aria-hidden") === "true")
  ) {
    return "";
  }
  if (!tag || ignoredHTMLTags.has(tag)) {
    return tag ? "" : renderNodes(children(node), canonical, listDepth);
  }
  if (/^h[1-6]$/u.test(tag)) {
    return `\n\n${"#".repeat(Number(tag[1]))} ${renderNodes(children(node), canonical).trim()}\n\n`;
  }
  if (tag === "p") return `\n\n${renderNodes(children(node), canonical, listDepth).trim()}\n\n`;
  if (tag === "br") return "\n";
  if (tag === "strong" || tag === "b")
    return `**${renderNodes(children(node), canonical).trim()}**`;
  if (tag === "em" || tag === "i") return `*${renderNodes(children(node), canonical).trim()}*`;
  if (tag === "code" && node.parentNode?.tagName !== "pre") {
    return `\`${textContent(node).trim()}\``;
  }
  if (tag === "pre") return `\n\n\`\`\`\n${textContent(node).trim()}\n\`\`\`\n\n`;
  if (tag === "a") {
    const label = renderNodes(children(node), canonical).trim();
    const href = attribute(node, "href");
    const resolved = href ? absoluteUrl(href, canonical) : undefined;
    if (resolved && privateApplicationOrigins.has(new URL(resolved).origin)) return "";
    return label && resolved ? `[${label}](${resolved})` : label;
  }
  if (tag === "img") {
    const alt = attribute(node, "alt")?.trim();
    const source = attribute(node, "src");
    return alt && source ? `![${alt}](${absoluteUrl(source, canonical)})` : "";
  }
  if (tag === "li") {
    const marker = node.parentNode?.tagName === "ol" ? "1." : "-";
    return `${"  ".repeat(listDepth)}${marker} ${renderNodes(children(node), canonical, listDepth + 1).trim()}\n`;
  }
  if (tag === "ul" || tag === "ol") {
    return `\n${children(node)
      .map((child) => renderNode(child, canonical, listDepth))
      .join("")}\n`;
  }
  if (tag === "blockquote") {
    return `\n\n${renderNodes(children(node), canonical)
      .trim()
      .split("\n")
      .map((line) => `> ${line}`)
      .join("\n")}\n\n`;
  }
  if (tag === "table") return renderTable(node, canonical);
  if (tag === "summary") return `\n\n**${renderNodes(children(node), canonical).trim()}**\n\n`;
  if (transparentHTMLTags.has(tag)) return renderNodes(children(node), canonical, listDepth);
  throw new Error(`${canonical}: unsupported meaning-bearing <${tag}>`);
}

function renderNodes(nodes, canonical, listDepth = 0) {
  return nodes.map((node) => renderNode(node, canonical, listDepth)).join("");
}

function cleanMarkdown(markdown) {
  return `${markdown
    .replace(/[ \t]+\n/gu, "\n")
    .replace(/\n{3,}/gu, "\n\n")
    .trim()}\n`;
}

function representation({ title, description, canonical, body }) {
  if (!title || !description || !canonical) {
    throw new Error(`page metadata requires title, description, and canonical URL`);
  }
  const cleanedBody = cleanMarkdown(body);
  if ((cleanedBody.match(/^# /gmu) ?? []).length !== 1) {
    throw new Error(`${canonical}: generated representation must contain exactly one H1`);
  }
  return cleanMarkdown(`${generatedNotice}

Title: ${title}
Description: ${description}
Canonical: ${canonical}
Source: [${canonical}](${canonical})

${cleanedBody}`);
}

function marketingRepresentation(source) {
  const document = parse(source);
  const metadata = headMetadata(document);
  if (metadata.canonical) metadata.canonical = new URL(metadata.canonical).href;
  const main = element(document, "main");
  if (!main)
    throw new Error(`${metadata.canonical ?? "marketing page"}: missing semantic main content`);
  return {
    ...metadata,
    markdown: representation({
      ...metadata,
      body: renderNodes(children(main), metadata.canonical),
    }),
  };
}

function parseFrontmatter(source) {
  const match = source.match(/^---\n([\s\S]*?)\n---\n?/u);
  if (!match) return { data: {}, body: source };
  return { data: parseYaml(match[1]) ?? {}, body: source.slice(match[0].length) };
}

function rewriteMarkdownLinks(source, canonical) {
  return source.replace(/(!?\[[^\]]*\])\(([^)\s]+)([^)]*)\)/gu, (_match, label, target, suffix) => {
    if (target.startsWith("#") || /^(?:mailto:|tel:)/u.test(target))
      return `${label}(${target}${suffix})`;
    return `${label}(${absoluteUrl(target, canonical)}${suffix})`;
  });
}

function normalizeContainers(source) {
  return source.replace(
    /^:::\s*(?:info|tip|warning|danger|details)\s*(.*)\n([\s\S]*?)^:::\s*$/gmu,
    (_all, label, body) => {
      const lines = body.trim().split("\n");
      return [`> **${label || "Note"}**`, ">", ...lines.map((line) => `> ${line}`)].join("\n");
    },
  );
}

function normalizeRawHtml(source, canonical) {
  return source.replace(/<p>\s*<img\s+[\s\S]*?<\/p>/gu, (html) =>
    renderNodes(children(parseFragment(html)), canonical).trim(),
  );
}

function documentationRepresentation(source, page) {
  const { data, body: maintainedBody } = parseFrontmatter(source);
  const hero = data.hero ?? {};
  const sections = [`# ${hero.name ?? page.title}`];
  if (hero.text) sections.push(String(hero.text));
  if (hero.tagline) sections.push(String(hero.tagline));
  if (Array.isArray(hero.actions)) {
    sections.push(
      hero.actions
        .filter(
          (action) =>
            action?.text &&
            action?.link &&
            !privateApplicationOrigins.has(new URL(action.link, page.canonical).origin),
        )
        .map((action) => `- [${action.text}](${absoluteUrl(action.link, page.canonical)})`)
        .join("\n"),
    );
  }
  if (Array.isArray(data.features)) {
    for (const feature of data.features) {
      if (feature?.title) sections.push(`## ${feature.title}\n\n${feature.details ?? ""}`);
    }
  }
  const normalizedBody = rewriteMarkdownLinks(
    normalizeRawHtml(normalizeContainers(maintainedBody), page.canonical),
    page.canonical,
  );
  sections.push(normalizedBody);
  return {
    title: page.title,
    description: page.description,
    canonical: page.canonical,
    markdown: representation({ ...page, body: sections.filter(Boolean).join("\n\n") }),
  };
}

function discoveryDocument(discovery) {
  const renderLinks = (links) =>
    links.map((link) => `- [${link.title}](${link.url}): ${link.description}`).join("\n");
  const sections = (discovery.sections ?? [])
    .map(
      (section) =>
        `## ${section.title}\n\n${section.description ? `> ${section.description}\n\n` : ""}${renderLinks(section.links)}`,
    )
    .join("\n\n");
  return cleanMarkdown(
    `# ${discovery.title}\n\n> ${discovery.description}\n\n${renderLinks(discovery.links)}${sections ? `\n\n${sections}` : ""}`,
  );
}

async function requireSource(sourcePath) {
  try {
    await access(sourcePath, constants.R_OK);
  } catch {
    throw new Error(`missing canonical source: ${sourcePath}`);
  }
}

function validateDiscovery(projection, generatedPages) {
  const outputPaths = new Set(generatedPages.map((page) => page.outputPath));
  if (outputPaths.size !== generatedPages.length) {
    const duplicate = generatedPages.find(
      (page, index) =>
        generatedPages.findIndex((candidate) => candidate.outputPath === page.outputPath) !== index,
    );
    throw new Error(`duplicate output path: ${duplicate.outputPath}`);
  }
  const artifactURLs = new Set(
    generatedPages.map(
      (page) => new URL(page.outputPath, new URL(page.canonical).origin + "/").href,
    ),
  );
  const discoveryLinks = [
    ...projection.discovery.links,
    ...(projection.discovery.sections ?? []).flatMap((section) => section.links),
  ];
  for (const link of discoveryLinks) {
    const url = new URL(link.url);
    if (privateApplicationOrigins.has(url.origin) || privateRoutePattern.test(url.pathname)) {
      throw new Error(`discovery link exposes a private application route: ${link.url}`);
    }
    const knownArtifacts = new Set([
      ...artifactURLs,
      ...(projection.knownArtifactURLs ?? productionArtifactURLs),
    ]);
    if (publicContentOrigins.has(url.origin) && !knownArtifacts.has(url.href)) {
      throw new Error(`discovery link has no generated artifact: ${link.url}`);
    }
  }
}

function normalizedPublicURL(value) {
  const url = new URL(value);
  url.hash = "";
  url.search = "";
  if (url.pathname !== "/") url.pathname = url.pathname.replace(/\/$/u, "");
  return url.href;
}

function validateRepresentationLinks(markdown, canonical, knownCanonicalURLs = []) {
  const known = new Set(knownCanonicalURLs.map(normalizedPublicURL));
  for (const match of markdown.matchAll(/!?\[[^\]]*\]\(([^)\s]+)(?:\s+[^)]*)?\)/gu)) {
    const url = new URL(match[1], canonical);
    if (privateApplicationOrigins.has(url.origin)) {
      throw new Error(`${canonical}: generated representation exposes private link ${url.href}`);
    }
    if (url.origin !== "https://openpost.social") continue;
    if (url.pathname.startsWith("/assets/")) continue;
    if (!known.has(normalizedPublicURL(url.href))) {
      throw new Error(`${canonical}: broken internal link ${url.href}`);
    }
  }
}

async function verifyWrittenArtifacts(projection, generatedPages) {
  for (const page of generatedPages) {
    const output = await readFile(path.join(projection.outputDirectory, page.outputPath), "utf8");
    if (output !== page.markdown) {
      throw new Error(`generated artifact does not match its canonical source: ${page.outputPath}`);
    }
  }
  const discovery = await readFile(path.join(projection.outputDirectory, "llms.txt"), "utf8");
  if (discovery !== discoveryDocument(projection.discovery)) {
    throw new Error("generated llms.txt does not match its canonical discovery metadata");
  }
}

function validateHTMLDiscovery(source, page) {
  const document = parse(source);
  const head = element(document, "head");
  const links = descendants(head).filter((node) => node.tagName === "link");
  const markdownURL = new URL(page.outputPath, new URL(page.canonical).origin + "/").href;
  const hasMarkdown = links.some(
    (link) =>
      attribute(link, "rel") === "alternate" &&
      attribute(link, "type") === "text/markdown" &&
      absoluteUrl(attribute(link, "href"), page.canonical) === markdownURL,
  );
  const hasDiscovery = links.some(
    (link) =>
      attribute(link, "rel") === "alternate" &&
      attribute(link, "type") === "text/plain" &&
      new URL(attribute(link, "href"), page.canonical).pathname === "/llms.txt",
  );
  if (!hasMarkdown || !hasDiscovery) {
    throw new Error(`${page.canonical}: canonical HTML is missing Agent-readable discovery links`);
  }
}

export async function generateAgentSurface(projection) {
  const generatedPages = [];
  for (const page of projection.pages) {
    await requireSource(page.sourcePath);
    const source = await readFile(page.sourcePath, "utf8");
    const rendered =
      projection.surface === "marketing"
        ? marketingRepresentation(source)
        : documentationRepresentation(source, page);
    const generated = { ...page, ...rendered };
    if (privateRoutePattern.test(new URL(generated.canonical).pathname)) {
      throw new Error(`generated page exposes a private application route: ${generated.canonical}`);
    }
    if (page.discoveryHTMLPath) {
      await requireSource(page.discoveryHTMLPath);
      validateHTMLDiscovery(await readFile(page.discoveryHTMLPath, "utf8"), generated);
    } else if (projection.surface === "marketing") {
      validateHTMLDiscovery(source, generated);
    }
    validateRepresentationLinks(
      generated.markdown,
      generated.canonical,
      projection.knownCanonicalURLs,
    );
    generatedPages.push(generated);
  }
  validateDiscovery(projection, generatedPages);

  for (const page of generatedPages) {
    await writeFile(path.join(projection.outputDirectory, page.outputPath), page.markdown, "utf8");
  }
  await writeFile(
    path.join(projection.outputDirectory, "llms.txt"),
    discoveryDocument(projection.discovery),
    "utf8",
  );
  await verifyWrittenArtifacts(projection, generatedPages);
  return generatedPages;
}

export const productionProjections = {
  marketing: {
    surface: "marketing",
    outputDirectory: path.join(repositoryRoot, "marketing-site/dist"),
    pages: marketingRouteManifest.flatMap((entry) => {
      if (!entry.agentDiscovery) return [];
      const relativePath = entry.path === "/" ? "index" : entry.path.slice(1);
      return [
        {
          sourcePath: path.join(repositoryRoot, `marketing-site/dist/${relativePath}.html`),
          outputPath: entry.path === "/" ? "index.md" : `${relativePath}.md`,
        },
      ];
    }),
    knownCanonicalURLs: marketingRouteManifest.map((entry) => entry.canonical),
    discovery: {
      title: "OpenPost",
      description: "Create, adapt, schedule, and track social content from one workspace.",
      links: [
        {
          title: "OpenPost overview",
          description: "Understand the product workflow, managed plans, and ways to get started.",
          url: "https://openpost.social/index.md",
        },
        {
          title: "OpenPost documentation",
          description:
            "Read the user, provider, self-hosting, CLI, MCP, and developer documentation.",
          url: "https://docs.openpost.social/index.md",
        },
      ],
      sections: [
        {
          title: "Optional platforms",
          description: "Destination-specific formats, setup needs, limits, and readiness notes.",
          links: marketingRouteManifest
            .filter((entry) => entry.agentDiscovery?.section === "platforms")
            .map((entry) => ({
              title: entry.title,
              description: entry.description,
              url: marketingAgentMarkdownUrl(entry),
            })),
        },
        {
          title: "Optional comparisons",
          description: "Reviewed comparisons with evidence, qualifications, and current caveats.",
          links: marketingRouteManifest
            .filter((entry) => entry.agentDiscovery?.section === "comparisons")
            .map((entry) => ({
              title: entry.title,
              description: entry.description,
              url: marketingAgentMarkdownUrl(entry),
            })),
        },
      ],
    },
  },
  documentation: {
    surface: "documentation",
    outputDirectory: path.join(repositoryRoot, "docs-site/.vitepress/dist"),
    pages: [
      {
        sourcePath: path.join(repositoryRoot, "docs-site/index.md"),
        discoveryHTMLPath: path.join(repositoryRoot, "docs-site/.vitepress/dist/index.html"),
        outputPath: "index.md",
        canonical: "https://docs.openpost.social/",
        title: "OpenPost Documentation",
        description:
          "Draft, adapt, schedule, and automate social posts with the managed OpenPost app or the same self-hosted product.",
      },
    ],
    discovery: {
      title: "OpenPost Documentation",
      description:
        "User, provider, self-hosting, CLI, MCP, operations, and developer documentation for OpenPost.",
      links: [
        {
          title: "OpenPost documentation home",
          description: "Choose the documentation section that matches your work.",
          url: "https://docs.openpost.social/index.md",
        },
        {
          title: "OpenPost product overview",
          description: "See the public product overview and managed product path.",
          url: "https://openpost.social/index.md",
        },
      ],
    },
  },
};

async function main() {
  const surface = process.argv[2] === "--surface" ? process.argv[3] : undefined;
  if (!surface || !(surface in productionProjections)) {
    throw new Error(
      "Usage: bun scripts/generate-agent-surfaces.mjs --surface marketing|documentation",
    );
  }
  await generateAgentSurface(productionProjections[surface]);
  console.log(`Generated ${surface} Agent-readable pages and llms.txt.`);
}

if (import.meta.main) await main();
