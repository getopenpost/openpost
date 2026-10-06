import { readFile, readdir } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { parseFragment } from "parse5";
import { docsSocialEntries, docsSocialImageUrlForRoute } from "@openpost/social-images";

const scriptDir = path.dirname(fileURLToPath(import.meta.url));
const docsRoot = path.resolve(scriptDir, "..");
const dist = path.join(docsRoot, "out");
const problems = [];
const imageUrls = new Set();

async function walkHtml(directory) {
  const files = [];
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    const target = path.join(directory, entry.name);
    if (entry.isDirectory()) files.push(...(await walkHtml(target)));
    else if (
      entry.isFile() &&
      entry.name.endsWith(".html") &&
      !["404.html", "_not-found.html"].includes(entry.name)
    )
      files.push(target);
  }
  return files;
}

const files = await walkHtml(dist);
let checkedPages = 0;
for (const file of files) {
  const html = await readFile(file, "utf8");
  const outputPath = path.relative(dist, file).split(path.sep).join("/");
  const route =
    outputPath === "index.html" ? "/" : `/${outputPath.replace(/(?:\/index)?\.html$/, "")}`;
  const documentTitle = html.match(/<title>([^<]+) \| OpenPost Docs<\/title>/u)?.[1];
  const headHTML = html.match(/<head(?:\s[^>]*)?>([\s\S]*?)<\/head>/iu)?.[1] ?? "";
  const head = parseFragment(headHTML);
  const noindex = head.childNodes.some((node) => {
    if (node.tagName !== "meta") return false;
    const name = node.attrs.find((attribute) => attribute.name === "name")?.value.toLowerCase();
    const content = node.attrs
      .find((attribute) => attribute.name === "content")
      ?.value.toLowerCase();
    return name === "robots" && content?.split(/[,\s]+/u).includes("noindex");
  });
  if (noindex) {
    if (!documentTitle && !docsSocialEntries.some((entry) => entry.route === route)) continue;
    problems.push(`${outputPath}: a catalogue page must remain indexable`);
  }
  checkedPages += 1;
  const imageUrl = docsSocialImageUrlForRoute(route);
  imageUrls.add(imageUrl);
  const openGraphTitle = html.match(/property="og:title" content="([^"]+)"/u)?.[1];
  if (!documentTitle || openGraphTitle !== documentTitle) {
    problems.push(`${outputPath}: Open Graph title does not match the page title`);
  } else if (openGraphTitle.length > 80) {
    problems.push(`${outputPath}: Open Graph title exceeds 80 characters`);
  }
  for (const expected of [
    'property="og:site_name" content="OpenPost Docs"',
    'property="og:image:type" content="image/png"',
    'property="og:image:width" content="1200"',
    'property="og:image:height" content="630"',
    'name="twitter:card" content="summary_large_image"',
    'name="twitter:image:alt"',
    imageUrl,
  ]) {
    if (!html.includes(expected)) problems.push(`${outputPath}: missing ${expected}`);
  }
  if (html.split('property="og:image"').length - 1 !== 1) {
    problems.push(`${outputPath}: expected exactly one og:image tag`);
  }
  if (html.includes("https://openpo.st/og?")) {
    problems.push(`${outputPath}: still references the retired social image renderer`);
  }

  const imagePath = new URL(imageUrl).pathname.replace(/^\/docs\//u, "");
  const imageFile = path.join(dist, imagePath);
  try {
    const png = await readFile(imageFile);
    if (!png.subarray(1, 4).equals(Buffer.from("PNG"))) {
      problems.push(`${outputPath}: social image is not a PNG`);
    } else if (png.readUInt32BE(16) !== 1200 || png.readUInt32BE(20) !== 630) {
      problems.push(`${outputPath}: social image is not 1200x630`);
    }
  } catch {
    problems.push(`${outputPath}: missing social image at ${path.relative(dist, imageFile)}`);
  }
}

if (imageUrls.size !== checkedPages) {
  problems.push("docs routes do not have unique social image URLs");
}
const generatedImages = (await readdir(path.join(dist, "og"))).filter((file) =>
  file.endsWith(".png"),
);
if (generatedImages.length !== checkedPages) {
  problems.push(`expected ${checkedPages} generated images, found ${generatedImages.length}`);
}
const redirects = await readFile(path.join(dist, "_redirects"), "utf8");
if (!/^\/assets\/brand\/og-docs\.png \/og\/home\.png 302$/mu.test(redirects)) {
  problems.push("legacy docs social image does not redirect to the generated home card");
}

if (problems.length) {
  console.error(
    `Docs social metadata check failed:\n${problems.map((item) => `- ${item}`).join("\n")}`,
  );
  process.exit(1);
}

console.log(`Checked social metadata for ${checkedPages} docs routes.`);
