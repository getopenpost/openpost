import type { NativeThemeSnapshot } from "./contract";

export function navigationColorsFor(snapshot: NativeThemeSnapshot) {
  const colors = snapshot.manifest.colors;
  return {
    primary: colors.primary,
    background: colors.background,
    card: colors.surface,
    text: colors.onSurface,
    border: colors.outlineVariant,
    notification: colors.error,
  } as const;
}
