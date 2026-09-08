import { readdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { load as parseYaml } from "js-yaml";
import { docsRouteFromPage } from "../../packages/social-images/src/docs-route.js";

const scriptDir = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(scriptDir, "../..");
const docsRoot = path.join(root, "apps/docs", "content", "docs");
const output = path.join(root, "packages/social-images/src/docs-catalog.js");

async function markdownFiles(directory) {
  const files = [];
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    if (entry.name.startsWith(".") || entry.name === "node_modules") continue;
    const target = path.join(directory, entry.name);
    if (entry.isDirectory()) files.push(...(await markdownFiles(target)));
    else if (entry.isFile() && /\.mdx?$/u.test(entry.name)) files.push(target);
  }
  return files;
}

function pageTitle(page, source) {
  const { data, body } = pageSource(source);
  if (typeof data.title === "string" && data.title.trim()) return data.title.trim();
  const heroName = data.hero?.name;
  if (typeof heroName === "string" && heroName.trim()) return heroName.trim();
  const heading = body.match(/^#\s+(.+)$/m)?.[1]?.trim();
  if (heading) return heading.replaceAll("`", "");
  if (page === "index.md" || page === "index.mdx") return "OpenPost";
  return path
    .basename(page)
    .replace(/\.mdx?$/u, "")
    .split("-")
    .map((word) => (word === "api" ? "API" : `${word[0].toUpperCase()}${word.slice(1)}`))
    .join(" ");
}

function pageSource(source) {
  const match = source.match(/^---\n([\s\S]*?)\n---\n?/u);
  if (!match) return { data: {}, body: source };
  return { data: parseYaml(match[1]) ?? {}, body: source.slice(match[0].length) };
}

function plainText(value) {
  return value
    .replace(/!?\[([^\]]+)\]\([^)]+\)/gu, "$1")
    .replace(/[`*_~]/gu, "")
    .replace(/<[^>]+>/gu, "")
    .replace(/\s+/gu, " ")
    .trim();
}

function concise(value) {
  const text = plainText(value);
  const sentence = text.match(/^.{1,159}?[.!?](?:\s|$)/u)?.[0]?.trim() ?? text;
  if (sentence.length <= 160) return sentence;
  return undefined;
}

function proseParagraphs(body) {
  let fenced = false;
  return body
    .split("\n")
    .map((line) => {
      if (/^\s*(?:```|~~~)/u.test(line)) {
        fenced = !fenced;
        return "";
      }
      return fenced ? "" : line;
    })
    .join("\n")
    .split(/\n\s*\n/gu);
}

function pageDescription(page, source) {
  const { data, body } = pageSource(source);
  if (typeof data.description === "string" && data.description.trim()) {
    const description = concise(data.description);
    if (description) return description;
    throw new Error(
      `${page}: frontmatter description must be a complete sentence under 160 characters`,
    );
  }
  if (typeof data.hero?.tagline === "string" && data.hero.tagline.trim()) {
    const description = concise(data.hero.tagline);
    if (description) return description;
  }
  const paragraphs = proseParagraphs(body);
  for (const paragraph of paragraphs) {
    const candidate = paragraph.trim();
    if (
      !candidate ||
      /^(?:#|```|:::|<!--|<ClientOnly>|<\/ClientOnly>)/u.test(candidate) ||
      /^(?:Reviewed|Updated|Last reviewed):/iu.test(candidate) ||
      /:\s*$/u.test(candidate) ||
      candidate.split("\n").every((line) => /^\s*(?:[-*+] |\d+\. |\|)/u.test(line))
    )
      continue;
    const description = concise(candidate);
    if (description) return description;
  }
  throw new Error(`${page}: documentation page needs a source-derived description`);
}

const discoveryEntrypoints = new Map([
  ["index.mdx", "user-guide"],
  ["guides/quickstart.mdx", "user-guide"],
  ["guides/accounts.mdx", "user-guide"],
  ["self-hosting/index.mdx", "self-hosting"],
  ["api-reference/index.mdx", "api"],
]);

const corpusExclusions = new Map();

const reviewedRepresentationSizeExceptions = new Map();

function corpusSection(page) {
  if (page === "index.mdx" || page.startsWith("guides/")) {
    return "user-guide";
  }
  if (page.startsWith("api-reference/")) return "api";
  const topLevel = page.split("/", 1)[0];
  if (topLevel === "reference") return "api";
  if (["self-hosting"].includes(topLevel)) {
    return topLevel;
  }
  throw new Error(`${page}: documentation page needs a corpus section`);
}

function pagePolicy(page) {
  if (page.startsWith("api-reference/") && page !== "api-reference/index.mdx") {
    return {
      agentRepresentation: { membership: "special" },
      agentDiscovery: { membership: "unlisted" },
      agentCorpus: {
        membership: "excluded",
        reason: "Generated operation pages are represented by the authoritative OpenAPI contract.",
      },
    };
  }
  const section = discoveryEntrypoints.get(page);
  const corpusReason = corpusExclusions.get(page);
  const sizeExceptionReason = reviewedRepresentationSizeExceptions.get(page);
  return {
    agentRepresentation: sizeExceptionReason
      ? {
          membership: "ordinary",
          sizeException: { reviewed: true, reason: sizeExceptionReason },
        }
      : { membership: "ordinary" },
    agentDiscovery: section
      ? { membership: "primary", section }
      : page === "index.md"
        ? { membership: "primary" }
        : { membership: "unlisted" },
    agentCorpus: corpusReason
      ? { membership: "excluded", reason: corpusReason }
      : { membership: "included", section: corpusSection(page) },
  };
}

export async function generateSocialCatalog({ check = false } = {}) {
  const pages = [];
  for (const file of (await markdownFiles(docsRoot)).sort()) {
    const page = path.relative(docsRoot, file).split(path.sep).join("/");
    const source = await readFile(file, "utf8");
    pages.push({
      page,
      title: pageTitle(page, source),
      description: pageDescription(page, source),
      route: docsRouteFromPage(page),
      ...pagePolicy(page),
    });
  }

  assertUniqueDocumentationRoutes(pages);

  const contents = `// Generated by scripts/social-images/catalog.mjs. Do not edit by hand.\n// prettier-ignore\nexport const docsPageCatalog = Object.freeze(${JSON.stringify(pages, null, 2)});\n`;
  if (check) {
    const current = await readFile(output, "utf8").catch(() => "");
    if (current !== contents) {
      throw new Error(
        "The social image docs catalog is stale. Run bun run generate:social-catalog.",
      );
    }
    return;
  }
  await writeFile(output, contents);
}

export function assertUniqueDocumentationRoutes(pages) {
  const routes = new Map();
  for (const { page, route } of pages) {
    const normalizedRoute = route === "/" ? route : route.replace(/\/$/u, "");
    const existingPage = routes.get(normalizedRoute);
    if (existingPage) {
      throw new Error(
        `${page}: duplicate documentation route ${route} already belongs to ${existingPage}`,
      );
    }
    routes.set(normalizedRoute, page);
  }
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  await generateSocialCatalog({ check: process.argv.includes("--check") });
}
