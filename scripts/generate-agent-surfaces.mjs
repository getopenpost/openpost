import { constants } from "node:fs";
import { access, readFile, realpath, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { load as parseYaml } from "js-yaml";
import { parse, parseFragment } from "parse5";
import {
  docsSiteUrl,
  docsSocialEntries,
  marketingAgentMarkdownUrl,
  marketingRouteManifest,
  marketingSiteUrl,
} from "../packages/social-images/src/index.js";

const repositoryRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const generatedNotice =
  "<!-- Generated from the canonical OpenPost public page. Do not edit this build artifact. -->";
const maximumRepresentationBytes = 256 * 1024;
const corpusWarningBytes = 1024 * 1024;
const maximumCorpusBytes = 2 * 1024 * 1024;
const privateRoutePattern =
  /^\/(?:login|register|onboarding|checkout|organizations|workspaces|publications|renditions|media|settings|billing|oauth|api)(?:[/.?#]|$)/iu;
const privateApplicationOrigins = new Set(["https://app.openpost.social"]);
const publicContentOrigins = new Set(["https://openpost.social", "https://docs.openpost.social"]);
const productionArtifactURLs = new Set([
  "https://openpost.social/index.md",
  "https://docs.openpost.social/index.md",
]);
const ignoredMarketingTags = new Set([
  "audio",
  "button",
  "form",
  "input",
  "label",
  "nav",
  "noscript",
  "option",
  "script",
  "select",
  "source",
  "style",
  "svg",
  "template",
  "textarea",
  "video",
]);
const transparentMarketingTags = new Set([
  "abbr",
  "address",
  "article",
  "aside",
  "dd",
  "del",
  "details",
  "div",
  "dl",
  "dt",
  "figcaption",
  "figure",
  "footer",
  "header",
  "hr",
  "ins",
  "kbd",
  "main",
  "mark",
  "s",
  "samp",
  "section",
  "small",
  "span",
  "sub",
  "sup",
  "time",
  "u",
  "var",
]);

function marketingHTMLArtifact(routePath) {
  return routePath === "/" ? "index.html" : `${routePath.slice(1)}.html`;
}

function marketingMarkdownArtifact(routePath) {
  return routePath === "/" ? "index.md" : `${routePath.slice(1)}.md`;
}

function documentationHTMLArtifact(page) {
  return page.replace(/\.md$/u, ".html");
}

const documentationDiscoverySections = [
  ["user-guide", "User guide", "Create, schedule, publish, and review work in the OpenPost app."],
  ["providers", "Providers", "Check destination setup, capabilities, limits, and readiness."],
  ["cli", "CLI", "Use a terminal or automation job with a running OpenPost instance."],
  ["mcp", "MCP", "Connect an AI assistant with explicit scopes and human review."],
  ["installation", "Installation", "Install OpenPost using a supported deployment path."],
  ["self-hosting", "Self-hosting", "Run and maintain the complete OpenPost service."],
  [
    "configuration",
    "Configuration",
    "Configure storage, URLs, providers, and production settings.",
  ],
  ["operations", "Operations", "Monitor, back up, update, and troubleshoot an OpenPost instance."],
  ["api", "API", "Read the API guide and follow its authoritative OpenAPI JSON contract."],
  ["development", "Development", "Understand, test, contribute to, and release OpenPost."],
];
const documentationSectionTitles = new Map(
  documentationDiscoverySections.map(([key, title]) => [key, title]),
);

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
  const caption = children(node).find((candidate) => candidate.tagName === "caption");
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
  const lines = [
    `| ${header.join(" | ")} |`,
    `| ${Array(width).fill("---").join(" | ")} |`,
    ...body.map((row) => `| ${row.join(" | ")} |`),
  ];
  const captionText = caption ? `${renderNodes(children(caption), canonical).trim()}\n\n` : "";
  return `\n\n${captionText}${lines.join("\n")}\n\n`;
}

function renderNode(node, canonical, listDepth = 0) {
  if (node.nodeName === "#text") return (node.value ?? "").replace(/\s+/gu, " ");
  const tag = node.tagName;
  if (!tag) return renderNodes(children(node), canonical, listDepth);
  if (
    attribute(node, "data-agent-exclude") !== undefined ||
    attribute(node, "hidden") !== undefined ||
    attribute(node, "aria-hidden") === "true"
  )
    return "";
  if (ignoredMarketingTags.has(tag)) return "";
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
    if (resolved && privateApplicationOrigins.has(new URL(resolved).origin)) return label;
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
      .filter((child) => child.tagName === "li")
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
  if (transparentMarketingTags.has(tag)) return renderNodes(children(node), canonical, listDepth);
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
  const h1Count = withoutFencedContent(cleanedBody)
    .split("\n")
    .filter((line) => /^# /u.test(line)).length;
  if (h1Count !== 1) {
    throw new Error(`${canonical}: generated representation must contain exactly one H1`);
  }
  return cleanMarkdown(`${generatedNotice}

Title: ${title}
Description: ${description}
Canonical: ${canonical}
Source: [${canonical}](${canonical})

${cleanedBody}`);
}

function marketingRepresentation(source, page) {
  const document = parse(source);
  const metadata = headMetadata(document);
  if (metadata.canonical) metadata.canonical = new URL(metadata.canonical).href;
  if (page.route) {
    const routeCanonical = new URL(page.route.canonical).href;
    for (const field of ["title", "description"]) {
      if (metadata[field] !== page.route[field]) {
        throw new Error(
          `${routeCanonical}: rendered ${field} does not match canonical route metadata`,
        );
      }
    }
    if (metadata.canonical !== routeCanonical) {
      throw new Error(`${routeCanonical}: rendered canonical URL does not match route metadata`);
    }
  }
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

function mapFenceAwareLines(source, transform) {
  let fenced = false;
  return source
    .split("\n")
    .map((line) => {
      const fenceDelimiter = /^\s*(?:```|~~~)/u.test(line);
      if (fenceDelimiter) {
        fenced = !fenced;
      }
      return transform(line, fenced, fenceDelimiter);
    })
    .join("\n");
}

function mapOutsideFences(source, transform) {
  return mapFenceAwareLines(source, (line, fenced, fenceDelimiter) =>
    fenced || fenceDelimiter ? line : transform(line),
  );
}

function withoutFencedContent(source) {
  return mapFenceAwareLines(source, (line, fenced, fenceDelimiter) =>
    fenced || fenceDelimiter ? "" : line,
  );
}

function rewriteMarkdownLinks(source, canonical) {
  return mapOutsideFences(source, (line) =>
    line.replace(/(!?\[[^\]]*\])\(([^)\s]+)([^)]*)\)/gu, (_match, label, target, suffix) => {
      if (target.startsWith("#") || /^(?:mailto:|tel:)/u.test(target))
        return `${label}(${target}${suffix})`;
      const resolved = absoluteUrl(target, canonical);
      if (privateApplicationOrigins.has(new URL(resolved).origin)) {
        return label.replace(/^!?\[|\]$/gu, "");
      }
      return `${label}(${resolved}${suffix})`;
    }),
  );
}

function normalizeContainers(source, sourcePath) {
  const defaultLabels = {
    danger: "Danger",
    details: "Details",
    info: "Info",
    tip: "Tip",
    warning: "Warning",
  };
  return transformOutsideFencedBlocks(source, (plainSource) => {
    const normalized = plainSource.replace(
      /^:::[ \t]*(info|tip|warning|danger|details)(?:[ \t]+([^\n]*?))?[ \t]*\r?\n([\s\S]*?)^:::[ \t]*$/gimu,
      (_all, type, label, body) => {
        const lines = body.trim().split("\n");
        const title = label?.trim() || defaultLabels[type.toLowerCase()];
        return [`> **${title}**`, ">", ...lines.map((line) => `> ${line}`)].join("\n");
      },
    );
    const unsupported = normalized.match(/^:::[ \t]*([^\s\n]+)?[^\n]*$/mu);
    if (unsupported) {
      throw new Error(
        `${sourcePath}: unsupported VitePress container ::: ${unsupported[1] ?? "(unclosed directive)"}`,
      );
    }
    return normalized;
  });
}

function normalizeMaintainedClientOnly(source) {
  return source.replace(/<ClientOnly>\s*<OASpec\s+hideBranding\s*\/>\s*<\/ClientOnly>/gu, "");
}

function transformOutsideFencedBlocks(source, transform) {
  const lines = source.split("\n");
  const output = [];
  let plain = [];
  let fenced = false;
  const flush = () => {
    if (plain.length > 0) output.push(transform(plain.join("\n")));
    plain = [];
  };
  for (const line of lines) {
    if (/^\s*(?:```|~~~)/u.test(line)) {
      if (!fenced) flush();
      output.push(line);
      fenced = !fenced;
    } else if (fenced) {
      output.push(line);
    } else {
      plain.push(line);
    }
  }
  flush();
  return output.join("\n");
}

function normalizeRawHtml(source, canonical, sourcePath) {
  return transformOutsideFencedBlocks(source, (plainSource) => {
    let markerPrefix = "\u{e000}OPENPOST_INLINE_CODE_";
    while (plainSource.includes(markerPrefix)) markerPrefix = `\u{e000}${markerPrefix}`;
    const inlineCode = [];
    let normalized = plainSource.replace(/`[^`\n]+`/gu, (code) => {
      inlineCode.push(code);
      return `${markerPrefix}${inlineCode.length - 1}\u{e001}`;
    });
    normalized = normalized.replace(/<!--[\s\S]*?-->/gu, "");
    const supportedBlock =
      /<(p|section|div|aside|details|table|ul|ol|blockquote|figure)(?:\s[^>]*)?>[\s\S]*?<\/\1>/giu;
    let previous;
    do {
      previous = normalized;
      normalized = normalized.replace(supportedBlock, (html) =>
        renderNodes(children(parseFragment(html)), canonical).trim(),
      );
    } while (normalized !== previous);
    normalized = normalized.replace(/<(?:img|br)\b[^>]*>/giu, (html) =>
      renderNodes(children(parseFragment(html)), canonical).trim(),
    );
    const unsupported = normalized.match(/<\/?([A-Za-z][\w-]*)\b[^>]*>/u);
    if (unsupported) {
      throw new Error(
        `${sourcePath}: unsupported meaning-bearing <${unsupported[1].toLowerCase()}>`,
      );
    }
    for (const [index, code] of inlineCode.entries()) {
      normalized = normalized.replaceAll(`${markerPrefix}${index}\u{e001}`, code);
    }
    return normalized;
  });
}

async function expandControlledIncludes(source, sourcePath, sourceRoot, stack = []) {
  const includePattern = /<!--@include:\s+([^\s{}]+)\s*-->/gu;
  let expanded = "";
  let cursor = 0;
  for (const match of source.matchAll(includePattern)) {
    expanded += source.slice(cursor, match.index);
    const includeReference = match[1];
    const includePath = path.resolve(path.dirname(sourcePath), includeReference);
    const resolvedRoot = await realpath(sourceRoot);
    const resolvedInclude = await realpath(includePath).catch(() => includePath);
    if (
      resolvedInclude !== resolvedRoot &&
      !resolvedInclude.startsWith(`${resolvedRoot}${path.sep}`)
    ) {
      throw new Error(
        `${sourcePath}: controlled include escapes the documentation root: ${includeReference}`,
      );
    }
    if (stack.includes(resolvedInclude)) {
      throw new Error(`${sourcePath}: controlled include cycle: ${includeReference}`);
    }
    await requireSource(resolvedInclude);
    const included = await readFile(resolvedInclude, "utf8");
    expanded += await expandControlledIncludes(included, resolvedInclude, sourceRoot, [
      ...stack,
      resolvedInclude,
    ]);
    cursor = match.index + match[0].length;
  }
  expanded += source.slice(cursor);
  if (/<!--@include:/u.test(expanded)) {
    throw new Error(`${sourcePath}: unsupported controlled include directive`);
  }
  return expanded;
}

async function documentationRepresentation(source, page, sourceRoot) {
  source = await expandControlledIncludes(source, page.sourcePath, sourceRoot);
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
  const bodyWithoutSourceHeading = maintainedBody.replace(/^\s*#\s+.+(?:\n+|$)/u, "");
  const normalizedBody = rewriteMarkdownLinks(
    normalizeRawHtml(
      normalizeContainers(normalizeMaintainedClientOnly(bodyWithoutSourceHeading), page.sourcePath),
      page.canonical,
      page.sourcePath,
    ),
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
  const primary = discovery.links.filter(
    (link) => (link.classification ?? "primary") === "primary",
  );
  const optional = discovery.links.filter((link) => link.classification === "optional");
  const sections = (discovery.sections ?? [])
    .map(
      (section) =>
        `## ${section.title}\n\n${section.description ? `> ${section.description}\n\n` : ""}${renderLinks(section.links)}`,
    )
    .join("\n\n");
  return cleanMarkdown(
    `# ${discovery.title}\n\n> ${discovery.description}\n\n${renderLinks(primary)}${optional.length ? `\n\n## Optional\n\n${renderLinks(optional)}` : ""}${sections ? `\n\n${sections}` : ""}`,
  );
}

function demoteCorpusHeadings(source) {
  return mapOutsideFences(source, (line) =>
    line.replace(
      /^(#{1,6})\s+/u,
      (_match, markers) => `${"#".repeat(Math.min(6, markers.length + 2))} `,
    ),
  );
}

function corpusPageBody(page) {
  const headingStart = page.markdown.search(/^# /mu);
  if (headingStart < 0) throw new Error(`${page.canonical}: corpus source has no page heading`);
  const body = page.markdown.slice(headingStart).replace(/^# .+(?:\n+|$)/u, "");
  return demoteCorpusHeadings(body).trim();
}

function corpusDocument(corpus, generatedPages) {
  const includedBySection = new Map();
  for (const page of generatedPages) {
    const policy = page.catalog?.agentCorpus;
    if (!policy) throw new Error(`${page.canonical}: missing canonical corpus metadata`);
    if (policy.membership === "excluded") {
      if (!policy.reason?.trim()) {
        throw new Error(`${page.canonical}: corpus exclusion requires a reason`);
      }
      continue;
    }
    if (policy.membership !== "included" || !documentationSectionTitles.has(policy.section)) {
      throw new Error(`${page.canonical}: invalid canonical corpus metadata`);
    }
    const pages = includedBySection.get(policy.section) ?? [];
    pages.push(page);
    includedBySection.set(policy.section, pages);
  }

  const sections = documentationDiscoverySections.flatMap(([key, title]) => {
    const pages = includedBySection.get(key) ?? [];
    if (pages.length === 0) return [];
    return [
      `## ${title}\n\n${pages
        .map((page) => {
          const body = corpusPageBody(page);
          return `### ${page.title}\n\nSource: [${page.canonical}](${page.canonical})${body ? `\n\n${body}` : ""}`;
        })
        .join("\n\n")}`,
    ];
  });
  return cleanMarkdown(`# ${corpus.title}

> This documentation-only file is an OpenPost convenience artifact for reading the selected public documentation as one bounded corpus.
>
> It is not part of the llms.txt v2 proposal. Use llms.txt for the discovery index and each page's canonical URL for current source provenance.

${sections.join("\n\n")}`);
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
  const canonicalRoutes = new Set(
    generatedPages.map((page) => normalizedPublicURL(page.canonical)),
  );
  if (canonicalRoutes.size !== generatedPages.length) {
    const duplicate = generatedPages.find(
      (page, index) =>
        generatedPages.findIndex(
          (candidate) =>
            normalizedPublicURL(candidate.canonical) === normalizedPublicURL(page.canonical),
        ) !== index,
    );
    throw new Error(`duplicate canonical route: ${duplicate.canonical}`);
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
  for (const link of projection.discovery.links) {
    if (!new Set(["primary", "optional"]).has(link.classification ?? "primary")) {
      throw new Error(`invalid discovery classification for ${link.url}`);
    }
  }
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

function markdownLinks(markdown) {
  return withoutFencedContent(markdown).matchAll(/!?\[[^\]]*\]\(([^)\s]+)(?:\s+[^)]*)?\)/gu);
}

function validateRepresentationLinks(
  markdown,
  canonical,
  knownCanonicalURLs = [],
  knownFragmentsByCanonical = new Map(),
) {
  const known = new Set(knownCanonicalURLs.map(normalizedPublicURL));
  for (const match of markdownLinks(markdown)) {
    const url = new URL(match[1], canonical);
    if (privateApplicationOrigins.has(url.origin)) {
      throw new Error(`${canonical}: generated representation exposes private link ${url.href}`);
    }
    if (!publicContentOrigins.has(url.origin)) continue;
    if (url.pathname.startsWith("/assets/")) continue;
    if (knownCanonicalURLs.length === 0) continue;
    if (!known.has(normalizedPublicURL(url.href))) {
      throw new Error(`${canonical}: broken internal link ${url.href}`);
    }
    const targetFragments = knownFragmentsByCanonical.get(normalizedPublicURL(url.href));
    if (
      url.hash &&
      targetFragments &&
      !targetFragments.has(decodeURIComponent(url.hash.slice(1)))
    ) {
      throw new Error(`${canonical}: broken internal fragment ${url.hash}`);
    }
  }
}

function htmlFragments(source) {
  return new Set(
    descendants(parse(source))
      .map((node) => attribute(node, "id"))
      .filter(Boolean),
  );
}

async function verifyWrittenArtifacts(projection, generatedPages, corpus) {
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
  if (corpus !== undefined) {
    const writtenCorpus = await readFile(
      path.join(projection.outputDirectory, "llms-full.txt"),
      "utf8",
    );
    if (writtenCorpus !== corpus) {
      throw new Error("generated llms-full.txt does not match its canonical corpus metadata");
    }
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
  const knownFragmentsByCanonical = new Map();
  for (const target of projection.fragmentSources ?? []) {
    await requireSource(target.sourcePath);
    knownFragmentsByCanonical.set(
      normalizedPublicURL(target.canonical),
      htmlFragments(await readFile(target.sourcePath, "utf8")),
    );
  }
  for (const page of projection.pages) {
    await requireSource(page.sourcePath);
    const source = await readFile(page.sourcePath, "utf8");
    const rendered =
      projection.surface === "marketing"
        ? marketingRepresentation(source, page)
        : await documentationRepresentation(
            source,
            page,
            projection.sourceRoot ?? path.dirname(page.sourcePath),
          );
    const generated = { ...page, ...rendered };
    if (privateRoutePattern.test(new URL(generated.canonical).pathname)) {
      throw new Error(`generated page exposes a private application route: ${generated.canonical}`);
    }
    if (Buffer.byteLength(generated.markdown, "utf8") > maximumRepresentationBytes) {
      const exception = page.catalog?.agentRepresentation?.sizeException;
      if (exception?.reviewed !== true || !exception.reason?.trim()) {
        throw new Error(
          `${generated.canonical}: representation exceeds 256 KiB without a reviewed exception`,
        );
      }
    }
    if (page.discoveryHTMLPath) {
      await requireSource(page.discoveryHTMLPath);
      validateHTMLDiscovery(await readFile(page.discoveryHTMLPath, "utf8"), generated);
    } else if (projection.surface === "marketing") {
      validateHTMLDiscovery(source, generated);
    }
    if (projection.surface === "marketing") {
      knownFragmentsByCanonical.set(
        normalizedPublicURL(generated.canonical),
        htmlFragments(source),
      );
    }
    validateRepresentationLinks(
      generated.markdown,
      generated.canonical,
      projection.knownCanonicalURLs,
      knownFragmentsByCanonical,
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
  let corpus;
  if (projection.corpus) {
    corpus = corpusDocument(projection.corpus, generatedPages);
    const corpusBytes = Buffer.byteLength(corpus, "utf8");
    if (corpusBytes >= maximumCorpusBytes) {
      throw new Error(`documentation llms-full.txt reaches or exceeds 2 MiB`);
    }
    if (corpusBytes > corpusWarningBytes) {
      (projection.warn ?? console.warn)(
        `documentation llms-full.txt exceeds 1 MiB (${corpusBytes} bytes)`,
      );
    }
    await writeFile(path.join(projection.outputDirectory, "llms-full.txt"), corpus, "utf8");
  }
  await verifyWrittenArtifacts(projection, generatedPages, corpus);
  return generatedPages;
}

export const productionProjections = {
  marketing: {
    surface: "marketing",
    outputDirectory: path.join(repositoryRoot, "marketing-site/dist"),
    pages: marketingRouteManifest
      .filter((route) =>
        ["static", "platform", "comparison", "tool"].includes(route.agentRepresentation),
      )
      .map((route) => ({
        sourcePath: path.join(
          repositoryRoot,
          "marketing-site/dist",
          marketingHTMLArtifact(route.path),
        ),
        outputPath: marketingMarkdownArtifact(route.path),
        route,
      })),
    knownCanonicalURLs: [
      ...marketingRouteManifest.map((entry) => entry.canonical),
      ...docsSocialEntries.map((entry) => entry.canonical),
    ],
    fragmentSources: marketingRouteManifest.map((route) => ({
      canonical: route.canonical,
      sourcePath: path.join(
        repositoryRoot,
        "marketing-site/dist",
        marketingHTMLArtifact(route.path),
      ),
    })),
    discovery: {
      title: "OpenPost",
      description: "Create, adapt, schedule, and track social content from one workspace.",
      links: [
        ...marketingRouteManifest
          .filter(
            (route) =>
              route.agentRepresentation === "static" &&
              route.agentDiscovery.membership !== "unlisted",
          )
          .map((route) => ({
            title: route.path === "/" ? "OpenPost overview" : route.title,
            description: route.description,
            url: new URL(marketingMarkdownArtifact(route.path), `${marketingSiteUrl}/`).href,
            classification: route.agentDiscovery.membership,
          })),
        {
          title: "OpenPost documentation",
          description:
            "Read the user, provider, self-hosting, CLI, MCP, and developer documentation.",
          url: "https://docs.openpost.social/index.md",
          classification: "primary",
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
        {
          title: "Optional browser tools",
          description:
            "Browser-only tools for preparing content. These pages describe local interactive behavior, not a public machine API.",
          links: marketingRouteManifest
            .filter((entry) => entry.agentDiscovery?.section === "tools")
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
    sourceRoot: path.join(repositoryRoot, "docs-site"),
    corpus: { title: "OpenPost Documentation Full Corpus" },
    outputDirectory: path.join(repositoryRoot, "docs-site/.vitepress/dist"),
    pages: docsSocialEntries
      .filter((entry) => entry.agentRepresentation.membership === "ordinary")
      .map((entry) => ({
        sourcePath: path.join(repositoryRoot, "docs-site", entry.page),
        discoveryHTMLPath: path.join(
          repositoryRoot,
          "docs-site/.vitepress/dist",
          documentationHTMLArtifact(entry.page),
        ),
        outputPath: entry.page,
        page: entry.page,
        route: entry.route,
        catalog: entry,
        canonical: entry.canonical,
        title: entry.socialTitle,
        description: entry.description,
      })),
    knownCanonicalURLs: [
      ...docsSocialEntries.map((entry) => entry.canonical),
      ...marketingRouteManifest.map((entry) => entry.canonical),
      "https://docs.openpost.social/openapi.json",
    ],
    knownArtifactURLs: [
      "https://openpost.social/index.md",
      "https://docs.openpost.social/openapi.json",
      "https://docs.openpost.social/llms-full.txt",
    ],
    fragmentSources: docsSocialEntries.map((entry) => ({
      canonical: entry.canonical,
      sourcePath: path.join(
        repositoryRoot,
        "docs-site/.vitepress/dist",
        documentationHTMLArtifact(entry.page),
      ),
    })),
    discovery: {
      title: "OpenPost Documentation",
      description:
        "User, provider, self-hosting, CLI, MCP, operations, and developer documentation for OpenPost.",
      links: [
        ...docsSocialEntries
          .filter(
            (entry) => entry.page === "index.md" && entry.agentDiscovery.membership === "primary",
          )
          .map((entry) => ({
            title: "OpenPost documentation home",
            description: entry.description,
            url: new URL(entry.page, `${docsSiteUrl}/`).href,
            classification: entry.agentDiscovery.membership,
          })),
        {
          title: "OpenPost product overview",
          description: "See the public product overview and managed product path.",
          url: "https://openpost.social/index.md",
          classification: "optional",
        },
        {
          title: "OpenPost documentation full corpus",
          description:
            "Read the selected public documentation as one bounded OpenPost convenience artifact.",
          url: "https://docs.openpost.social/llms-full.txt",
          classification: "optional",
        },
      ],
      sections: documentationDiscoverySections.map(([key, title, description]) => ({
        title,
        description,
        links: [
          ...docsSocialEntries
            .filter(
              (entry) =>
                entry.agentDiscovery.membership === "primary" &&
                entry.agentDiscovery.section === key,
            )
            .map((entry) => ({
              title: entry.socialTitle,
              description: entry.description,
              url: new URL(entry.page, `${docsSiteUrl}/`).href,
            })),
          ...(key === "api"
            ? [
                {
                  title: "OpenAPI JSON",
                  description: "Use the authoritative machine-readable HTTP API contract.",
                  url: "https://docs.openpost.social/openapi.json",
                },
              ]
            : []),
        ],
      })),
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
