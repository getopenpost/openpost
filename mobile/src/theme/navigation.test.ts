import { expect, test } from "bun:test";

import { resolveNativeTheme } from "./runtime";
import { navigationColorsFor } from "./navigation";

test("maps the active semantic theme into Expo Router navigation roles", () => {
  const snapshot = resolveNativeTheme({
    contract: null,
    preference: "dark",
    systemScheme: "light",
    workspaceId: "workspace-1",
  });

  expect(navigationColorsFor(snapshot)).toEqual({
    primary: snapshot.manifest.colors.primary,
    background: snapshot.manifest.colors.background,
    card: snapshot.manifest.colors.surface,
    text: snapshot.manifest.colors.onSurface,
    border: snapshot.manifest.colors.outlineVariant,
    notification: snapshot.manifest.colors.error,
  });
});
