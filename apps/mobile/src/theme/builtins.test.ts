import { describe, expect, test } from "bun:test";

import {
  MINIMUM_TEXT_CONTRAST,
  contrastRatio as sharedContrastRatio,
  type ThemeValidationRgba,
} from "@openpost/dither/theme-validation";

import { BUILTIN_THEME_FAMILIES, validateNativeThemeManifest } from "./builtins";
import { NATIVE_MIN_TEXT_SIZE, type NativeThemeManifest } from "./contract";

describe("native built-in themes", () => {
  test("keeps core text and filled actions at accessible contrast", () => {
    for (const family of Object.values(BUILTIN_THEME_FAMILIES)) {
      for (const scheme of family.supportedSchemes) {
        const manifest = family.manifests[scheme]!;
        expect(
          contrastRatio(manifest.colors.onSurface, manifest.colors.background),
        ).toBeGreaterThanOrEqual(MINIMUM_TEXT_CONTRAST);
        expect(
          contrastRatio(manifest.colors.onSurfaceVariant, manifest.colors.background),
        ).toBeGreaterThanOrEqual(MINIMUM_TEXT_CONTRAST);
        expect(
          contrastRatio(manifest.actions.primary.content, manifest.actions.primary.container),
        ).toBeGreaterThanOrEqual(MINIMUM_TEXT_CONTRAST);
        expect(
          contrastRatio(manifest.actions.focal.content, manifest.actions.focal.container),
        ).toBeGreaterThanOrEqual(MINIMUM_TEXT_CONTRAST);
      }
    }
  });

  test("rejects unsafe native values before React Native receives them", () => {
    const manifest = structuredClone(BUILTIN_THEME_FAMILIES.workshop.manifests.light!);
    const invalidManifests = [
      { ...manifest, colors: { ...manifest.colors, primary: "not-a-color" } },
      {
        ...manifest,
        colors: { ...manifest.colors, onPrimary: manifest.colors.primary },
      },
      {
        ...manifest,
        colors: { ...manifest.colors, focus: manifest.colors.background },
      },
      {
        ...manifest,
        typography: {
          ...manifest.typography,
          bodyMedium: { ...manifest.typography.bodyMedium, fontWeight: "750" },
        },
      },
      {
        ...manifest,
        typography: {
          ...manifest.typography,
          bodyMedium: { ...manifest.typography.bodyMedium, fontSize: 4000 },
        },
      },
      {
        ...manifest,
        typography: {
          ...manifest.typography,
          bodySmall: {
            ...manifest.typography.bodySmall,
            fontSize: NATIVE_MIN_TEXT_SIZE - 1,
          },
        },
      },
      { ...manifest, spacing: { ...manifest.spacing, medium: -1 } },
      {
        ...manifest,
        colors: {
          ...manifest.colors,
          status: {
            ...manifest.colors.status,
            published: manifest.colors.background,
          },
        },
      },
      {
        ...manifest,
        actions: {
          ...manifest.actions,
          focal: { ...manifest.actions.focal, disabledOpacity: 4 },
        },
      },
      {
        ...manifest,
        actions: {
          ...manifest.actions,
          primary: {
            ...manifest.actions.primary,
            pressedContainer: manifest.actions.primary.content,
          },
        },
      },
      {
        ...manifest,
        actions: {
          ...manifest.actions,
          destructive: { ...manifest.actions.quiet },
        },
      },
      {
        ...manifest,
        iconography: {
          ...manifest.iconography,
          roles: {
            ...manifest.iconography.roles,
            edit: manifest.iconography.roles.delete,
          },
        },
      },
    ];

    for (const invalid of invalidManifests) {
      expect(validateNativeThemeManifest(invalid as NativeThemeManifest)).toBe(false);
    }
  });
});

function contrastRatio(foreground: string, background: string): number {
  return sharedContrastRatio(parseHexColor(foreground), parseHexColor(background));
}

function parseHexColor(color: string): ThemeValidationRgba {
  const value = color.slice(1);
  const channels = [0, 2, 4].map(
    (offset) => Number.parseInt(value.slice(offset, offset + 2), 16) / 255,
  );
  return { red: channels[0]!, green: channels[1]!, blue: channels[2]!, alpha: 1 };
}
