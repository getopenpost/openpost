import { SymbolView, type SymbolViewProps } from "expo-symbols";

import { resolveNativeProtectedIcon, type NativeProtectedIconRole } from "@/theme/protected-icons";

export function ProtectedIcon({
  label,
  role,
  ...props
}: Omit<
  SymbolViewProps,
  | "accessibilityElementsHidden"
  | "accessibilityLabel"
  | "accessibilityRole"
  | "accessible"
  | "importantForAccessibility"
  | "name"
  | "role"
> & {
  readonly label?: string;
  readonly role: NativeProtectedIconRole;
}) {
  return (
    <SymbolView
      {...props}
      accessibilityElementsHidden={label ? undefined : true}
      accessibilityLabel={label}
      accessibilityRole={label ? "image" : undefined}
      accessible={Boolean(label)}
      importantForAccessibility={label ? "yes" : "no-hide-descendants"}
      name={resolveNativeProtectedIcon(role)}
    />
  );
}
