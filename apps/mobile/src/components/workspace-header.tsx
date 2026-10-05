import { DitherPressable } from "@/components/dither-pressable";
import { useState } from "react";
import { View } from "react-native";

import { Brand } from "@/components/brand";
import { ThemeIcon } from "@/components/theme-icon";
import { WorkspaceMenu } from "@/components/workspace-menu";
import { useWorkspaces, useWorkspaceId } from "@/lib/queries";
import { useNativeTheme } from "@/theme";

export function WorkspaceHeader({ children }: { children?: React.ReactNode }) {
  const { colors, spacing, shape } = useNativeTheme().manifest;
  const workspaces = useWorkspaces();
  const workspaceId = useWorkspaceId();
  const [menuOpen, setMenuOpen] = useState(false);
  const name = workspaces.data?.find((workspace) => workspace.id === workspaceId)?.name;
  return (
    <View
      style={{
        flexDirection: "row",
        alignItems: "center",
        gap: spacing.small,
        paddingHorizontal: spacing.large,
        paddingVertical: spacing.small,
      }}
    >
      <DitherPressable
        radius={shape.medium}
        focusColor={colors.focus}
        accessibilityRole="button"
        accessibilityLabel={`Open workspace menu${name ? `, ${name}` : ""}`}
        onPress={() => setMenuOpen(true)}
        style={({ pressed }) => ({
          flex: 1,
          minHeight: 48,
          flexDirection: "row",
          alignItems: "center",
          gap: spacing.small,
          opacity: pressed ? 0.6 : 1,
        })}
      >
        <Brand compact />
        <ThemeIcon role="disclosure" size={14} tintColor={colors.onSurfaceVariant} />
      </DitherPressable>
      {children}
      {menuOpen ? (
        <WorkspaceMenu onClose={() => setMenuOpen(false)} workspaces={workspaces.data ?? []} />
      ) : null}
    </View>
  );
}
