import { expect, mock, test } from "bun:test";

mock.module("react-native-svg", () => ({ SvgXml: "SvgXml" }));
mock.module("expo-symbols", () => ({ SymbolView: "SymbolView" }));
mock.module("react-native", () => ({ Platform: { OS: "ios" }, useColorScheme: () => "light" }));

const { NativeThemeIconGlyph } = await import("./theme-icon");
const { ProtectedIcon } = await import("./protected-icon");
const { createBuiltinThemeContract } = await import("../theme/builtins");
const { resolveNativeThemeIcon } = await import("../theme/icons");

const manifest = createBuiltinThemeContract({
  familyId: "workshop",
  identity: "workshop@accessibility-test",
  workspaceId: "workspace-1",
}).manifests.light!;
const selection = resolveNativeThemeIcon(manifest, "edit");

test("renders a labelled theme icon as an accessible image", () => {
  const icon = NativeThemeIconGlyph({
    color: "#112233",
    label: "Edit publication",
    selection,
    size: 20,
  });

  expect(icon.props).toMatchObject({
    accessibilityLabel: "Edit publication",
    accessibilityRole: "image",
    accessible: true,
    color: "#112233",
    height: 20,
    importantForAccessibility: "yes",
    width: 20,
  });
  expect(icon.props.xml).toContain(selection.data.body);
});

test("keeps decorative theme and protected icons out of the accessibility tree", () => {
  const themeIcon = NativeThemeIconGlyph({ color: "#112233", selection });
  const protectedIcon = ProtectedIcon({ role: "warning", size: 18, tintColor: "#ffffff" });

  for (const icon of [themeIcon, protectedIcon]) {
    expect(icon.props).toMatchObject({
      accessibilityElementsHidden: true,
      accessible: false,
      importantForAccessibility: "no-hide-descendants",
    });
    expect(icon.props.accessibilityLabel).toBeUndefined();
    expect(icon.props.accessibilityRole).toBeUndefined();
  }
});

test("renders protected icon geometry from the fixed platform registry", () => {
  const icon = ProtectedIcon({ label: "Upload failed", role: "warning", size: 18 });

  expect(icon.props).toMatchObject({
    accessibilityLabel: "Upload failed",
    accessibilityRole: "image",
    accessible: true,
    importantForAccessibility: "yes",
    name: { ios: "exclamationmark.triangle.fill", android: "warning" },
  });
});
