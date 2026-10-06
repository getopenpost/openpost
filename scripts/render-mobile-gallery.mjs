import sharp from "sharp";
import { createCanvas, GlobalFonts } from "@napi-rs/canvas";
import { mkdir } from "node:fs/promises";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("../", import.meta.url));
const input = resolve(process.argv[2] ?? "apps/mobile/artifacts/screenshots");
const output = resolve(root, "assets/screenshots");
const screens = [
  ["drafts", "Drafts"],
  ["composer", "Post"],
  ["calendar", "Calendar"],
  ["analytics", "Analytics"],
];
const width = 1480;
const phoneWidth = 320;
const bezel = 10;
const screenWidth = phoneWidth - bezel * 2;
const gutter = 40;
const labelHeight = 44;
const radius = 44;

GlobalFonts.registerFromPath(
  resolve(root, "assets/brand/fonts/Geist-SemiBold.ttf"),
  "OpenPostGallery",
);
await mkdir(output, { recursive: true });
for (const scheme of ["light", "dark"]) {
  const background = { r: 0, g: 0, b: 0, alpha: 0 };
  const foreground = scheme === "dark" ? "#ede9e5" : "#24201c";
  const metadata = await sharp(resolve(input, `drafts-${scheme}.png`)).metadata();
  if (!metadata.width || !metadata.height) throw new Error("Missing iOS capture dimensions");
  const screenHeight = Math.round((metadata.height / metadata.width) * screenWidth);
  const phoneHeight = screenHeight + bezel * 2;
  const height = phoneHeight + labelHeight + gutter * 2;
  const layers = [];
  for (const [index, [name, label]] of screens.entries()) {
    const capture = resolve(input, `${name}-${scheme}.png`);
    const size = await sharp(capture).metadata();
    if (size.width !== metadata.width || size.height !== metadata.height) {
      throw new Error(`Inconsistent iOS viewport: ${name}-${scheme}`);
    }
    const left = gutter + index * (phoneWidth + gutter);
    const top = gutter;
    const labelCanvas = createCanvas(phoneWidth, labelHeight);
    const labelContext = labelCanvas.getContext("2d");
    labelContext.font = "20px OpenPostGallery";
    labelContext.fillStyle = foreground;
    labelContext.textAlign = "center";
    labelContext.fillText(label, phoneWidth / 2, 22);
    const frameSvg = `<svg width="${phoneWidth}" height="${phoneHeight}"><rect x="1" y="1" width="${phoneWidth - 2}" height="${phoneHeight - 2}" rx="${radius}" fill="#090909" stroke="#57514d" stroke-width="2"/><rect x="5" y="5" width="${phoneWidth - 10}" height="${phoneHeight - 10}" rx="${radius - 4}" fill="none" stroke="#282624"/></svg>`;
    const mask = Buffer.from(
      `<svg width="${screenWidth}" height="${screenHeight}"><rect width="${screenWidth}" height="${screenHeight}" rx="${radius - bezel}" fill="white"/></svg>`,
    );
    const screen = await sharp(capture)
      .resize(screenWidth, screenHeight)
      .composite([{ input: mask, blend: "dest-in" }])
      .png()
      .toBuffer();
    layers.push({ input: Buffer.from(labelCanvas.toBuffer("image/png")), left, top });
    layers.push({ input: Buffer.from(frameSvg), left, top: top + labelHeight });
    layers.push({ input: screen, left: left + bezel, top: top + labelHeight + bezel });
  }
  await sharp({ create: { width, height, channels: 4, background } })
    .composite(layers)
    .png()
    .toFile(resolve(output, `mobile-gallery-${scheme}.png`));
}
console.log("Rendered labelled iOS phone galleries in assets/screenshots.");
