import { expect, test } from "bun:test";

import { createBuiltinThemeContract } from "./builtins";
import { NATIVE_ICON_ROLES } from "./contract";
import { resolveNativeThemeSymbol } from "./icons";
import { resolveNativeTheme } from "./runtime";

test("keeps status and media-control glyphs outside organization icon packs", () => {
  expect(NATIVE_ICON_ROLES).not.toContain("warning");
  expect(NATIVE_ICON_ROLES).not.toContain("error");
  expect(NATIVE_ICON_ROLES).not.toContain("success");
  expect(NATIVE_ICON_ROLES).not.toContain("play");
  expect(NATIVE_ICON_ROLES).not.toContain("pause");
});

test("themes can change icon packs without changing a control's meaning", () => {
  const originalContract = createBuiltinThemeContract({
    familyId: "workshop",
    identity: "workshop@1",
    workspaceId: "workspace-1",
  });
  const remappedContract = createBuiltinThemeContract({
    familyId: "playroom",
    identity: "playroom@1",
    workspaceId: "workspace-1",
  });

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
    name: { ios: "pencil", android: "edit" },
    packId: "heroicons-solid",
    sourceGlyphId: "pencil-square",
    type: "hierarchical",
  });
});
