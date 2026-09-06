import { describe, expect, test } from "bun:test";

import {
  BUILTIN_THEME_FAMILIES,
  BUILTIN_THEME_IDS,
  builtinThemeForScheme,
  validateNativeThemeManifest,
} from "./builtins";
import { NATIVE_ICON_ROLES, NATIVE_MIN_TEXT_SIZE, type NativeThemeManifest } from "./contract";

describe("native built-in themes", () => {
  test("ships every built-in family with complete declared schemes", () => {
    expect(BUILTIN_THEME_IDS.length).toBeGreaterThan(0);

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

  test("gives every family a distinct native structural personality", () => {
    const signatures = BUILTIN_THEME_IDS.map((familyId) => {
      const family = BUILTIN_THEME_FAMILIES[familyId];
      const manifest = family.manifests.light ?? family.manifests.dark!;
      for (const role of Object.values(manifest.typography)) {
        expect(role.fontSize).toBeGreaterThanOrEqual(NATIVE_MIN_TEXT_SIZE);
      }
      return JSON.stringify({
        typography: manifest.typography,
        shape: manifest.shape,
        spacing: manifest.spacing,
        motion: manifest.motion,
        shell: manifest.shell,
        components: manifest.components,
        iconPack: manifest.iconography.packId,
        actions: ["focal", "primary", "ordinary"].map((intent) => {
          const action = manifest.actions[intent as "focal" | "primary" | "ordinary"];
          return { borderWidth: action.borderWidth, depth: action.depth };
        }),
      });
    });

    expect(new Set(signatures).size).toBe(BUILTIN_THEME_IDS.length);
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
