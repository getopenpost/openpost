import { expect, test } from "bun:test";

import { createBuiltinThemeContract } from "./builtins";
import { NATIVE_ICON_ROLES, type NativeThemeManifest } from "./contract";
import { resolveNativeThemeSymbol } from "./icons";
import { resolveNativeTheme } from "./runtime";

test("keeps status and media-control glyphs outside organization icon packs", () => {
  expect(NATIVE_ICON_ROLES).not.toContain("warning");
  expect(NATIVE_ICON_ROLES).not.toContain("error");
  expect(NATIVE_ICON_ROLES).not.toContain("success");
  expect(NATIVE_ICON_ROLES).not.toContain("play");
  expect(NATIVE_ICON_ROLES).not.toContain("pause");
});

test("a contract icon-pack mapping changes the native semantic symbol selection", () => {
  const originalContract = createBuiltinThemeContract({
    familyId: "workshop",
    identity: "workshop@1",
    organizationId: "org-1",
    workspaceId: "workspace-1",
  });
  const originalManifest = originalContract.manifests.light!;
  const remappedManifest: NativeThemeManifest = {
    ...originalManifest,
    iconography: {
      packId: "heroicons-solid",
      roles: { ...originalManifest.iconography.roles, edit: "trash" },
    },
  };
  const remappedContract = {
    ...originalContract,
    identity: "custom-revision-2",
    revision: "revision-2",
    manifests: { light: remappedManifest },
  };

  const original = resolveNativeTheme({
    contract: originalContract,
    preference: "light",
    systemScheme: "light",
    workspaceId: "workspace-1",
  });
  const remapped = resolveNativeTheme({
    contract: remappedContract,
    preference: "light",
    systemScheme: "light",
    workspaceId: "workspace-1",
  });

  expect(resolveNativeThemeSymbol(original.manifest, "edit")).toMatchObject({
    name: { ios: "pencil", android: "edit" },
    packId: "lucide",
    sourceGlyphId: "pencil",
  });
  expect(resolveNativeThemeSymbol(remapped.manifest, "edit")).toMatchObject({
    name: { ios: "trash", android: "delete" },
    packId: "heroicons-solid",
    sourceGlyphId: "trash",
    type: "hierarchical",
  });
});
