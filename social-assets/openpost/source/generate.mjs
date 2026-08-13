/*
THESIS: OpenPost turns one founder's real company work into publishable content; refuse generic feature-icon banners.
OWN-WORLD: Warm canvas, carbon ink, precise hairlines, tactile publishing tiles, and one scarce orange route through the work.
STORY: Start with the company, shape the source, adapt destinations, publish, and inspect the result.
FIRST VIEWPORT: A direct outcome statement owns the left; the actual Converge mark and publishing system provide proof beside it.
FORM: An established-world campaign kit using the paper field for hero banners and flat workshop diagrams for repeatable content assets.
*/

import { chromium } from "@playwright/test";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const sourceDir = path.dirname(fileURLToPath(import.meta.url));
const kitRoot = path.resolve(sourceDir, "..");
const repoRoot = path.resolve(kitRoot, "../..");
const fontData = (
  await readFile(
    path.join(
      repoRoot,
      "node_modules/@fontsource-variable/geist/files/geist-latin-wght-normal.woff2",
    ),
  )
).toString("base64");

const palette = {
  light: {
    canvas: "#fbfaf7",
    surface: "#ffffff",
    surfaceAlt: "#f2efea",
    ink: "#2c2825",
    muted: "#786f68",
    border: "#e3ded7",
    orange: "#b74c05",
    orange2: "#d9763e",
    orange3: "#e9aa7d",
    orange4: "#f6ddca",
    black: "#1a1512",
  },
  dark: {
    canvas: "#1a1512",
    surface: "#28211d",
    surfaceAlt: "#332a25",
    ink: "#eee9e3",
    muted: "#aaa097",
    border: "#453a33",
    orange: "#d06a35",
    orange2: "#a6522d",
    orange3: "#74402a",
    orange4: "#4d3024",
    black: "#0f0c0a",
  },
};

const paperFieldHref = pathToFileURL(
  path.join(sourceDir, "generated/activity-paper-field.png"),
).href;
const mainScreenshotHref = pathToFileURL(
  path.join(repoRoot, "assets/screenshots/main-dark.png"),
).href;
const mediaScreenshotHref = pathToFileURL(
  path.join(repoRoot, "assets/screenshots/media-dark.png"),
).href;
function escapeXml(value = "") {
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&apos;");
}

function brandMark({ x, y, size = 32, color }) {
  const scale = size / 128;
  return `<g transform="translate(${x} ${y}) scale(${scale})" fill="${color}">
    <path d="M24 4h36v28L32 60H4V24A20 20 0 0 1 24 4Z" />
    <path d="M68 4h36a20 20 0 0 1 20 20v36H96L68 32Z" />
    <path d="M4 68h28l28 28v28H24a20 20 0 0 1-20-20Z" />
    <path d="m68 96 28-28h28v36a20 20 0 0 1-20 20H68Z" />
  </g>`;
}

function wrapWords(value, maxCharacters, maxLines = 4) {
  const words = String(value).trim().split(/\s+/);
  const lines = [];
  let line = "";
  for (const word of words) {
    const candidate = line ? `${line} ${word}` : word;
    if (!line || candidate.length <= maxCharacters) line = candidate;
    else {
      lines.push(line);
      line = word;
    }
  }
  if (line) lines.push(line);
  return lines.slice(0, maxLines);
}

function textBlock({ text, x, y, size, lineHeight, widthChars, fill, weight = 650, maxLines = 4 }) {
  const lines = wrapWords(text, widthChars, maxLines);
  return `<text x="${x}" y="${y}" fill="${fill}" font-family="Geist" font-size="${size}" font-weight="${weight}" letter-spacing="${Math.max(-2.4, -size * 0.025)}">${lines
    .map((line, index) => `<tspan x="${x}" dy="${index ? lineHeight : 0}">${escapeXml(line)}</tspan>`)
    .join("")}</text>`;
}

