import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { BUTTON_NAMES, renderButton } from "./generate-readme-buttons.mjs";

const EXPECTED_WIDTHS = {
  "start-trial": 182,
  "self-host": 254,
  "report-bug": 142,
  "join-discord": 140,
};

test("keeps README button labels within compact horizontal bounds", () => {
  for (const [kind, expectedWidth] of Object.entries(EXPECTED_WIDTHS)) {
    for (const mode of ["light", "dark"]) {
      assert.match(renderButton(kind, mode), new RegExp(`<svg[^>]+width="${expectedWidth}"`, "u"));
    }
  }
});

test("keeps committed README buttons synchronized with the generator", async () => {
  for (const kind of BUTTON_NAMES) {
    for (const mode of ["light", "dark"]) {
      const asset = new URL(`../assets/buttons/${kind}-${mode}.svg`, import.meta.url);
      assert.equal(await readFile(asset, "utf8"), `${renderButton(kind, mode)}\n`);
    }
  }
});

test("README button texture stays visible and restrained without reducing text contrast", async () => {
  const { default: sharp } = await import("sharp");
  const luminance = ([r, g, b]) => {
    const channels = [r, g, b].map((c) => {
      const v = c / 255;
      return v <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4;
    });
    return channels[0] * 0.2126 + channels[1] * 0.7152 + channels[2] * 0.0722;
  };
  const contrast = (a, b) =>
    (Math.max(luminance(a), luminance(b)) + 0.05) / (Math.min(luminance(a), luminance(b)) + 0.05);
  for (const kind of BUTTON_NAMES) {
    for (const mode of ["light", "dark"]) {
      const svg = renderButton(kind, mode);
      const { data, info } = await sharp(Buffer.from(svg))
        .ensureAlpha()
        .raw()
        .toBuffer({ resolveWithObject: true });
      const pixel = (x, y) => [
        ...data.subarray((y * info.width + x) * 4, (y * info.width + x) * 4 + 3),
      ];
      // The left interior has texture without icon, text, border, or rounded corners.
      const colors = new Map();
      for (let y = 10; y < 26; y++)
        for (let x = 2; x < 10; x++) {
          const color = pixel(x, y);
          colors.set(color.join(","), color);
        }
      const values = [...colors.values()];
      const minimum = values.reduce((a, b) => (luminance(a) < luminance(b) ? a : b));
      const maximum = values.reduce((a, b) => (luminance(a) > luminance(b) ? a : b));
      const ratio = contrast(minimum, maximum);
      assert.ok(
        ratio >= 1.18 && ratio <= 1.8,
        `${kind} ${mode}: texture contrast ${ratio.toFixed(2)} must be between 1.18 and 1.8`,
      );
      const ink = svg.match(/<text[^>]*fill="(#[\da-f]+)"/i)[1];
      const inkRgb = [1, 3, 5].map((offset) => parseInt(ink.slice(offset, offset + 2), 16));
      for (const color of values)
        assert.ok(
          contrast(inkRgb, color) >= 4.5,
          `${kind} ${mode}: text must remain readable on both texture colors`,
        );
    }
  }
});
