import { SvgXml, type SvgProps } from "react-native-svg";

import type { NativeIconRole } from "@/theme/contract";
import { resolveNativeThemeIcon } from "@/theme/icons";
import { useNativeTheme } from "@/theme/native-theme-runtime";

export interface ThemeIconProps extends Omit<
  SvgProps,
  | "accessibilityElementsHidden"
  | "accessibilityLabel"
  | "accessibilityRole"
  | "accessible"
  | "color"
  | "height"
  | "importantForAccessibility"
  | "role"
  | "width"
> {
  readonly label?: string;
  readonly role: NativeIconRole;
  readonly size?: number;
  readonly tintColor?: string;
}

export function ThemeIcon({ label, role, size = 24, tintColor, ...props }: ThemeIconProps) {
  const theme = useNativeTheme();
  const selection = resolveNativeThemeIcon(theme.manifest, role);
  return (
    <NativeThemeIconGlyph
      {...props}
      color={tintColor ?? theme.manifest.colors.onSurface}
      label={label}
      selection={selection}
      size={size}
    />
  );
}

export function NativeThemeIconGlyph({
  color,
  label,
  selection,
  size = 24,
  ...props
}: Omit<ThemeIconProps, "role" | "tintColor"> & {
  readonly color: string;
  readonly selection: ReturnType<typeof resolveNativeThemeIcon>;
}) {
  const xml = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="${selection.data.viewBox}">${selection.data.body}</svg>`;
  return (
    <SvgXml
      {...props}
      accessibilityElementsHidden={label ? undefined : true}
      accessibilityLabel={label}
      accessibilityRole={label ? "image" : undefined}
      accessible={Boolean(label)}
      color={color}
      focusable={false}
      height={size}
      importantForAccessibility={label ? "yes" : "no-hide-descendants"}
      width={size}
      xml={xml}
    />
  );
}
