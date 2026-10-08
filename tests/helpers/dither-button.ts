import { expect, type Locator } from "@playwright/test";
import sharp from "sharp";
import { themeColorContrastRatio } from "@openpost/ui/themes/validation";

export async function expectBalancedDitherButton(button: Locator) {
  // Render offscreen thumbnails before reading their inherited pseudo-element colors.
  const { data, info } = await sharp(
    await button.screenshot({ scale: "css", animations: "disabled" }),
  )
    .ensureAlpha()
    .raw()
    .toBuffer({ resolveWithObject: true });
  const { ink, background, tint, opacity } = await button.evaluate((node) => {
    const style = getComputedStyle(node);
    const texture = getComputedStyle(node, "::before");
    return {
      ink: style.color,
      background: style.backgroundColor,
      tint: texture.backgroundColor,
      opacity: Number(texture.opacity),
    };
  });
  const textured = `color-mix(in srgb, ${tint} ${opacity * 100}%, ${background})`;
  expect(themeColorContrastRatio(ink, background)).toBeGreaterThanOrEqual(4.5);
  expect(themeColorContrastRatio(ink, textured)).toBeGreaterThanOrEqual(4.5);
  const ratio = themeColorContrastRatio(background, textured)!;
  expect(ratio).toBeGreaterThanOrEqual(1.18);
  expect(ratio).toBeLessThanOrEqual(1.8);

  // Sample the padding, away from borders and glyphs, at CSS pixel resolution.
  const pixels = new Set<string>();
  for (let y = Math.floor(info.height / 3); y < Math.ceil((info.height * 2) / 3); y++) {
    const offset = (y * info.width + 2) * 4;
    pixels.add([...data.subarray(offset, offset + 3)].join(","));
  }
  expect(pixels.size, "Bayer cells must alternate between two distinct fixed colors").toBe(2);
}
