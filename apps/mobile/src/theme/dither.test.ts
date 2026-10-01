import { expect, test } from "bun:test";
import { BUILTIN_THEME_FAMILIES } from "./builtins";
import { nativeDitherActionMaterial } from "./validation";

// Measure the pixels a user sees, including translucent theme containers.
const rgb = (color: string) =>
  [0, 2, 4].map((offset) => Number.parseInt(color.slice(offset + 1, offset + 3), 16));
const composite = (ink: number[], base: number[], opacity: number) =>
  base.map((channel, index) => channel * (1 - opacity) + ink[index]! * opacity);
function luminance(channels: number[]) {
  return channels
    .map((channel) => channel / 255)
    .map((channel) => (channel <= 0.04045 ? channel / 12.92 : ((channel + 0.055) / 1.055) ** 2.4))
    .reduce((sum, channel, index) => sum + channel * [0.2126, 0.7152, 0.0722][index]!, 0);
}
function contrast(first: number[], second: number[]) {
  const values = [luminance(first), luminance(second)].sort((a, b) => b - a);
  return (values[0]! + 0.05) / (values[1]! + 0.05);
}

test("filled native buttons have visible, moderate dithering and readable labels across every built-in scheme", () => {
  for (const family of Object.values(BUILTIN_THEME_FAMILIES)) {
    for (const manifest of Object.values(family.manifests)) {
      if (!manifest) continue;
      for (const intent of ["primary", "focal", "ordinary", "destructive"] as const) {
        const action = manifest.actions[intent];
        for (const state of ["rest", "pressed"] as const) {
          const container = state === "pressed" ? action.pressedContainer : action.container;
          const alpha = container.length === 9 ? Number.parseInt(container.slice(7), 16) / 255 : 1;
          if (!alpha) continue;
          const material = nativeDitherActionMaterial(
            {
              ...action,
              container,
              content: state === "pressed" ? action.pressedContent : action.content,
            },
            manifest.colors.background,
            { focusColor: manifest.colors.focus },
          );
          expect(material, `${family.id}/${manifest.scheme}/${intent}/${state}`).toBeDefined();
          const background = composite(rgb(container), rgb(manifest.colors.background), alpha);
          const endpoint = composite(rgb(material!.ink), background, material!.opacity);
          expect(contrast(background, endpoint)).toBeGreaterThanOrEqual(1.18);
          expect(contrast(background, endpoint)).toBeLessThanOrEqual(1.8);
          expect(contrast(rgb(material!.content), background)).toBeGreaterThanOrEqual(4.5);
          expect(contrast(rgb(material!.content), endpoint)).toBeGreaterThanOrEqual(4.5);
          expect(contrast(rgb(material!.focus), background)).toBeGreaterThanOrEqual(3);
          expect(contrast(rgb(material!.focus), endpoint)).toBeGreaterThanOrEqual(3);
        }
      }
    }
  }
});
