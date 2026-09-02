import { describe, expect, test } from "bun:test";

import {
  BUILTIN_THEME_FAMILIES,
  BUILTIN_THEME_IDS,
  builtinThemeForScheme,
  validateNativeThemeManifest,
} from "./builtins";
import { NATIVE_ICON_ROLES } from "./contract";

describe("native built-in themes", () => {
  test("ships every built-in family with complete declared schemes", () => {
    expect(BUILTIN_THEME_IDS).toEqual([
      "workshop",
      "studio",
      "notebook",
      "playroom",
      "cloud-garden",
      "study-hall",
      "corkboard",
      "midnight",
    ]);

    for (const family of Object.values(BUILTIN_THEME_FAMILIES)) {
      expect(Object.keys(family.manifests).sort()).toEqual([...family.supportedSchemes].sort());
      for (const scheme of family.supportedSchemes) {
        const manifest = family.manifests[scheme];
        expect(validateNativeThemeManifest(manifest)).toBe(true);
        expect(Object.keys(manifest!.iconography.roles).sort()).toEqual(
          [...NATIVE_ICON_ROLES].sort(),
        );
      }
    }
  });

  test("uses a complete Workshop theme when a family does not support the requested scheme", () => {
    const resolved = builtinThemeForScheme("midnight", "light");

    expect(resolved.family.id).toBe("workshop");
    expect(resolved.fallbackReason).toBe("unsupported-scheme");
    expect(resolved.manifest).toBe(BUILTIN_THEME_FAMILIES.workshop.manifests.light!);
  });

  test("keeps core text and filled actions at accessible contrast", () => {
    for (const family of Object.values(BUILTIN_THEME_FAMILIES)) {
      for (const scheme of family.supportedSchemes) {
        const manifest = family.manifests[scheme]!;
        expect(
          contrastRatio(manifest.colors.onSurface, manifest.colors.background),
        ).toBeGreaterThanOrEqual(4.5);
        expect(
          contrastRatio(manifest.colors.onSurfaceVariant, manifest.colors.background),
        ).toBeGreaterThanOrEqual(4.5);
        expect(
          contrastRatio(manifest.actions.primary.content, manifest.actions.primary.container),
        ).toBeGreaterThanOrEqual(4.5);
        expect(
          contrastRatio(manifest.actions.focal.content, manifest.actions.focal.container),
        ).toBeGreaterThanOrEqual(4.5);
      }
    }
  });
});

function contrastRatio(foreground: string, background: string): number {
  const [lighter, darker] = [luminance(foreground), luminance(background)].sort((a, b) => b - a);
  return (lighter + 0.05) / (darker + 0.05);
}

function luminance(color: string): number {
  const value = color.slice(1);
  const channels = [0, 2, 4].map((offset) => Number.parseInt(value.slice(offset, offset + 2), 16));
  return channels
    .map((channel) => channel / 255)
    .map((channel) => (channel <= 0.04045 ? channel / 12.92 : ((channel + 0.055) / 1.055) ** 2.4))
    .reduce((sum, channel, index) => sum + channel * [0.2126, 0.7152, 0.0722][index], 0);
}
