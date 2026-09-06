import { describe, expect, test } from "bun:test";

import { createBuiltinThemeContract } from "./builtins";
import type { NativeThemeManifest } from "./contract";
import { themeAssetFor } from "./presentation";
import { resolveEffectiveScheme, resolveNativeTheme } from "./runtime";

describe("native theme runtime", () => {
  test("resolves system locally and treats an unavailable device scheme as light", () => {
    expect(resolveEffectiveScheme("system", "dark")).toBe("dark");
    expect(resolveEffectiveScheme("system", "light")).toBe("light");
    expect(resolveEffectiveScheme("system", null)).toBe("light");
    expect(resolveEffectiveScheme("dark", "light")).toBe("dark");
  });

  test("falls back atomically instead of retaining a prior workspace theme", () => {
    const priorContract = createBuiltinThemeContract({
      familyId: "studio",
      identity: "studio@1",
      workspaceId: "workspace-1",
    });
    const prior = resolveNativeTheme({
      contract: priorContract,
      preference: "light",
      systemScheme: "dark",
      workspaceId: "workspace-1",
    });
    const afterSwitch = resolveNativeTheme({
      contract: priorContract,
      preference: "light",
      systemScheme: "dark",
      workspaceId: "workspace-2",
    });

    expect(prior.familyId).toBe("studio");
    expect(afterSwitch.familyId).toBe("workshop");
    expect(afterSwitch.source).toEqual({
      kind: "fallback",
      reason: "stale-contract",
    });
    expect(afterSwitch.activationKey).toContain("workspace-2:light:");
    expect(Object.isFrozen(afterSwitch)).toBe(true);
    expect(Object.isFrozen(afterSwitch.manifest.colors)).toBe(true);
  });

  test("falls back as one complete theme when the selected family lacks the effective scheme", () => {
    const contract = createBuiltinThemeContract({
      familyId: "midnight",
      identity: "midnight@1",
      workspaceId: "workspace-1",
    });

    const resolved = resolveNativeTheme({
      contract,
      preference: "system",
      systemScheme: "light",
      workspaceId: "workspace-1",
    });

    expect(resolved.effectiveScheme).toBe("light");
    expect(resolved.familyId).toBe("workshop");
    expect(resolved.source).toEqual({
      kind: "fallback",
      reason: "unsupported-scheme",
    });
    expect(resolved.manifest.id).toBe("workshop-light-builtin-v1");
  });

  test("falls back on invalid contract manifests before they reach React Native", () => {
    const base = createBuiltinThemeContract({
      familyId: "studio",
      identity: "studio@invalid",
      workspaceId: "workspace-1",
    });
    const manifest = base.manifests.light!;
    const { shape: _shape, ...missingShape } = manifest;
    const invalidManifests: [string, NativeThemeManifest][] = [
      ["missing shape section", missingShape as unknown as NativeThemeManifest],
      [
        "unsafe color value",
        { ...manifest, colors: { ...manifest.colors, primary: "invalid-color" } },
      ],
      [
        "font role without a matching descriptor",
        {
          ...manifest,
          typography: {
            ...manifest.typography,
            bodyMedium: {
              ...manifest.typography.bodyMedium,
              fontFamily: "Example Sans",
              fontResourceId: "missing-font",
            },
          },
        },
      ],
    ];

    for (const [name, invalid] of invalidManifests) {
      const resolved = resolveNativeTheme({
        contract: { ...base, manifests: { light: invalid } },
        preference: "light",
        systemScheme: "light",
        workspaceId: "workspace-1",
      });

      expect(resolved.familyId, name).toBe("workshop");
      expect(resolved.source, name).toEqual({
        kind: "fallback",
        reason: "invalid-contract",
      });
    }
  });

  test("activates a resource-backed theme only after the exact complete set is staged", () => {
    const base = createBuiltinThemeContract({
      familyId: "studio",
      identity: "studio@7",
      workspaceId: "workspace-1",
    });
    const contract = {
      ...base,
      manifests: {
        ...base.manifests,
        light: {
          ...base.manifests.light!,
          assetSlots: {
            "background-texture": { resourceId: "texture-1" },
          },
        },
      },
      resources: {
        identity: "studio@7:resources:font-1,texture-1",
        fonts: [
          {
            id: "font-1",
            sourceFamily: "Example Sans",
            family: "Example Sans",
            sourceUrl: "/api/v1/theme-assets/font-1/content?workspace_id=workspace-1",
            format: "woff2" as const,
            nativeDerivative: {
              sourceUrl: "/api/v1/theme-assets/font-1/content?workspace_id=workspace-1&format=ttf",
              format: "ttf" as const,
              identity: "8f".repeat(32),
            },
            weight: 400,
            style: "normal" as const,
            display: "swap" as const,
          },
        ],
        assets: [
          {
            id: "texture-1",
            slot: "background-texture" as const,
            sourceUrl: "/api/v1/theme-assets/texture-1/content?workspace_id=workspace-1",
            mimeType: "image/avif" as const,
          },
        ],
      },
    };
    const resolve = (
      stagedResources?: Parameters<typeof resolveNativeTheme>[0]["stagedResources"],
    ) =>
      resolveNativeTheme({
        contract,
        preference: "light",
        stagedResources,
        systemScheme: "light",
        workspaceId: "workspace-1",
      });

    expect(resolve().source).toEqual({
      kind: "fallback",
      reason: "resources-unavailable",
    });
    expect(
      resolve({
        contractIdentity: contract.identity,
        resourceIdentity: contract.resources.identity,
        workspaceId: contract.workspaceId,
        fonts: {
          "font-1": {
            family: "Example Sans",
            uri: contract.resources.fonts[0]!.nativeDerivative.sourceUrl,
            format: "ttf",
            derivativeIdentity: "8f".repeat(32),
          },
        },
        assets: { "texture-1": "file:///theme/texture-1.avif" },
      }).source,
    ).toEqual({ kind: "fallback", reason: "resources-unavailable" });
    expect(
      resolve({
        contractIdentity: contract.identity,
        resourceIdentity: contract.resources.identity,
        workspaceId: contract.workspaceId,
        fonts: {
          "font-1": {
            family: "Example Sans",
            uri: "file:///theme/font-1.ttf",
            format: "ttf",
            derivativeIdentity: "8f".repeat(32),
          },
        },
        assets: {},
      }).source,
    ).toEqual({ kind: "fallback", reason: "resources-unavailable" });
    expect(
      resolve({
        contractIdentity: contract.identity,
        resourceIdentity: "older-resources",
        workspaceId: contract.workspaceId,
        fonts: {
          "font-1": {
            family: "Example Sans",
            uri: "file:///theme/font-1.ttf",
            format: "ttf",
            derivativeIdentity: "8f".repeat(32),
          },
        },
        assets: { "texture-1": "file:///theme/texture-1.avif" },
      }).source,
    ).toEqual({ kind: "fallback", reason: "resources-unavailable" });
    expect(
      resolve({
        contractIdentity: contract.identity,
        resourceIdentity: contract.resources.identity,
        workspaceId: contract.workspaceId,
        fonts: {
          "font-1": {
            family: "Example Sans",
            uri: "file:///theme/font-1.ttf",
            format: "ttf",
            derivativeIdentity: "7e".repeat(32),
          },
        },
        assets: { "texture-1": "file:///theme/texture-1.avif" },
      }).source,
    ).toEqual({ kind: "fallback", reason: "resources-unavailable" });

    const active = resolve({
      contractIdentity: contract.identity,
      resourceIdentity: contract.resources.identity,
      workspaceId: contract.workspaceId,
      fonts: {
        "font-1": {
          family: "Example Sans",
          uri: "file:///theme/font-1.ttf",
          format: "ttf",
          derivativeIdentity: "8f".repeat(32),
        },
      },
      assets: { "texture-1": "file:///theme/texture-1.avif" },
    });
    expect(active.source).toEqual({
      kind: "contract",
      identity: "studio@7",
      revision: "builtin-v2",
      resolutionSource: "builtin",
    });
    expect(active.resources?.assets).toEqual({
      "texture-1": "file:///theme/texture-1.avif",
    });
    expect(themeAssetFor(active, "background-texture")).toEqual({
      uri: "file:///theme/texture-1.avif",
    });
    expect(themeAssetFor(active, "empty-state-illustration")).toBeNull();
  });
});