function svgShell(width, height, content, colors) {
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}">
    <style>@font-face{font-family:Geist;src:url(data:font/woff2;base64,${fontData}) format('woff2');font-weight:100 900;font-style:normal;font-display:block;} text{font-kerning:normal;text-rendering:geometricPrecision}</style>
    <rect width="${width}" height="${height}" fill="${colors.canvas}" />
    ${content}
  </svg>`;
}

function logoLockup(colors, x, y, size = 28, inverted = false) {
  const color = inverted ? "#f7f1eb" : colors.ink;
  return `${brandMark({ x, y: y - size * 0.9, size: size * 0.92, color })}
    <text x="${x + size * 1.22}" y="${y}" fill="${color}" font-family="Geist" font-size="${size}" font-weight="690" letter-spacing="${-size * 0.025}">OpenPost</text>`;
}

function label(colors, text, x, y, size = 15) {
  return `<rect x="${x}" y="${y - size + 1}" width="${size * 0.62}" height="${size * 0.62}" rx="${size * 0.18}" fill="${colors.orange}" />
    <text x="${x + size * 1.15}" y="${y}" fill="${colors.orange}" font-family="Geist" font-size="${size}" font-weight="700" letter-spacing="${size * 0.1}">${escapeXml(text.toUpperCase())}</text>`;
}

function activityGrid(colors, { x, y, columns, rows, size, gap }) {
  const levels = [colors.surfaceAlt, colors.orange4, colors.orange3, colors.orange2, colors.orange];
  let output = "";
  for (let row = 0; row < rows; row += 1) {
    for (let column = 0; column < columns; column += 1) {
      const score = (column * 7 + row * 13 + column * row) % 19;
      const level = score > 16 ? 4 : score > 12 ? 3 : score > 8 ? 2 : score > 5 ? 1 : 0;
      output += `<rect x="${x + column * (size + gap)}" y="${y + row * (size + gap)}" width="${size}" height="${size}" rx="${Math.max(3, size * 0.22)}" fill="${levels[level]}" />`;
    }
  }
  return output;
}

function workflowChip(colors, x, y, text, active = false, scale = 1) {
  const width = Math.max(126, text.length * 9.2 + 46) * scale;
  const height = 48 * scale;
  return `<g>
    <rect x="${x}" y="${y}" width="${width}" height="${height}" rx="${12 * scale}" fill="${active ? colors.orange4 : colors.surface}" stroke="${active ? colors.orange3 : colors.border}" />
    <rect x="${x + 16 * scale}" y="${y + 19 * scale}" width="${10 * scale}" height="${10 * scale}" rx="${3 * scale}" fill="${active ? colors.orange : colors.muted}" />
    <text x="${x + 38 * scale}" y="${y + 30 * scale}" fill="${colors.ink}" font-family="Geist" font-size="${16 * scale}" font-weight="640">${escapeXml(text)}</text>
  </g>`;
}

function workshopSystem(colors, width, height, { dense = false } = {}) {
  const gridSize = Math.max(11, Math.round(height * 0.038));
  const gap = Math.max(7, Math.round(gridSize * 0.55));
  const columns = dense ? 14 : 11;
  const rows = dense ? 7 : 6;
  const gridWidth = columns * gridSize + (columns - 1) * gap;
  const x = width - gridWidth - width * 0.07;
  const y = height * 0.22;
  return `<g>
    <rect x="${x - 44}" y="${y - 54}" width="${gridWidth + 88}" height="${rows * (gridSize + gap) + 144}" rx="${Math.max(20, height * 0.055)}" fill="${colors.surface}" stroke="${colors.border}" />
    ${activityGrid(colors, { x, y, columns, rows, size: gridSize, gap })}
    <path d="M ${x + gridSize} ${y + rows * (gridSize + gap) + 46} C ${x + gridWidth * 0.3} ${y + rows * (gridSize + gap) + 2}, ${x + gridWidth * 0.58} ${y + rows * (gridSize + gap) + 84}, ${x + gridWidth - gridSize} ${y + rows * (gridSize + gap) + 34}" fill="none" stroke="${colors.orange}" stroke-width="${Math.max(3, height * 0.008)}" stroke-linecap="round" />
  </g>`;
}

function paperBanner(spec, colors) {
  const { width, height } = spec;
  const contentX = spec.profileSafe ? width * 0.28 : width * 0.12;
  const titleSize = Math.round(height * (spec.pageBanner ? 0.10 : 0.115));
  const lineHeight = Math.round(titleSize * 1.02);
  const labelY = height * 0.35;
  const titleY = height * 0.49;
  const logoY = height * 0.22;
  return svgShell(
    width,
    height,
    `<image href="${escapeXml(paperFieldHref)}" x="0" y="0" width="${width}" height="${height}" preserveAspectRatio="xMidYMid slice" />
      <rect x="0" y="0" width="${width * 0.62}" height="${height}" fill="${colors.canvas}" opacity="0.9" />
      ${logoLockup(colors, contentX, logoY, Math.max(25, height * 0.066))}
      ${label(colors, "The content team for companies of one", contentX, labelY, Math.max(12, height * 0.034))}
      ${textBlock({ text: "Turn what you’re building into content.", x: contentX, y: titleY, size: titleSize, lineHeight, widthChars: spec.pageBanner ? 42 : 28, fill: colors.ink, maxLines: 2 })}
      <text x="${contentX}" y="${titleY + lineHeight * 2.05}" fill="${colors.orange}" font-family="Geist" font-size="${titleSize}" font-weight="690" letter-spacing="${-titleSize * 0.025}">Publish it everywhere.</text>`,
    colors,
  );
}

function workshopBanner(spec, colors) {
  const { width, height } = spec;
  const contentX = spec.profileSafe ? width * 0.28 : width * 0.12;
  const titleSize = Math.round(height * (spec.pageBanner ? 0.105 : 0.12));
  const lineHeight = Math.round(titleSize * 1.02);
  return svgShell(
    width,
    height,
    `${workshopSystem(colors, width, height, { dense: spec.pageBanner })}
      ${logoLockup(colors, contentX, height * 0.19, Math.max(25, height * 0.068), spec.theme === "dark")}
      ${label(colors, "Publish clearly.", contentX, height * 0.37, Math.max(12, height * 0.034))}
      ${textBlock({ text: "Turn company work into content.", x: contentX, y: height * 0.53, size: titleSize, lineHeight, widthChars: spec.pageBanner ? 40 : 25, fill: colors.ink, maxLines: 2 })}
      <text x="${contentX}" y="${height * 0.53 + lineHeight * 2.05}" fill="${colors.orange}" font-family="Geist" font-size="${titleSize}" font-weight="690" letter-spacing="${-titleSize * 0.025}">Publish everywhere.</text>`,
    colors,
  );
}

function avatar(spec, colors) {
  const padding = spec.width * 0.075;
  const iconX = spec.width * 0.14;
  const iconY = spec.height * 0.14;
  const iconSize = spec.width * 0.72;
  const markInset = iconSize * 0.1875;
  const markSize = iconSize * 0.625;
  return svgShell(
    spec.width,
    spec.height,
    `<rect x="${padding}" y="${padding}" width="${spec.width - padding * 2}" height="${spec.height - padding * 2}" rx="${spec.width * 0.2}" fill="${colors.surface}" stroke="${colors.border}" stroke-width="${Math.max(2, spec.width * 0.006)}" />
      <rect x="${iconX}" y="${iconY}" width="${iconSize}" height="${iconSize}" fill="#b74c05" />
      ${brandMark({ x: iconX + markInset, y: iconY + markInset, size: markSize, color: "#ffffff" })}`,
    colors,
  );
}

function screenshotFrame(colors, href, x, y, width, height) {
  return `<g>
    <rect x="${x - 16}" y="${y - 48}" width="${width + 32}" height="${height + 64}" rx="24" fill="${colors.black}" />
    <circle cx="${x + 12}" cy="${y - 24}" r="6" fill="${colors.orange}" /><circle cx="${x + 34}" cy="${y - 24}" r="6" fill="#6f625a" /><circle cx="${x + 56}" cy="${y - 24}" r="6" fill="#6f625a" />
    <clipPath id="shot-${x}-${y}"><rect x="${x}" y="${y}" width="${width}" height="${height}" rx="12" /></clipPath>
    <image href="${escapeXml(href)}" x="${x}" y="${y}" width="${width}" height="${height}" preserveAspectRatio="xMidYMid slice" clip-path="url(#shot-${x}-${y})" />
  </g>`;
}

function brandCard(spec, colors) {
  const pad = spec.width * 0.075;
  const titleSize = spec.width * 0.085;
  return svgShell(
    spec.width,
    spec.height,
    `${logoLockup(colors, pad, pad * 1.2, spec.width * 0.035, spec.theme === "dark")}
      ${label(colors, spec.label, pad, spec.height * 0.27, spec.width * 0.016)}
      ${textBlock({ text: spec.title, x: pad, y: spec.height * 0.39, size: titleSize, lineHeight: titleSize * 0.98, widthChars: 19, fill: colors.ink, maxLines: 4 })}
      <path d="M ${pad} ${spec.height * 0.82} C ${spec.width * 0.24} ${spec.height * 0.74}, ${spec.width * 0.36} ${spec.height * 0.91}, ${spec.width * 0.54} ${spec.height * 0.79} C ${spec.width * 0.7} ${spec.height * 0.68}, ${spec.width * 0.8} ${spec.height * 0.88}, ${spec.width - pad} ${spec.height * 0.74}" fill="none" stroke="${colors.orange}" stroke-width="${spec.width * 0.012}" stroke-linecap="round" />
      ${activityGrid(colors, { x: spec.width * 0.57, y: spec.height * 0.68, columns: 8, rows: 5, size: spec.width * 0.03, gap: spec.width * 0.012 })}`,
    colors,
  );
}

function portraitCard(spec, colors) {
  const pad = spec.width * 0.075;
  return svgShell(
    spec.width,
    spec.height,
    `${logoLockup(colors, pad, pad * 1.15, spec.width * 0.034, spec.theme === "dark")}
      ${label(colors, spec.label, pad, spec.height * 0.19, spec.width * 0.016)}
      ${textBlock({ text: spec.title, x: pad, y: spec.height * 0.28, size: spec.width * 0.082, lineHeight: spec.width * 0.083, widthChars: 19, fill: colors.ink, maxLines: 4 })}
      <rect x="${pad}" y="${spec.height * 0.62}" width="${spec.width - pad * 2}" height="${spec.height * 0.26}" rx="28" fill="${colors.surface}" stroke="${colors.border}" />
      ${activityGrid(colors, { x: pad * 1.45, y: spec.height * 0.67, columns: 12, rows: 5, size: spec.width * 0.039, gap: spec.width * 0.017 })}
      <text x="${pad}" y="${spec.height * 0.95}" fill="${colors.muted}" font-family="Geist" font-size="${spec.width * 0.022}">openpost.social</text>`,
    colors,
  );
}

function landscapeCard(spec, colors) {
  const pad = spec.width * 0.06;
  const rightX = spec.width * 0.55;
  const screenshot = spec.screenshot === "main" ? mainScreenshotHref : spec.screenshot === "media" ? mediaScreenshotHref : null;
  return svgShell(
    spec.width,
    spec.height,
    `${logoLockup(colors, pad, spec.height * 0.14, spec.width * 0.025, spec.theme === "dark")}
      ${label(colors, spec.label, pad, spec.height * 0.31, spec.width * 0.012)}
      ${textBlock({ text: spec.title, x: pad, y: spec.height * 0.43, size: spec.width * 0.052, lineHeight: spec.width * 0.052, widthChars: 22, fill: colors.ink, maxLines: 3 })}
      ${textBlock({ text: spec.body, x: pad, y: spec.height * 0.72, size: spec.width * 0.018, lineHeight: spec.width * 0.026, widthChars: 44, fill: colors.muted, weight: 450, maxLines: 3 })}
      ${screenshot ? screenshotFrame(colors, screenshot, rightX, spec.height * 0.2, spec.width * 0.39, spec.height * 0.59) : workshopSystem(colors, spec.width, spec.height)}`,
    colors,
  );
}

function carouselSlide(spec, colors) {
  const pad = spec.width * 0.075;
  const number = String(spec.slide).padStart(2, "0");
  return svgShell(
    spec.width,
    spec.height,
    `${logoLockup(colors, pad, pad * 1.1, spec.width * 0.032, spec.theme === "dark")}
      <text x="${spec.width - pad}" y="${pad * 1.1}" fill="${colors.orange}" font-family="Geist Mono, ui-monospace" font-size="${spec.width * 0.027}" font-weight="700" text-anchor="end">${number} / 05</text>
      ${label(colors, spec.label, pad, spec.height * 0.22, spec.width * 0.015)}
      ${textBlock({ text: spec.title, x: pad, y: spec.height * 0.33, size: spec.width * 0.08, lineHeight: spec.width * 0.082, widthChars: 20, fill: colors.ink, maxLines: 4 })}
      ${textBlock({ text: spec.body, x: pad, y: spec.height * 0.62, size: spec.width * 0.03, lineHeight: spec.width * 0.045, widthChars: 38, fill: colors.muted, weight: 450, maxLines: 4 })}
      <rect x="${pad}" y="${spec.height * 0.82}" width="${spec.width - pad * 2}" height="${spec.height * 0.11}" rx="24" fill="${colors.surface}" stroke="${colors.border}" />
      ${activityGrid(colors, { x: pad * 1.4, y: spec.height * 0.85, columns: 14, rows: 2, size: spec.width * 0.034, gap: spec.width * 0.014 })}`,
    colors,
  );
}

function story(spec, colors) {
  const pad = spec.width * 0.075;
  const steps = ["Capture", "Shape", "Schedule", "Track"];
  return svgShell(
    spec.width,
    spec.height,
    `${logoLockup(colors, pad, pad * 1.3, spec.width * 0.034, spec.theme === "dark")}
      ${label(colors, "OpenPost workflow", pad, spec.height * 0.18, spec.width * 0.016)}
      ${textBlock({ text: spec.title, x: pad, y: spec.height * 0.27, size: spec.width * 0.084, lineHeight: spec.width * 0.086, widthChars: 18, fill: colors.ink, maxLines: 4 })}
      <path d="M ${spec.width * 0.19} ${spec.height * 0.55} V ${spec.height * 0.82}" stroke="${colors.border}" stroke-width="6" stroke-linecap="round" />
      ${steps.map((step, index) => {
        const y = spec.height * (0.56 + index * 0.085);
        return `<circle cx="${spec.width * 0.19}" cy="${y}" r="${spec.width * 0.023}" fill="${index === 3 ? colors.orange : colors.surface}" stroke="${index === 3 ? colors.orange : colors.border}" stroke-width="4" /><text x="${spec.width * 0.27}" y="${y + spec.width * 0.009}" fill="${colors.ink}" font-family="Geist" font-size="${spec.width * 0.034}" font-weight="620">${step}</text>`;
      }).join("")}
      ${activityGrid(colors, { x: spec.width * 0.54, y: spec.height * 0.60, columns: 7, rows: 8, size: spec.width * 0.047, gap: spec.width * 0.018 })}
      <text x="${pad}" y="${spec.height * 0.94}" fill="${colors.muted}" font-family="Geist" font-size="${spec.width * 0.026}">openpost.social</text>`,
    colors,
  );
}

function blankTemplate(spec, colors) {
  const pad = spec.width * 0.075;
  return svgShell(
    spec.width,
    spec.height,
    `${logoLockup(colors, pad, pad * 1.15, spec.width * 0.032, spec.theme === "dark")}
      <path d="M ${pad} ${spec.height - pad * 1.35} H ${spec.width - pad}" stroke="${colors.border}" />
      ${activityGrid(colors, { x: spec.width * 0.6, y: spec.height - pad * 1.08, columns: 7, rows: 1, size: spec.width * 0.024, gap: spec.width * 0.012 })}`,
    colors,
  );
}

const assets = [
  { id: "x-paper", group: "banners", width: 1500, height: 500, type: "paper-banner", theme: "light", platform: "X header", alt: "OpenPost X header with the product promise and tactile publishing tiles." },
  { id: "x-workshop-light", group: "banners", width: 1500, height: 500, type: "workshop-banner", theme: "light", platform: "X header", alt: "Light OpenPost X header with publishing activity cells." },
  { id: "x-workshop-dark", group: "banners", width: 1500, height: 500, type: "workshop-banner", theme: "dark", platform: "X header", alt: "Dark OpenPost X header with publishing activity cells." },
  { id: "linkedin-profile-paper", group: "banners", width: 1584, height: 396, type: "paper-banner", theme: "light", profileSafe: true, platform: "LinkedIn profile background", alt: "OpenPost LinkedIn profile banner with tactile publishing tiles." },
  { id: "linkedin-profile-workshop-light", group: "banners", width: 1584, height: 396, type: "workshop-banner", theme: "light", profileSafe: true, platform: "LinkedIn profile background", alt: "Light OpenPost LinkedIn profile banner." },
  { id: "linkedin-profile-workshop-dark", group: "banners", width: 1584, height: 396, type: "workshop-banner", theme: "dark", profileSafe: true, platform: "LinkedIn profile background", alt: "Dark OpenPost LinkedIn profile banner." },
  { id: "linkedin-page-paper", group: "banners", width: 4200, height: 700, type: "paper-banner", theme: "light", pageBanner: true, platform: "LinkedIn Page cover", alt: "OpenPost LinkedIn Page cover with the product promise and tactile publishing tiles." },
  { id: "linkedin-page-workshop-dark", group: "banners", width: 4200, height: 700, type: "workshop-banner", theme: "dark", pageBanner: true, platform: "LinkedIn Page cover", alt: "Dark OpenPost LinkedIn Page cover." },
  { id: "avatar-400", group: "profile", width: 400, height: 400, type: "avatar", theme: "light", platform: "Profile image", alt: "OpenPost orange Converge symbol." },
  { id: "avatar-800", group: "profile", width: 800, height: 800, type: "avatar", theme: "light", platform: "High-resolution profile image", alt: "OpenPost orange Converge symbol." },
  { id: "content-team-square-light", group: "posts", width: 1080, height: 1080, type: "brand-card", theme: "light", label: "OpenPost", title: "The content team for companies of one.", platform: "Square feed post", alt: "The content team for companies of one." },
  { id: "content-team-square-dark", group: "posts", width: 1080, height: 1080, type: "brand-card", theme: "dark", label: "OpenPost", title: "The content team for companies of one.", platform: "Square feed post", alt: "The content team for companies of one on a dark OpenPost background." },
  { id: "publish-everywhere-portrait", group: "posts", width: 1080, height: 1350, type: "portrait-card", theme: "light", label: "Publish clearly.", title: "Turn what you’re building into content for every channel.", platform: "Portrait feed post", alt: "Turn what you are building into content for every channel." },
  { id: "one-workspace-landscape", group: "posts", width: 1200, height: 675, type: "landscape-card", theme: "light", label: "One workspace", title: "Draft. Adapt. Schedule. Track.", body: "Keep the source, every destination version, and each publishing result together.", platform: "Landscape feed post", alt: "Draft, adapt, schedule, and track social content in one workspace." },
  { id: "product-composer-landscape", group: "posts", width: 1200, height: 675, type: "landscape-card", theme: "light", label: "Inside OpenPost", title: "The publishing workflow stays together.", body: "Draft posts and threads, manage media, plan the calendar, and check every result.", screenshot: "main", platform: "Product screenshot post", alt: "OpenPost publishing workspace and composer." },
  { id: "media-studio-landscape", group: "posts", width: 1200, height: 675, type: "landscape-card", theme: "light", label: "Media and Studio", title: "Prepare the asset where you publish it.", body: "Keep source files, alt text, favorites, and use history in the same content system.", screenshot: "media", platform: "Product screenshot post", alt: "OpenPost media library with reusable social assets." },
  { id: "destination-control-square", group: "posts", width: 1080, height: 1080, type: "brand-card", theme: "light", label: "Destination controls", title: "One idea. The right version for every channel.", platform: "Square feature post", alt: "One idea with the right version for every channel." },
  { id: "activity-proof-landscape", group: "posts", width: 1200, height: 675, type: "landscape-card", theme: "dark", label: "Clear outcomes", title: "Know what published—and what needs attention.", body: "OpenPost keeps each destination result, error, and retry path visible.", platform: "Landscape feature post", alt: "OpenPost keeps publishing results and retry paths visible." },
  { id: "01-content-team", group: "carousel", width: 1080, height: 1350, type: "carousel", slide: 1, theme: "light", label: "For solo founders", title: "A content team for a company of one.", body: "OpenPost keeps the work of shaping, scheduling, and tracking content in one system.", platform: "Carousel slide", alt: "A content team for a company of one." },
  { id: "02-start-with-work", group: "carousel", width: 1080, height: 1350, type: "carousel", slide: 2, theme: "light", label: "Capture", title: "Start with the work.", body: "Bring a launch, product update, lesson, or idea into one shared source.", platform: "Carousel slide", alt: "Start with a launch, product update, lesson, or idea." },
  { id: "03-shape-every-channel", group: "carousel", width: 1080, height: 1350, type: "carousel", slide: 3, theme: "light", label: "Adapt", title: "Shape it for every channel.", body: "Keep the core idea, then change the copy, media, format, and settings each destination needs.", platform: "Carousel slide", alt: "Shape one core idea for every social channel." },
  { id: "04-keep-moving", group: "carousel", width: 1080, height: 1350, type: "carousel", slide: 4, theme: "light", label: "Publish", title: "Keep the campaign moving.", body: "Schedule the next wave, see every result, and retry only the posts that need attention.", platform: "Carousel slide", alt: "Schedule content, see every result, and retry only what needs attention." },
  { id: "05-publish-everywhere", group: "carousel", width: 1080, height: 1350, type: "carousel", slide: 5, theme: "dark", label: "OpenPost", title: "Publish clearly.", body: "Turn what you’re building into content, adapt it for each destination, and keep every result together. openpost.social", platform: "Carousel slide", alt: "Publish clearly with OpenPost." },
  { id: "workflow-story-light", group: "stories", width: 1080, height: 1920, type: "story", theme: "light", title: "Publish clearly.", platform: "Story or Reel cover", alt: "OpenPost workflow: capture, shape, schedule, and track." },
  { id: "workflow-story-dark", group: "stories", width: 1080, height: 1920, type: "story", theme: "dark", title: "Publish clearly.", platform: "Story or Reel cover", alt: "OpenPost workflow on a dark background: capture, shape, schedule, and track." },
  { id: "blank-square-light", group: "templates", width: 1080, height: 1080, type: "template", theme: "light", platform: "Editable square template", alt: "Blank light OpenPost square template." },
  { id: "blank-square-dark", group: "templates", width: 1080, height: 1080, type: "template", theme: "dark", platform: "Editable square template", alt: "Blank dark OpenPost square template." },
  { id: "blank-portrait-light", group: "templates", width: 1080, height: 1350, type: "template", theme: "light", platform: "Editable portrait template", alt: "Blank light OpenPost portrait template." },
  { id: "blank-portrait-dark", group: "templates", width: 1080, height: 1350, type: "template", theme: "dark", platform: "Editable portrait template", alt: "Blank dark OpenPost portrait template." },
];

function render(spec) {
  const colors = palette[spec.theme];
  switch (spec.type) {
    case "paper-banner": return paperBanner(spec, colors);
    case "workshop-banner": return workshopBanner(spec, colors);
    case "avatar": return avatar(spec, colors);
    case "brand-card": return brandCard(spec, colors);
    case "portrait-card": return portraitCard(spec, colors);
    case "landscape-card": return landscapeCard(spec, colors);
    case "carousel": return carouselSlide(spec, colors);
    case "story": return story(spec, colors);
    case "template": return blankTemplate(spec, colors);
    default: throw new Error(`Unknown asset type: ${spec.type}`);
  }
}

const browser = await chromium.launch({ headless: true });
try {
  for (const spec of assets) {
    const directory = path.join(kitRoot, spec.group);
    const svgPath = path.join(directory, `${spec.id}.svg`);
    const pngPath = path.join(directory, `${spec.id}.png`);
    await mkdir(directory, { recursive: true });
    await writeFile(svgPath, render(spec));
    const page = await browser.newPage({
      viewport: { width: spec.width, height: spec.height },
      deviceScaleFactor: 1,
    });
    try {
      await page.goto(pathToFileURL(svgPath).href, { waitUntil: "load" });
      await page.evaluate(() => document.fonts.ready);
      await page.evaluate(
        () =>
          new Promise((resolve) =>
            requestAnimationFrame(() => requestAnimationFrame(resolve)),
          ),
      );
      await page.screenshot({ path: pngPath, type: "png" });
    } finally {
      await page.close();
    }
  }

  const manifest = {
    generatedAt: new Date().toISOString(),
    generator: "source/generate.mjs",
    assets: assets.map((spec) => ({
      id: spec.id,
      group: spec.group,
      platform: spec.platform,
      width: spec.width,
      height: spec.height,
      theme: spec.theme,
      png: `${spec.group}/${spec.id}.png`,
      svg: `${spec.group}/${spec.id}.svg`,
      alt: spec.alt,
    })),
  };
  await writeFile(path.join(kitRoot, "manifest.json"), `${JSON.stringify(manifest, null, 2)}\n`);

  const cards = assets
    .map(
      (spec) => `<article><a href="../${spec.group}/${spec.id}.png"><img src="../${spec.group}/${spec.id}.png" alt="${escapeXml(spec.alt)}"></a><div><strong>${escapeXml(spec.id)}</strong><span>${spec.width} × ${spec.height} · ${escapeXml(spec.platform)}</span></div></article>`,
    )
    .join("");
  const gallery = `<!doctype html><html><head><meta charset="utf-8"><title>OpenPost social kit</title><style>@font-face{font-family:Geist;src:url(data:font/woff2;base64,${fontData}) format('woff2');font-weight:100 900}*{box-sizing:border-box}body{margin:0;background:#1a1512;color:#eee9e3;font-family:Geist,system-ui;padding:52px}header{max-width:1800px;margin:0 auto 34px}h1{font-size:48px;letter-spacing:-.04em;margin:0 0 8px}p{color:#aaa097;margin:0}.grid{max-width:1800px;margin:auto;display:grid;grid-template-columns:repeat(4,minmax(0,1fr));gap:20px}article{background:#28211d;border:1px solid #453a33;border-radius:16px;overflow:hidden}a{display:grid;place-items:center;background:#0f0c0a;aspect-ratio:1.35;padding:12px}img{display:block;max-width:100%;max-height:100%;object-fit:contain}article div{padding:14px 16px 16px;display:grid;gap:5px}strong{font-size:14px}span{font-size:12px;color:#aaa097}</style></head><body><header><h1>OpenPost social kit</h1><p>${assets.length} ready-to-use assets with editable SVG sources.</p></header><main class="grid">${cards}</main></body></html>`;
  const previewDir = path.join(kitRoot, "preview");
  const galleryPath = path.join(previewDir, "index.html");
  await mkdir(previewDir, { recursive: true });
  await writeFile(galleryPath, gallery);
  const galleryPage = await browser.newPage({
    viewport: { width: 2000, height: 1200 },
    deviceScaleFactor: 1,
  });
  try {
    await galleryPage.goto(pathToFileURL(galleryPath).href, { waitUntil: "load" });
    await galleryPage.screenshot({
      path: path.join(previewDir, "contact-sheet.png"),
      type: "png",
      fullPage: true,
    });
  } finally {
    await galleryPage.close();
  }
} finally {
  await browser.close();
}

console.log(`Rendered ${assets.length} OpenPost social assets.`);
