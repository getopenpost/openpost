import { SymbolView, type SymbolViewProps } from "expo-symbols";

import { resolveNativeThemeSymbol, type NativeIconRole, useNativeTheme } from "@/theme";

export function ThemeIcon({
  role,
  type,
  ...props
}: Omit<SymbolViewProps, "name" | "role"> & { role: NativeIconRole }) {
  const selection = resolveNativeThemeSymbol(useNativeTheme().manifest, role);
  return <SymbolView {...props} name={selection.name} type={type ?? selection.type} />;
}
