import { readFile, readdir } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const scriptDir = path.dirname(fileURLToPath(import.meta.url));
const docsRoot = path.resolve(scriptDir, "..");
const dist = path.join(docsRoot, ".vitepress/dist");
const problems = [];

async function walkHtml(directory) {
  const files = [];
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    const target = path.join(directory, entry.name);
    if (entry.isDirectory()) files.push(...(await walkHtml(target)));
    else if (entry.isFile() && entry.name.endsWith(".html") && entry.name !== "404.html") files.push(target);
  }
  return files;
}

const files = await walkHtml(dist);
for (const file of files) {
  const html = await readFile(file, "utf8");
  const route = path.relative(dist, file);
  for (const expected of [
    'property="og:site_name" content="OpenPost Docs"',
    'property="og:image:width" content="1200"',
    'property="og:image:height" content="630"',
    'name="twitter:card" content="summary_large_image"',
    "https://openpost.social/og?",
  ]) {
    if (!html.includes(expected)) problems.push(`${route}: missing ${expected}`);
  }
}

if (problems.length) {
  console.error(`Docs social metadata check failed:\n${problems.map((item) => `- ${item}`).join("\n")}`);
  process.exit(1);
}

console.log(`Checked social metadata for ${files.length} docs routes.`);
