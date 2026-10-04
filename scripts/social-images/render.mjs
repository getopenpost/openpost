import { createCanvas, GlobalFonts, loadImage } from "@napi-rs/canvas";
import lucide from "@iconify-json/lucide/icons.json" with { type: "json" };
import { existsSync } from "node:fs";
import { mkdir, readdir, readFile, rm, writeFile } from "node:fs/promises";
import { dirname, extname, join, relative, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";
import yaml from "js-yaml";

import {
  docsSocialImageKey,
  marketingSocialEntries,
  mediaConversionTools,
  mediaToolThumbnailTone,
  imageConversions,
  previewTools,
} from "../../packages/social-images/src/index.js";

export const SOCIAL_IMAGE_WIDTH = 1200;
export const SOCIAL_IMAGE_HEIGHT = 630;

const root = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
const docsContentRoot = join(root, "apps/docs/content/docs");
const defaultOutputDirectories = {
  marketing: join(root, "apps/marketing/static/og"),
  docs: join(root, "apps/docs/public/og"),
  "app-editors": join(root, "apps/web/static/og"),
};
const palettes = {
  mint: { paper: "#e0efcf", ink: "#263e2c", dark: "#2c3c30", light: "#e0efcf" },
  blue: { paper: "#d5eaf4", ink: "#293e53", dark: "#293c4a", light: "#d5eaf4" },
  lilac: { paper: "#e8ddf3", ink: "#463652", dark: "#3d3048", light: "#e8ddf3" },
};
const providerColors = {
  bluesky: "#1185fe",
  discord: "#5865f2",
  facebook: "#1877f2",
  instagram: "#e1306c",
  lemmy: "#00a878",
  linkedin: "#0a66c2",
  mastodon: "#6364ff",
  peertube: "#f1680d",
  piefed: "#ff6847",
  pinterest: "#e60023",
  pixelfed: "#4f5d75",
  telegram: "#229ed9",
  threads: "#302b28",
  tiktok: "#111111",
  x: "#302b28",
  youtube: "#ff0033",
};
const imageCache = new Map();
let fontsLoaded = false;

function loadFonts() {
  if (fontsLoaded) return;
  const fontRoot = join(root, "assets/brand/fonts");
  GlobalFonts.registerFromPath(join(fontRoot, "Geist-Regular.ttf"), "Geist");
  GlobalFonts.registerFromPath(join(fontRoot, "Geist-SemiBold.ttf"), "Geist");
  GlobalFonts.registerFromPath(join(fontRoot, "Manrope-SemiBold.ttf"), "Manrope");
  fontsLoaded = true;
}

async function cachedImage(path, color = "#302b28") {
  const key = `${path}:${color}`;
  if (!imageCache.has(key)) {
    imageCache.set(
      key,
      extname(path) === ".svg"
        ? readFile(path, "utf8").then((source) =>
            loadImage(
              Buffer.from(
                source
                  .replace(
                    /<svg([^>]*)>/u,
                    (_, attributes) =>
                      `<svg${attributes.replace(/\s(?:width|height)="[^"]*"/gu, "")} width="512" height="512">`,
                  )
                  .replaceAll("currentColor", color),
              ),
            ),
          )
        : loadImage(path),
    );
  }
  return imageCache.get(key);
}

function setFont(context, size, weight = 600, family = "Geist") {
  context.font = `${weight} ${size}px ${family}`;
}

function providerSlug(entry) {
  const preview = previewTools.find((tool) => entry.path === `/tools/${tool.slug}`);
  if (preview) return preview.platform;
  return entry.path.match(/^\/(?:platforms|self-hosting\/integrations)\/([^/]+)$/)?.[1];
}

function logoPath(entry) {
  const provider = providerSlug(entry);
  const service = entry.path
    .match(
      /^\/self-hosting\/(casaos|coolify|docker-run|dockge|dokploy|nixos|portainer|zimaos)$/,
    )?.[1]
    ?.replace("docker-run", "docker");
  const slug = provider || service;
  if (!slug) return undefined;
  for (const extension of ["svg", "png"]) {
    const path = join(root, `assets/logos/${slug}.${extension}`);
    if (existsSync(path)) return path;
  }
}

// Specific operations precede broad topics so tool previews describe their actual job.
const topicRules = [
  [/color-picker/, "pipette", "lilac"],
  [/paste-image/, "clipboard-paste", "blue"],
  [/remove-background|background-remover/, "scan-line", "mint"],
  [/remove-audio|mute/, "volume-x", "blue"],
  [/extract-audio/, "file-music", "lilac"],
  [/compress/, "minimize-2", "mint"],
  [/resize/, "scaling", "blue"],
  [/crop/, "crop", "mint"],
  [/rotate/, "rotate-cw", "lilac"],
  [/flip/, "flip-horizontal-2", "blue"],
  [/codec|metadata|media-info/, "scan-search", "blue"],
  [/audio|transcript/, "audio-lines", "lilac"],
  [/quick-cut|trim/, "scissors", "blue"],
  [/record/, "screen-share", "blue"],
  [/video|motion/, "clapperboard", "blue"],
  [/image-editor|image-converter|image|media|screenshot/, "image", "mint"],
  [/logo/, "pen-tool", "lilac"],
  [/character-counter/, "letter-text", "lilac"],
  [/thread/, "messages-square", "blue"],
  [/handle/, "at-sign", "mint"],
  [/formatter/, "text-cursor-input", "lilac"],
  [/utm|link/, "link", "mint"],
  [/preview/, "panels-top-left", "blue"],
  [/security|privacy|trust|permissions/, "shield-check", "mint"],
  [/schedul|calendar|time-to-post/, "calendar-days", "mint"],
  [/analytics|results/, "chart-no-axes-combined", "mint"],
  [/inbox|contact/, "inbox", "lilac"],
  [/workspaces|accounts/, "users", "blue"],
  [/workflows|automate\/n8n/, "workflow", "lilac"],
  [/automate\/cli/, "terminal", "blue"],
  [/api-reference|automate\/api|automate\/sdk/, "code-xml", "blue"],
  [/mcp|automate/, "plug", "lilac"],
  [/self-hosting/, "server", "blue"],
  [/publishing|compose/, "send", "mint"],
  [/pricing|refund/, "wallet", "mint"],
  [/platforms/, "share-2", "blue"],
  [/tools/, "pencil-ruler", "lilac"],
  [/faq|troubleshooting/, "circle-question-mark", "mint"],
];

function topicForEntry(entry) {
  const [, icon = "book-open", tone = "lilac"] =
    topicRules.find(([pattern]) => pattern.test(entry.path)) ?? [];
  const slug = entry.path.split("/")[2];
  const catalogueTone = entry.kind === "tool" ? mediaToolThumbnailTone(slug) : undefined;
  return { icon, palette: palettes[catalogueTone || tone] };
}

function wrapText(context, text, maxWidth) {
  const lines = [];
  let line = "";
  for (const word of text.trim().split(/\s+/u)) {
    const candidate = line ? `${line} ${word}` : word;
    if (line && context.measureText(candidate).width > maxWidth) {
      lines.push(line);
      line = word;
    } else line = candidate;
  }
  if (line) lines.push(line);
  return lines;
}

function fitTitle(context, title) {
  for (let size = 88; size >= 40; size -= 2) {
    setFont(context, size);
    const lines = wrapText(context, title, 640);
    if (lines.length <= 3 && lines.every((line) => context.measureText(line).width <= 640)) {
      return { size, lines };
    }
  }
  throw new Error(`Social title does not fit: ${title}`);
}

async function drawIcon(context, name, ink, x, y, size) {
  const key = `lucide:${name}:${ink}`;
  if (!imageCache.has(key)) {
    const icon = lucide.icons[name];
    if (!icon) throw new Error(`Unknown social image icon: ${name}`);
    const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" width="512" height="512">${icon.body.replaceAll("currentColor", ink).replaceAll('stroke-width="2"', 'stroke-width="1.5"')}</svg>`;
    imageCache.set(key, loadImage(Buffer.from(svg)));
  }
  context.drawImage(await imageCache.get(key), x, y, size, size);
}

function drawContained(context, image, x, y, size) {
  const ratio = Math.min(size / image.width, size / image.height);
  const width = image.width * ratio;
  const height = image.height * ratio;
  context.drawImage(image, x + (size - width) / 2, y + (size - height) / 2, width, height);
}

async function drawSubject(context, entry, icon, ink) {
  const path = logoPath(entry);
  if (path) {
    // Provider assets keep their authored colors on a light panel in both families.
    drawContained(
      context,
      await cachedImage(path, providerColors[providerSlug(entry)]),
      832,
      179,
      304,
    );
    return;
  }
  const slug = entry.path.split("/")[2];
  const conversion = [...imageConversions, ...mediaConversionTools].find(
    (tool) => tool.slug === slug && tool.input,
  );
  if (!conversion) return drawIcon(context, icon, ink, 832, 179, 304);
  context.fillStyle = ink;
  context.textAlign = "center";
  setFont(context, 60);
  context.fillText(conversion.input.toUpperCase(), 984, 250);
  await drawIcon(context, "arrow-down", ink, 938, 282, 92);
  context.fillText(conversion.output.toUpperCase(), 984, 454);
  context.textAlign = "left";
}

async function drawBrand(context, { docs = false, y = 56 } = {}) {
  const mark = await cachedImage(join(root, `assets/brand/logo${docs ? "-dark" : ""}.svg`));
  context.drawImage(mark, 64, y, 40, 40);
  context.fillStyle = docs ? "#f6f1eb" : "#302b28";
  setFont(context, 30, 600, "Manrope");
  context.fillText("OpenPost", 120, y + 31);
}

export async function renderSocialCard(entry) {
  loadFonts();
  const canvas = createCanvas(SOCIAL_IMAGE_WIDTH, SOCIAL_IMAGE_HEIGHT);
  const context = canvas.getContext("2d");
  if (entry.kind === "home") {
    const art = await cachedImage(join(root, "assets/brand/social/home.png"));
    context.drawImage(art, 0, 0, SOCIAL_IMAGE_WIDTH, SOCIAL_IMAGE_HEIGHT);
    await drawBrand(context, { y: 100 });
    return canvas.toBuffer("image/png");
  }

  const docs = entry.kind === "docs";
  const { icon, palette } = topicForEntry(entry);
  const provider = logoPath(entry);
  const ink = docs ? "#f6f1eb" : "#302b28";
  const subjectInk = docs && !provider ? palette.light : palette.ink;
  context.fillStyle = docs ? "#191512" : "#fbfaf7";
  context.fillRect(0, 0, SOCIAL_IMAGE_WIDTH, SOCIAL_IMAGE_HEIGHT);
  context.fillStyle = docs && !provider ? palette.dark : palette.paper;
  context.fillRect(768, 0, 432, SOCIAL_IMAGE_HEIGHT);

  await drawBrand(context, { docs });
  context.fillStyle = ink;
  const title = entry.socialTitle;
  const { size, lines } = fitTitle(context, title);
  const lineHeight = size * 1.06;
  const firstBaseline = 320 - ((lines.length - 1) * lineHeight) / 2 + size * 0.35;
  lines.forEach((line, index) => context.fillText(line, 64, firstBaseline + index * lineHeight));

  setFont(context, 26, 400);
  context.fillStyle = docs ? "#c6bbb3" : "#655b55";
  const label = docs
    ? `Docs / ${entry.sectionLabel || "Documentation"}`
    : entry.kind === "tool" || entry.kind === "tools-index"
      ? "Free tools"
      : entry.kind === "platform"
        ? "Social channels"
        : entry.label || "openpo.st";
  context.fillText(label === "Docs / Documentation" ? "Documentation" : label, 64, 566);
  await drawSubject(context, entry, icon, subjectInk);
  return canvas.toBuffer("image/png");
}

function parseFrontmatter(source, path) {
  const match = source.match(/^---\r?\n([\s\S]*?)\r?\n---(?:\r?\n|$)/);
  if (!match) throw new Error(`Missing frontmatter in ${path}`);
  return yaml.load(match[1]);
}

async function walkMdx(directory) {
  const entries = await readdir(directory, { withFileTypes: true });
  const files = [];
  for (const entry of entries) {
    const path = join(directory, entry.name);
    if (entry.isDirectory()) files.push(...(await walkMdx(path)));
    else if ([".md", ".mdx"].includes(extname(entry.name))) files.push(path);
  }
  return files;
}

function docsRouteForFile(path) {
  const relativePath = relative(docsContentRoot, path).split(sep).join("/");
  const withoutExtension = relativePath.replace(/\.mdx?$/, "");
  const withoutIndex = withoutExtension.replace(/(^|\/)index$/, "");
  return withoutIndex ? `/${withoutIndex}` : "/";
}

function docsSectionLabel(route) {
  if (route.startsWith("/video-editor")) return "Video Editor";
  if (route.startsWith("/workflows")) return "Workflows";
  if (route.startsWith("/automate")) return "Automation";
  if (route.startsWith("/api-reference")) return "API reference";
  if (route.startsWith("/self-hosting/integrations")) return "Integration guide";
  if (route.startsWith("/self-hosting")) return "Self-hosting";
  if (route.startsWith("/mcp")) return "MCP guide";
  if (route.startsWith("/guides")) return "Product guide";
  return "Documentation";
}

export async function readDocsSocialEntries() {
  const files = await walkMdx(docsContentRoot);
  const entries = [];
  for (const path of files) {
    const route = docsRouteForFile(path);
    const frontmatter = parseFrontmatter(await readFile(path, "utf8"), path);
    if (!frontmatter?.title) throw new Error(`Missing title in ${path}`);
    entries.push({
      id: `docs:${route}`,
      key: docsSocialImageKey(route),
      kind: "docs",
      path: route,
      socialTitle: String(frontmatter.title),
      sectionLabel: docsSectionLabel(route),
    });
  }
  const keys = new Set();
  for (const entry of entries) {
    if (keys.has(entry.key)) throw new Error(`Duplicate docs social image key: ${entry.key}`);
    keys.add(entry.key);
  }
  return entries.sort((left, right) => left.path.localeCompare(right.path));
}

export async function generateSocialImages({ surface, outputDirectory, keys } = {}) {
  if (!defaultOutputDirectories[surface])
    throw new Error(`Unknown social image surface: ${surface}`);
  if (keys?.length && !outputDirectory) {
    throw new Error("Selected social image generation requires an explicit output directory");
  }
  const destination = outputDirectory
    ? resolve(outputDirectory)
    : defaultOutputDirectories[surface];
  const allEntries =
    surface === "marketing" ? marketingSocialEntries : await readDocsSocialEntries();
  const selectedEntries = keys?.length
    ? allEntries.filter((entry) => keys.includes(entry.key))
    : allEntries;
  const missingKeys =
    keys?.filter((key) => !selectedEntries.some((entry) => entry.key === key)) ?? [];
  if (missingKeys.length) throw new Error(`Unknown social image keys: ${missingKeys.join(", ")}`);

  await rm(destination, { recursive: true, force: true });
  await mkdir(destination, { recursive: true });
  for (const entry of selectedEntries) {
    await writeFile(join(destination, `${entry.key}.png`), await renderSocialCard(entry));
  }
  return { destination, entries: selectedEntries };
}

export function defaultSocialImageOutputDirectory(surface) {
  return defaultOutputDirectories[surface];
}

// Static OG cards for the public shareable app editor start pages. Copy is generic
// (no workspace or project names) and screenshots are existing repo demo captures.
export const appEditorSocialEntries = [
  {
    key: "app-quick-cut",
    socialTitle: "Quick Cut",
    description:
      "Trim and join compatible video segments locally with Quick Cut. A separate, focused tool for cuts without re-encoding.",
    label: "Free video trimmer",
    screenshot: "video-transcript-light.png",
    tone: "blue",
  },
  {
    key: "app-video-editor",
    socialTitle: "Video Editor",
    description:
      "Record or import footage, edit for four social formats, and export without a watermark.",
    label: "Free video editor",
    screenshot: "video-editor-light.png",
    tone: "blue",
  },
  {
    key: "app-image-editor",
    socialTitle: "Image Editor",
    description: "Create posts, carousel pages, Story slides, and thumbnails in your browser.",
    label: "Free image editor",
    screenshot: "image-start-light.png",
    tone: "mint",
  },
];

export function appEditorSocialImageUrl(entry) {
  return `https://app.openpo.st/og/${entry.key}.png`;
}

function drawCover(context, image, x, y, width, height) {
  const scale = Math.max(width / image.width, height / image.height);
  const drawWidth = image.width * scale;
  const drawHeight = image.height * scale;
  context.save();
  context.beginPath();
  context.rect(x, y, width, height);
  context.clip();
  context.drawImage(
    image,
    x + (width - drawWidth) / 2,
    y + (height - drawHeight) / 2,
    drawWidth,
    drawHeight,
  );
  context.restore();
}

export async function renderAppEditorCard(entry) {
  loadFonts();
  const found = appEditorSocialEntries.find((candidate) => candidate.key === entry.key);
  if (!found) throw new Error(`Unknown app editor social image key: ${entry.key}`);
  const palette = palettes[found.tone];
  const canvas = createCanvas(SOCIAL_IMAGE_WIDTH, SOCIAL_IMAGE_HEIGHT);
  const context = canvas.getContext("2d");
  context.fillStyle = "#fbfaf7";
  context.fillRect(0, 0, SOCIAL_IMAGE_WIDTH, SOCIAL_IMAGE_HEIGHT);
  context.fillStyle = palette.paper;
  context.fillRect(704, 0, 496, SOCIAL_IMAGE_HEIGHT);

  await drawBrand(context, {});
  context.fillStyle = "#302b28";
  const { size, lines } = fitTitle(context, found.socialTitle);
  const lineHeight = size * 1.06;
  const firstBaseline = 300 - ((lines.length - 1) * lineHeight) / 2 + size * 0.35;
  lines.forEach((line, index) => context.fillText(line, 64, firstBaseline + index * lineHeight));

  setFont(context, 27, 400);
  context.fillStyle = "#655b55";
  const descriptionLines = wrapText(context, found.description, 576).slice(0, 4);
  descriptionLines.forEach((line, index) =>
    context.fillText(line, 64, firstBaseline + lines.length * lineHeight + 24 + index * 36),
  );
  context.fillText(found.label, 64, 566);

  const screenshot = await cachedImage(join(root, "assets/screenshots", found.screenshot));
  drawCover(context, screenshot, 736, 48, 400, 534);
  context.strokeStyle = "#302b28";
  context.lineWidth = 2;
  context.strokeRect(736, 48, 400, 534);
  return canvas.toBuffer("image/png");
}

export async function generateAppEditorImages({ outputDirectory, keys } = {}) {
  const destination = outputDirectory
    ? resolve(outputDirectory)
    : defaultOutputDirectories["app-editors"];
  const selectedEntries = keys?.length
    ? appEditorSocialEntries.filter((entry) => keys.includes(entry.key))
    : appEditorSocialEntries;
  const missingKeys =
    keys?.filter((key) => !selectedEntries.some((entry) => entry.key === key)) ?? [];
  if (missingKeys.length) throw new Error(`Unknown app editor keys: ${missingKeys.join(", ")}`);

  await mkdir(destination, { recursive: true });
  for (const entry of selectedEntries) {
    await writeFile(join(destination, `${entry.key}.png`), await renderAppEditorCard(entry));
  }
  return { destination, entries: selectedEntries };
}
