import { createCanvas, GlobalFonts, loadImage } from "@napi-rs/canvas";
import { existsSync } from "node:fs";
import { mkdir, readdir, readFile, rm, writeFile } from "node:fs/promises";
import { dirname, extname, join, relative, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";
import yaml from "js-yaml";

import {
  docsSocialImageKey,
  marketingSocialEntries,
} from "../../packages/social-images/src/index.js";

export const SOCIAL_IMAGE_WIDTH = 1200;
export const SOCIAL_IMAGE_HEIGHT = 630;

const root = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
const docsContentRoot = join(root, "apps/docs/content/docs");
const defaultOutputDirectories = {
  marketing: join(root, "apps/marketing/static/og"),
  docs: join(root, "apps/docs/public/og"),
};

const colors = {
  marketing: {
    background: "#fbfaf7",
    surface: "#f2eee8",
    ink: "#302b28",
    muted: "#736b65",
    line: "#ddd7cf",
    brand: "#b45309",
  },
  docs: {
    background: "#191512",
    surface: "#241e1a",
    ink: "#f6f1eb",
    muted: "#aaa099",
    line: "#403731",
    brand: "#fd975d",
  },
};

const accents = {
  orange: { marketing: "#f4d8c5", docs: "#8e4424" },
  blue: { marketing: "#dce8f3", docs: "#395873" },
  green: { marketing: "#d9eadf", docs: "#365c49" },
  lilac: { marketing: "#e8def0", docs: "#5c476d" },
  yellow: { marketing: "#eee6bd", docs: "#6b5d32" },
};

const imageCache = new Map();
let fontsLoaded = false;

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

function loadFonts() {
  if (fontsLoaded) return;
  const fontRoot = join(root, "assets/brand/fonts");
  GlobalFonts.registerFromPath(join(fontRoot, "Geist-Regular.ttf"), "Geist");
  GlobalFonts.registerFromPath(join(fontRoot, "Geist-SemiBold.ttf"), "Geist");
  GlobalFonts.registerFromPath(join(fontRoot, "Manrope-SemiBold.ttf"), "Manrope");
  fontsLoaded = true;
}

async function cachedImage(path, color) {
  const cacheKey = `${path}:${color ?? "original"}`;
  if (!imageCache.has(cacheKey)) {
    const image =
      extname(path) === ".svg"
        ? readFile(path, "utf8").then((source) => {
            const scaled = source
              .replace(/<svg([^>]*)>/u, (_match, attributes) => {
                const dimensionsRemoved = attributes.replace(/\s(?:width|height)="[^"]*"/gu, "");
                return `<svg${dimensionsRemoved} width="512" height="512">`;
              })
              .replaceAll("currentColor", color ?? "#302b28");
            return loadImage(Buffer.from(scaled));
          })
        : loadImage(path);
    imageCache.set(cacheKey, image);
  }
  return imageCache.get(cacheKey);
}

function setFont(context, size, weight = 400, family = "Geist") {
  context.font = `${weight} ${size}px ${family}`;
}

function roundedRect(context, x, y, width, height, radius) {
  const r = Math.min(radius, width / 2, height / 2);
  context.beginPath();
  context.moveTo(x + r, y);
  context.lineTo(x + width - r, y);
  context.quadraticCurveTo(x + width, y, x + width, y + r);
  context.lineTo(x + width, y + height - r);
  context.quadraticCurveTo(x + width, y + height, x + width - r, y + height);
  context.lineTo(x + r, y + height);
  context.quadraticCurveTo(x, y + height, x, y + height - r);
  context.lineTo(x, y + r);
  context.quadraticCurveTo(x, y, x + r, y);
  context.closePath();
}

function hashString(value) {
  let hash = 2166136261;
  for (const character of value) {
    hash ^= character.codePointAt(0);
    hash = Math.imul(hash, 16777619);
  }
  return hash >>> 0;
}

function routeSegments(path) {
  return path.split("/").filter(Boolean);
}

function providerSlug(path) {
  const segments = routeSegments(path);
  const integrationsIndex = segments.indexOf("integrations");
  if (integrationsIndex >= 0 && segments[integrationsIndex + 1] !== "troubleshooting") {
    return segments[integrationsIndex + 1];
  }
  const platformsIndex = segments.indexOf("platforms");
  return platformsIndex >= 0 ? segments[platformsIndex + 1] : undefined;
}

function serviceSlug(path) {
  if (!path.startsWith("/self-hosting/")) return undefined;
  const slug = routeSegments(path)[1];
  return [
    "casaos",
    "coolify",
    "docker-run",
    "dockge",
    "dokploy",
    "nixos",
    "portainer",
    "zimaos",
  ].includes(slug)
    ? slug.replace("docker-run", "docker")
    : undefined;
}

function imagePathForEntry(entry) {
  const provider = providerSlug(entry.path);
  if (provider) {
    const path = join(root, `assets/logos/${provider}.svg`);
    if (existsSync(path)) return path;
  }
  const service = serviceSlug(entry.path);
  if (service) {
    for (const extension of ["svg", "png"]) {
      const path = join(root, `assets/logos/${service}.${extension}`);
      if (existsSync(path)) return path;
    }
  }
  return undefined;
}

function motifForEntry(entry) {
  if (imagePathForEntry(entry)) return "logo";
  if (entry.kind === "security" || /security|privacy|trust/.test(entry.path)) return "security";
  if (entry.path.startsWith("/api-reference")) return "api";
  if (entry.path.startsWith("/mcp")) return "connections";
  if (entry.path.startsWith("/self-hosting")) return "server";
  if (entry.kind === "tool" || entry.kind === "tools-index") return "tools";
  if (entry.path.includes("schedul") || entry.path.includes("calendar")) return "calendar";
  if (entry.path.includes("analytics") || entry.path.includes("results")) return "analytics";
  if (entry.path.includes("editor") || entry.path.includes("media")) return "media";
  if (entry.kind === "home" || entry.kind === "platforms" || entry.kind === "workflow")
    return "workflow";
  return "document";
}

function accentNameForEntry(entry, motif) {
  if (motif === "security") return "green";
  if (motif === "api" || motif === "connections") return "blue";
  if (motif === "media" || motif === "tools") return "lilac";
  if (motif === "calendar" || motif === "analytics") return "yellow";
  if (entry.kind === "platform" || motif === "logo") return "blue";
  return "orange";
}

function wrapText(context, text, maxWidth, maxLines) {
  const words = String(text).trim().split(/\s+/).filter(Boolean);
  const lines = [];
  let line = "";

  for (const word of words) {
    const candidate = line ? `${line} ${word}` : word;
    if (!line || context.measureText(candidate).width <= maxWidth) {
      line = candidate;
      continue;
    }
    lines.push(line);
    line = word;
  }
  if (line) lines.push(line);
  if (lines.length <= maxLines) return lines;

  const visible = lines.slice(0, maxLines);
  let finalLine = visible[maxLines - 1];
  const remaining = lines.slice(maxLines - 1).join(" ");
  finalLine = remaining;
  while (finalLine && context.measureText(`${finalLine}…`).width > maxWidth) {
    finalLine = finalLine.slice(0, -1).trimEnd();
  }
  visible[maxLines - 1] = `${finalLine}…`;
  return visible;
}

function fitTitle(context, title) {
  const maxWidth = 690;
  for (let size = 64; size >= 46; size -= 2) {
    setFont(context, size, 600, "Manrope");
    const lines = wrapText(context, title, maxWidth, 3);
    if (lines.length <= 2 || size === 46) return { size, lines };
  }
  throw new Error("Unable to fit social image title");
}

function drawDither(context, entry, x, y, color) {
  const hash = hashString(entry.key);
  context.fillStyle = color;
  context.globalAlpha = 0.34;
  for (let row = 0; row < 10; row += 1) {
    for (let column = 0; column < 8; column += 1) {
      const bit = (hash >>> ((row * 3 + column * 5) % 29)) & 1;
      if (bit === 0 && (row + column) % 3 !== 0) continue;
      const size = (row + column) % 4 === 0 ? 5 : 3;
      context.fillRect(x + column * 30, y + row * 30, size, size);
    }
  }
  context.globalAlpha = 1;
}

function drawFrame(context, palette) {
  context.strokeStyle = palette.line;
  context.lineWidth = 1;
  roundedRect(context, 48.5, 48.5, 1103, 533, 22);
  context.stroke();
}

async function drawBrand(context, surface) {
  const palette = colors[surface];
  const logoPath = join(root, `assets/brand/logo${surface === "docs" ? "-dark" : ""}.svg`);
  const logo = await cachedImage(logoPath);
  context.drawImage(logo, 78, 76, 38, 38);
  context.fillStyle = palette.ink;
  setFont(context, 25, 600, "Manrope");
  context.fillText("OpenPost", 132, 105);
  context.fillStyle = palette.muted;
  setFont(context, 18, 400);
  context.textAlign = "right";
  context.fillText(surface === "docs" ? "openpo.st/docs" : "openpo.st", 1122, 103);
  context.textAlign = "left";
}

function drawMotifBase(context, palette, accent) {
  context.fillStyle = accent;
  roundedRect(context, 874, 174, 206, 206, 34);
  context.fill();
  context.strokeStyle = palette.ink;
  context.lineWidth = 5;
  context.lineCap = "round";
  context.lineJoin = "round";
}

async function drawLogoMotif(context, entry, palette, accent) {
  drawMotifBase(context, palette, accent);
  const path = imagePathForEntry(entry);
  if (!path) return;
  const provider = providerSlug(entry.path);
  const darkProviderMark = entry.kind === "docs" && ["threads", "tiktok", "x"].includes(provider);
  const image = await cachedImage(path, darkProviderMark ? palette.ink : providerColors[provider]);
  const maxSize = 112;
  const ratio = Math.min(maxSize / image.width, maxSize / image.height);
  const width = image.width * ratio;
  const height = image.height * ratio;
  context.drawImage(image, 977 - width / 2, 277 - height / 2, width, height);
}

function drawWorkflowMotif(context, palette, accent) {
  drawMotifBase(context, palette, accent);
  for (let index = 0; index < 3; index += 1) {
    const y = 217 + index * 60;
    context.fillStyle = palette.background;
    roundedRect(context, 910, y, 92 + index * 18, 30, 15);
    context.fill();
    context.fillStyle = palette.brand;
    context.beginPath();
    context.arc(916 + index * 54, y + 15, 7, 0, Math.PI * 2);
    context.fill();
  }
}

function drawDocumentMotif(context, palette, accent) {
  drawMotifBase(context, palette, accent);
  context.fillStyle = palette.background;
  roundedRect(context, 927, 210, 100, 132, 10);
  context.fill();
  context.strokeStyle = palette.ink;
  context.lineWidth = 5;
  for (let index = 0; index < 3; index += 1) {
    context.beginPath();
    context.moveTo(949, 246 + index * 25);
    context.lineTo(index === 2 ? 988 : 1006, 246 + index * 25);
    context.stroke();
  }
}

function drawSecurityMotif(context, palette, accent) {
  drawMotifBase(context, palette, accent);
  context.strokeStyle = palette.ink;
  context.lineWidth = 9;
  context.beginPath();
  context.arc(977, 258, 39, Math.PI, 0);
  context.stroke();
  context.fillStyle = palette.background;
  roundedRect(context, 916, 258, 122, 82, 17);
  context.fill();
  context.fillStyle = palette.brand;
  context.beginPath();
  context.arc(977, 292, 8, 0, Math.PI * 2);
  context.fill();
  context.fillRect(973, 298, 8, 19);
}

function drawApiMotif(context, palette, accent) {
  drawMotifBase(context, palette, accent);
  context.fillStyle = palette.ink;
  setFont(context, 74, 600, "Manrope");
  context.textAlign = "center";
  context.fillText("{ }", 977, 299);
  context.textAlign = "left";
  context.strokeStyle = palette.brand;
  context.lineWidth = 5;
  context.beginPath();
  context.moveTo(924, 324);
  context.lineTo(1030, 324);
  context.stroke();
}

function drawConnectionsMotif(context, palette, accent) {
  drawMotifBase(context, palette, accent);
  const points = [
    [977, 230],
    [928, 315],
    [1026, 315],
  ];
  context.strokeStyle = palette.ink;
  context.lineWidth = 5;
  context.beginPath();
  context.moveTo(...points[0]);
  context.lineTo(...points[1]);
  context.lineTo(...points[2]);
  context.closePath();
  context.stroke();
  for (const [x, y] of points) {
    context.fillStyle = palette.background;
    context.beginPath();
    context.arc(x, y, 20, 0, Math.PI * 2);
    context.fill();
  }
}

function drawServerMotif(context, palette, accent) {
  drawMotifBase(context, palette, accent);
  for (let index = 0; index < 3; index += 1) {
    const y = 218 + index * 46;
    context.fillStyle = palette.background;
    roundedRect(context, 916, y, 122, 32, 8);
    context.fill();
    context.fillStyle = index === 1 ? palette.brand : palette.ink;
    context.beginPath();
    context.arc(935, y + 16, 5, 0, Math.PI * 2);
    context.fill();
  }
}

function drawToolsMotif(context, palette, accent) {
  drawMotifBase(context, palette, accent);
  const positions = [
    [920, 220],
    [982, 220],
    [920, 282],
    [982, 282],
  ];
  for (const [x, y] of positions) {
    context.fillStyle = palette.background;
    roundedRect(context, x, y, 50, 50, 11);
    context.fill();
  }
  context.fillStyle = palette.brand;
  context.fillRect(936, 236, 18, 18);
  context.beginPath();
  context.arc(1007, 245, 10, 0, Math.PI * 2);
  context.fill();
  context.strokeStyle = palette.brand;
  context.lineWidth = 5;
  context.beginPath();
  context.moveTo(934, 307);
  context.lineTo(956, 307);
  context.moveTo(945, 296);
  context.lineTo(945, 318);
  context.moveTo(997, 297);
  context.lineTo(1018, 318);
  context.moveTo(1018, 297);
  context.lineTo(997, 318);
  context.stroke();
}

function drawCalendarMotif(context, palette, accent) {
  drawMotifBase(context, palette, accent);
  context.fillStyle = palette.background;
  roundedRect(context, 916, 220, 122, 116, 14);
  context.fill();
  context.fillStyle = palette.brand;
  context.fillRect(916, 220, 122, 28);
  for (let row = 0; row < 2; row += 1) {
    for (let column = 0; column < 3; column += 1) {
      context.fillStyle = row === 1 && column === 1 ? palette.brand : palette.ink;
      context.globalAlpha = row === 1 && column === 1 ? 1 : 0.42;
      context.fillRect(935 + column * 30, 270 + row * 29, 13, 13);
    }
  }
  context.globalAlpha = 1;
}

function drawAnalyticsMotif(context, palette, accent) {
  drawMotifBase(context, palette, accent);
  context.fillStyle = palette.background;
  const heights = [45, 82, 61, 108];
  heights.forEach((height, index) => {
    roundedRect(context, 914 + index * 31, 338 - height, 20, height, 7);
    context.fill();
  });
  context.strokeStyle = palette.brand;
  context.lineWidth = 5;
  context.beginPath();
  context.moveTo(914, 254);
  context.lineTo(950, 276);
  context.lineTo(982, 235);
  context.lineTo(1027, 248);
  context.stroke();
}

function drawMediaMotif(context, palette, accent) {
  drawMotifBase(context, palette, accent);
  context.fillStyle = palette.background;
  roundedRect(context, 912, 218, 130, 118, 15);
  context.fill();
  context.fillStyle = palette.brand;
  context.beginPath();
  context.arc(1012, 245, 10, 0, Math.PI * 2);
  context.fill();
  context.fillStyle = palette.ink;
  context.beginPath();
  context.moveTo(924, 320);
  context.lineTo(958, 278);
  context.lineTo(980, 302);
  context.lineTo(999, 282);
  context.lineTo(1031, 320);
  context.closePath();
  context.fill();
}

async function drawMotif(context, entry, palette, accent, motif) {
  if (motif === "logo") return drawLogoMotif(context, entry, palette, accent);
  const drawers = {
    workflow: drawWorkflowMotif,
    document: drawDocumentMotif,
    security: drawSecurityMotif,
    api: drawApiMotif,
    connections: drawConnectionsMotif,
    server: drawServerMotif,
    tools: drawToolsMotif,
    calendar: drawCalendarMotif,
    analytics: drawAnalyticsMotif,
    media: drawMediaMotif,
  };
  drawers[motif](context, palette, accent);
}

export async function renderSocialCard(entry) {
  loadFonts();
  const surface = entry.kind === "docs" ? "docs" : "marketing";
  const palette = colors[surface];
  const motif = motifForEntry(entry);
  const accent = accents[accentNameForEntry(entry, motif)][surface];
  const canvas = createCanvas(SOCIAL_IMAGE_WIDTH, SOCIAL_IMAGE_HEIGHT);
  const context = canvas.getContext("2d");

  context.fillStyle = palette.background;
  context.fillRect(0, 0, SOCIAL_IMAGE_WIDTH, SOCIAL_IMAGE_HEIGHT);
  drawFrame(context, palette);
  drawDither(context, entry, 900, 214, palette.ink);
  await drawBrand(context, surface);

  context.fillStyle = palette.ink;
  const { size, lines } = fitTitle(context, entry.socialTitle);
  const lineHeight = Math.round(size * 1.08);
  lines.forEach((line, index) => context.fillText(line, 78, 220 + index * lineHeight));

  const ownedLabel =
    entry.sectionLabel ||
    entry.label ||
    (surface === "docs" ? "Documentation" : "Content workspace");
  const label =
    surface === "marketing" && ownedLabel === "OpenPost" ? "Content workspace" : ownedLabel;
  context.fillStyle = palette.brand;
  context.fillRect(78, 505, 34, 3);
  context.fillStyle = palette.muted;
  setFont(context, 18, 600);
  context.fillText(label.toUpperCase(), 126, 513);

  await drawMotif(context, entry, palette, accent, motif);
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
