import { chromium } from "@playwright/test";
import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const repositoryRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const screenshotDirectory = path.join(repositoryRoot, "assets", "screenshots");
const webpQuality = 0.84;

const images = [
  { name: "readme-hero-dark", width: 1440 },
  { name: "calendar-dark", width: 960 },
  { name: "analytics-dark", width: 960 },
  { name: "media-dark", width: 960 },
  { name: "accounts-dark", width: 960 },
  { name: "image-editor-dark", width: 1440 },
  { name: "video-editor-dark", width: 1440 },
];

export async function optimizeReadmeImages() {
  const browser = await chromium.launch({ headless: true });
  let sourceBytes = 0;
  let outputBytes = 0;

  try {
    const page = await browser.newPage();
    for (const image of images) {
      const source = await readFile(path.join(screenshotDirectory, `${image.name}.png`));
      const output = await encodeWebp(page, source, image.width);
      await writeFile(path.join(screenshotDirectory, `${image.name}.webp`), output);
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
