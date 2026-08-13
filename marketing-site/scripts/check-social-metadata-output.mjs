import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { marketingSocialEntries } from "@openpost/social-images";

const scriptDir = path.dirname(fileURLToPath(import.meta.url));
const dist = path.resolve(scriptDir, "../dist");
const problems = [];

function outputFile(routePath) {
  return routePath === "/" ? path.join(dist, "index.html") : path.join(dist, `${routePath.slice(1)}.html`);
}

function count(html, value) {
  return html.split(value).length - 1;
}

for (const entry of marketingSocialEntries) {
  const file = outputFile(entry.path);
  let html;
  try {
    html = await readFile(file, "utf8");
  } catch (error) {
    problems.push(`${entry.path}: missing prerendered HTML at ${path.relative(dist, file)}`);
    continue;
  }

  const image = entry.imageUrl;
  const serializedImage = image.replaceAll("&", "&amp;");
  const expected = [
    ['property="og:title"', entry.socialTitle],
    ['property="og:description"', entry.description],
    ['property="og:url"', entry.canonical],
    ['property="og:image"', serializedImage],
    ['property="og:image:alt"', entry.imageAlt],
    ['name="twitter:card"', "summary_large_image"],
    ['name="twitter:image"', serializedImage],
  ];

  for (const [attribute, value] of expected) {
    if (!html.includes(attribute) || !html.includes(value)) {
      problems.push(`${entry.path}: missing ${attribute} with ${value}`);
    }
  }

  if (count(html, 'property="og:image"') !== 1) {
    problems.push(`${entry.path}: expected exactly one og:image tag`);
  }
  if (!image.startsWith("https://openpost.social/og?")) {
    problems.push(`${entry.path}: does not use the on-demand OG endpoint`);
  }
}

if (problems.length) {
  console.error(`Marketing social metadata check failed:\n${problems.map((item) => `- ${item}`).join("\n")}`);
  process.exit(1);
}

console.log(`Checked social metadata for ${marketingSocialEntries.length} marketing routes.`);
