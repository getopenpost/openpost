import { describe, expect, test } from "bun:test";

import { createBuiltinThemeContract } from "./builtins";
import type { NativeResolvedThemeContract } from "./contract";
import { nativeThemeRuntimeFontFamily } from "./font-family";
import { stageNativeThemeResources, type NativeThemeResourceStageAdapter } from "./resource-stage";

const FONT_IDENTITY = "8f".repeat(32);

function resourceBackedContract(): NativeResolvedThemeContract {
  const base = createBuiltinThemeContract({
    familyId: "notebook",
    identity: "notebook@custom-7",
    workspaceId: "workspace-1",
  });
  return {
    ...base,
    resources: {
      identity: "notebook@custom-7:resources",
      fonts: [
        {
          id: "font-1",
          sourceFamily: "Organization Sans",
          family: nativeThemeRuntimeFontFamily("font-1"),
          sourceUrl: "/api/v1/theme-assets/font-1/content?workspace_id=workspace-1",
          format: "woff2",
          nativeDerivative: {
            sourceUrl: "/api/v1/theme-assets/font-1/content?workspace_id=workspace-1&format=ttf",
            format: "ttf",
            identity: FONT_IDENTITY,
          },
          weight: 400,
          style: "normal",
          display: "swap",
        },
      ],
      assets: [
        {
          id: "texture-1",
          slot: "background-texture",
          sourceUrl: "/api/v1/theme-assets/texture-1/content?workspace_id=workspace-1",
          mimeType: "image/webp",
        },
      ],
    },
  };
}

describe("native theme resource staging", () => {
  test("publishes one complete set only after files and fonts are ready", async () => {
    const contract = resourceBackedContract();
    const events: string[] = [];
    const adapter: NativeThemeResourceStageAdapter = {
      async download(request) {
        events.push(`download:${request.kind}:${request.id}`);
        return {
          uri: `file:///themes/${request.id}.${request.kind === "font" ? "ttf" : "webp"}`,
          ...(request.kind === "font" ? { identity: FONT_IDENTITY.toUpperCase() } : {}),
        };
      },
      async loadFonts(fonts) {
        events.push(`load:${fonts.map((font) => font.id).join(",")}`);
        expect(fonts).toEqual([
          {
            family: nativeThemeRuntimeFontFamily("font-1"),
            format: "ttf",
            id: "font-1",
            uri: "file:///themes/font-1.ttf",
          },
        ]);
      },
    };

    await expect(stageNativeThemeResources({ adapter, contract })).resolves.toEqual({
      contractIdentity: contract.identity,
      resourceIdentity: contract.resources.identity,
      workspaceId: contract.workspaceId,
      fonts: {
        "font-1": {
          derivativeIdentity: FONT_IDENTITY,
          family: nativeThemeRuntimeFontFamily("font-1"),
          format: "ttf",
          uri: "file:///themes/font-1.ttf",
        },
      },
      assets: { "texture-1": "file:///themes/texture-1.webp" },
    });
    expect(events.slice(-1)).toEqual(["load:font-1"]);
    expect(events).toContain("download:asset:texture-1");
  });

  test("rejects a native font whose downloaded bytes do not match the contract", async () => {
    const contract = resourceBackedContract();
    let loaded = false;
    const adapter: NativeThemeResourceStageAdapter = {
      async download(request) {
        return {
          uri: `file:///themes/${request.id}`,
          ...(request.kind === "font" ? { identity: "7e".repeat(32) } : {}),
        };
      },
      async loadFonts() {
        loaded = true;
      },
    };

    await expect(stageNativeThemeResources({ adapter, contract })).rejects.toThrow(
      "font-1 did not match its native derivative identity",
    );
    expect(loaded).toBe(false);
  });

  test("drops a stale workspace generation before fonts or state are published", async () => {
    const contract = resourceBackedContract();
    let current = true;
    let loaded = false;
    const adapter: NativeThemeResourceStageAdapter = {
      async download(request) {
        current = false;
        return {
          uri: `file:///themes/${request.id}`,
          ...(request.kind === "font" ? { identity: FONT_IDENTITY } : {}),
        };
      },
      async loadFonts() {
        loaded = true;
      },
    };

    await expect(
      stageNativeThemeResources({ adapter, contract, isCurrent: () => current }),
    ).resolves.toBeNull();
    expect(loaded).toBe(false);
  });

  test("does no work for a theme without external resources", async () => {
    const contract = createBuiltinThemeContract({
      familyId: "studio",
      identity: "studio@builtin-v1",
      workspaceId: "workspace-1",
    });
    let downloads = 0;
    const adapter: NativeThemeResourceStageAdapter = {
      async download() {
        downloads += 1;
        return { uri: "file:///unexpected" };
      },
      async loadFonts() {},
    };

    await expect(stageNativeThemeResources({ adapter, contract })).resolves.toBeNull();
    expect(downloads).toBe(0);
  });
});
