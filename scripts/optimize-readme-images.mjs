import { chromium } from "@playwright/test";
import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const repositoryRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const screenshotDirectory = path.join(repositoryRoot, "assets", "screenshots");
const webpQuality = 0.84;

const images = [
  ...["main", "calendar", "analytics", "accounts", "media", "image-editor", "video-editor"].flatMap(
    (name) =>
      ["light", "dark"].map((scheme) => ({
        name: `${name}-${scheme}`,
        width: 2880,
      })),
  ),
  ...[
    "calendar-detail",
    "meme-creator-detail",
    "analytics-detail",
    "image-canvas-detail",
    "image-controls-detail",
    "video-preview-detail",
    "video-timeline-detail",
    "video-color",
    "video-motion",
    "video-effects",
    "video-transcript",
    "video-export",
    "connect-bluesky",
    "connect-mastodon",
    "connect-pixelfed",
    "connect-peertube",
    "connect-lemmy",
    "connect-piefed",
    "connect-discord",
    "connect-telegram",
  ].flatMap((name) =>
    ["light", "dark"].map((scheme) => ({
      name: `${name}-${scheme}`,
      width: 2880,
    })),
  ),
  { name: "readme-hero-dark", width: 2880 },
  ...[768, 1536].flatMap((width) =>
    ["light", "dark"].map((scheme) => ({
      name: `main-${scheme}`,
      outputName: `main-${scheme}-${width}`,
      width,
    })),
  ),
];

export async function optimizeReadmeImages() {
  // Honor the same browser override as the app browser suites: some hosts
  // cannot run Playwright's bundled headless shell (missing system
  // libraries) and provide Chromium another way.
  const executablePath = process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH || undefined;
  const browser = await chromium.launch({
    headless: true,
    ...(executablePath ? { executablePath } : {}),
  });
  let sourceBytes = 0;
  let outputBytes = 0;

  try {
    const page = await browser.newPage();
    for (const image of images) {
      const source = await readFile(path.join(screenshotDirectory, `${image.name}.png`));
      const output = await encodeWebp(page, source, image.width);
      await writeFile(
        path.join(screenshotDirectory, `${image.outputName ?? image.name}.webp`),
        output,
      );
      sourceBytes += source.byteLength;
      outputBytes += output.byteLength;
    }
  } finally {
    await browser.close();
  }

  if (outputBytes >= sourceBytes) {
    throw new Error("README WebP images must be smaller than their PNG sources");
  }

  const reduction = ((1 - outputBytes / sourceBytes) * 100).toFixed(1);
  console.log(`Optimized README images by ${reduction}% (${sourceBytes} -> ${outputBytes} bytes)`);
}

async function encodeWebp(page, source, maxWidth) {
  const encoded = await page.evaluate(
    async ({ png, maxWidth, quality }) => {
      const image = new Image();
      image.src = `data:image/png;base64,${png}`;
      await image.decode();

      const scale = Math.min(1, maxWidth / image.naturalWidth);
      const canvas = document.createElement("canvas");
      canvas.width = Math.round(image.naturalWidth * scale);
      canvas.height = Math.round(image.naturalHeight * scale);
      const context = canvas.getContext("2d");
      if (!context) throw new Error("Canvas 2D context is unavailable");
      context.drawImage(image, 0, 0, canvas.width, canvas.height);

      const blob = await new Promise((resolve, reject) => {
        canvas.toBlob(
          (value) => (value ? resolve(value) : reject(new Error("WebP encoding failed"))),
          "image/webp",
          quality,
        );
      });
      return await new Promise((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () => resolve(String(reader.result).split(",", 2)[1]);
        reader.onerror = () => reject(reader.error ?? new Error("WebP encoding failed"));
        reader.readAsDataURL(blob);
      });
    },
    { png: source.toString("base64"), maxWidth, quality: webpQuality },
  );

  return Buffer.from(encoded, "base64");
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  await optimizeReadmeImages();
}
